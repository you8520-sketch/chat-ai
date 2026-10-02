import crypto from "crypto";
import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { ensureEmailSignupSchema } from "@/lib/emailSignupSchema";
import { grantSignupBonusOnce } from "@/lib/signupBonus";
import {
  TRANSACTIONAL_EMAIL_ORIGIN_UNVERIFIED_MESSAGE,
  TRANSACTIONAL_EMAIL_SEND_FAILED_MESSAGE,
  TRANSACTIONAL_EMAIL_UNCONFIGURED_MESSAGE,
  buildEmailVerificationUrl,
  buildSignupVerificationEmail,
  isTransactionalEmailConfigured,
  resolveVerifiedMailOrigin,
  sendTransactionalEmail,
} from "@/lib/transactionalEmail";

export const EMAIL_SIGNUP_TOKEN_TTL_MS = 30 * 60 * 1000;
export const EMAIL_SIGNUP_RESEND_COOLDOWN_MS = 60 * 1000;
export const EMAIL_SIGNUP_MAX_SENDS = 5;

export const EMAIL_SIGNUP_PENDING_MESSAGE =
  "인증 메일을 보냈습니다. 메일함의 링크를 눌러 가입을 완료해 주세요.";
export const EMAIL_SIGNUP_UNVERIFIED_LOGIN_MESSAGE =
  "이메일 인증이 완료되지 않았습니다. 메일함의 인증 링크를 확인해 주세요.";
export const EMAIL_SIGNUP_EXISTS_MESSAGE = "이미 가입된 이메일입니다.";
export const EMAIL_SIGNUP_RESEND_LIMIT_MESSAGE =
  "인증 메일 재발송 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.";
export const EMAIL_SIGNUP_RESEND_COOLDOWN_MESSAGE =
  "인증 메일을 너무 자주 요청했습니다. 1분 후 다시 시도해 주세요.";
export const EMAIL_SIGNUP_TOKEN_INVALID_MESSAGE = "유효하지 않은 인증 링크입니다.";
export const EMAIL_SIGNUP_TOKEN_EXPIRED_MESSAGE = "인증 링크가 만료되었습니다. 회원가입을 다시 진행해 주세요.";
export const EMAIL_SIGNUP_TOKEN_USED_MESSAGE = "이미 사용된 인증 링크입니다.";
export const EMAIL_SIGNUP_CONFLICT_MESSAGE = "이미 가입된 이메일입니다. 로그인해 주세요.";

export type EmailSignupPref = "female" | "male" | null;

export type EmailSignupRequestInput = {
  email: unknown;
  nickname: unknown;
  password: unknown;
  pref: unknown;
};

export type EmailSignupRequestResult =
  | { ok: true; pending: true; email: string }
  | { ok: false; status: number; error: string };

export type EmailSignupConfirmResult =
  | { ok: true; userId: number }
  | { ok: false; status: number; error: string };

type PendingRow = {
  email: string;
  nickname: string;
  pw_hash: string;
  pref: string | null;
  token_hash: string;
  expires_at: string;
  send_count: number;
  last_sent_at: string;
};

export type EmailSignupMailer = (payload: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) => Promise<{ ok: true } | { ok: false; error: string }>;

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function normalizeNickname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const nickname = value.trim();
  return nickname ? nickname : null;
}

function normalizePref(value: unknown): EmailSignupPref | undefined {
  if (value === "all" || value === null) return null;
  if (value === "female" || value === "male") return value;
  return undefined;
}

export function hashEmailSignupToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function createEmailSignupToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  return { raw, hash: hashEmailSignupToken(raw) };
}

export function findPendingEmailSignup(email: string): PendingRow | undefined {
  const db = getDb();
  ensureEmailSignupSchema(db);
  return db
    .prepare(
      `SELECT email, nickname, pw_hash, pref, token_hash, expires_at, send_count, last_sent_at
       FROM pending_email_signups WHERE email = ?`
    )
    .get(email) as PendingRow | undefined;
}

export function consumePendingEmailSignup(email: string): void {
  const db = getDb();
  ensureEmailSignupSchema(db);
  db.prepare("DELETE FROM pending_email_signups WHERE email = ?").run(email.trim().toLowerCase());
}

export async function requestEmailSignup(
  input: EmailSignupRequestInput,
  req: Request,
  deps?: { now?: number; sendMail?: EmailSignupMailer }
): Promise<EmailSignupRequestResult> {
  const email = normalizeEmail(input.email);
  const nickname = normalizeNickname(input.nickname);
  const password = typeof input.password === "string" ? input.password : "";
  const storedPref = normalizePref(input.pref);

  if (!email || !nickname || password.length < 6 || storedPref === undefined) {
    return {
      ok: false,
      status: 400,
      error: "이메일, 닉네임, 비밀번호(6자 이상)와 취향(전체/여성향/남성향)을 입력하세요.",
    };
  }

  if (!isTransactionalEmailConfigured()) {
    return { ok: false, status: 503, error: TRANSACTIONAL_EMAIL_UNCONFIGURED_MESSAGE };
  }

  const origin = resolveVerifiedMailOrigin(req);
  if (!origin) {
    return { ok: false, status: 503, error: TRANSACTIONAL_EMAIL_ORIGIN_UNVERIFIED_MESSAGE };
  }

  const db = getDb();
  ensureEmailSignupSchema(db);
  const existingUser = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email);
  if (existingUser) {
    return { ok: false, status: 409, error: EMAIL_SIGNUP_EXISTS_MESSAGE };
  }

  const now = deps?.now ?? Date.now();
  const pending = findPendingEmailSignup(email);
  if (pending) {
    if (pending.send_count >= EMAIL_SIGNUP_MAX_SENDS) {
      return { ok: false, status: 429, error: EMAIL_SIGNUP_RESEND_LIMIT_MESSAGE };
    }
    const lastSent = Date.parse(pending.last_sent_at);
    if (Number.isFinite(lastSent) && now - lastSent < EMAIL_SIGNUP_RESEND_COOLDOWN_MS) {
      return { ok: false, status: 429, error: EMAIL_SIGNUP_RESEND_COOLDOWN_MESSAGE };
    }
  }

  const token = createEmailSignupToken();
  const expiresAt = new Date(now + EMAIL_SIGNUP_TOKEN_TTL_MS).toISOString();
  const lastSentAt = new Date(now).toISOString();
  const sendCount = (pending?.send_count ?? 0) + 1;
  const pwHash = hashPassword(password);

  db.prepare(
    `INSERT INTO pending_email_signups
       (email, nickname, pw_hash, pref, token_hash, expires_at, send_count, last_sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       nickname = excluded.nickname,
       pw_hash = excluded.pw_hash,
       pref = excluded.pref,
       token_hash = excluded.token_hash,
       expires_at = excluded.expires_at,
       send_count = excluded.send_count,
       last_sent_at = excluded.last_sent_at`
  ).run(email, nickname, pwHash, storedPref, token.hash, expiresAt, sendCount, lastSentAt);

  const mail = buildSignupVerificationEmail({
    nickname,
    verifyUrl: buildEmailVerificationUrl(origin, token.raw),
  });
  const sendMail = deps?.sendMail ?? sendTransactionalEmail;
  const sent = await sendMail({ to: email, ...mail });
  if (!sent.ok) {
    return { ok: false, status: 503, error: sent.error || TRANSACTIONAL_EMAIL_SEND_FAILED_MESSAGE };
  }

  return { ok: true, pending: true, email };
}

export function confirmEmailSignup(
  rawToken: string,
  deps?: { now?: number }
): EmailSignupConfirmResult {
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!token) {
    return { ok: false, status: 400, error: EMAIL_SIGNUP_TOKEN_INVALID_MESSAGE };
  }

  const db = getDb();
  ensureEmailSignupSchema(db);
  const tokenHash = hashEmailSignupToken(token);
  const now = deps?.now ?? Date.now();

  try {
    return db.transaction((): EmailSignupConfirmResult => {
      const pending = db
        .prepare(
          `SELECT email, nickname, pw_hash, pref, token_hash, expires_at, send_count, last_sent_at
           FROM pending_email_signups WHERE token_hash = ?`
        )
        .get(tokenHash) as PendingRow | undefined;
      if (!pending) {
        return { ok: false, status: 400, error: EMAIL_SIGNUP_TOKEN_INVALID_MESSAGE };
      }

      const expiresAt = Date.parse(pending.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        db.prepare("DELETE FROM pending_email_signups WHERE email = ?").run(pending.email);
        return { ok: false, status: 410, error: EMAIL_SIGNUP_TOKEN_EXPIRED_MESSAGE };
      }

      const existing = db
        .prepare("SELECT id FROM users WHERE lower(email) = ?")
        .get(pending.email) as { id: number } | undefined;
      if (existing) {
        db.prepare("DELETE FROM pending_email_signups WHERE email = ?").run(pending.email);
        return { ok: false, status: 409, error: EMAIL_SIGNUP_CONFLICT_MESSAGE };
      }

      const info = db
        .prepare(
          "INSERT INTO users (email, nickname, pw_hash, pref, points, onboarding_completed_at) VALUES (?,?,?,?,0,datetime('now'))"
        )
        .run(pending.email, pending.nickname, pending.pw_hash, pending.pref);
      const userId = Number(info.lastInsertRowid);
      grantSignupBonusOnce(userId);
      db.prepare("DELETE FROM pending_email_signups WHERE email = ?").run(pending.email);
      return { ok: true, userId };
    })();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique/i.test(message) || /constraint/i.test(message)) {
      return { ok: false, status: 409, error: EMAIL_SIGNUP_CONFLICT_MESSAGE };
    }
    throw error;
  }
}
