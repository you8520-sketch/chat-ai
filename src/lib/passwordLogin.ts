import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { ensureEmailSignupSchema } from "@/lib/emailSignupSchema";
import { EMAIL_SIGNUP_UNVERIFIED_LOGIN_MESSAGE, findPendingEmailSignup } from "@/lib/emailSignupVerification";
import {
  PORTONE_REVIEWER_DISABLED_MESSAGE,
  PORTONE_REVIEWER_LOGIN_ALIAS,
  PORTONE_REVIEWER_LOGIN_LOCKED_MESSAGE,
  clearPortoneReviewerLoginFailures,
  getPortoneReviewerLoginLock,
  notePortoneReviewerLoginFailure,
} from "@/lib/portoneReviewerAccount";

export const PASSWORD_LOGIN_INVALID_MESSAGE = "이메일 또는 비밀번호가 올바르지 않습니다.";
export const PASSWORD_LOGIN_GOOGLE_ONLY_MESSAGE =
  "Google 계정으로 가입하셨습니다. Google로 로그인해 주세요.";

export type PasswordLoginSuccess = {
  ok: true;
  userId: number;
};

export type PasswordLoginFailure = {
  ok: false;
  status: number;
  error: string;
};

export type PasswordLoginResult = PasswordLoginSuccess | PasswordLoginFailure;

function normalizeIdentifier(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function lookupUserByEmail(email: string):
  | {
      id: number;
      pw_hash: string;
      google_id: string | null;
      account_kind: string | null;
      login_disabled: number;
    }
  | undefined {
  const db = getDb();
  ensureEmailSignupSchema(db);
  return db
    .prepare(
      `SELECT id, pw_hash, google_id, account_kind, login_disabled
       FROM users WHERE lower(email) = ?`
    )
    .get(email) as
    | {
        id: number;
        pw_hash: string;
        google_id: string | null;
        account_kind: string | null;
        login_disabled: number;
      }
    | undefined;
}

function lookupUserByAlias(alias: string):
  | {
      id: number;
      pw_hash: string;
      google_id: string | null;
      account_kind: string | null;
      login_disabled: number;
    }
  | undefined {
  const db = getDb();
  ensureEmailSignupSchema(db);
  return db
    .prepare(
      `SELECT u.id, u.pw_hash, u.google_id, u.account_kind, u.login_disabled
       FROM login_aliases a
       JOIN users u ON u.id = a.user_id
       WHERE a.alias = ?`
    )
    .get(alias) as
    | {
        id: number;
        pw_hash: string;
        google_id: string | null;
        account_kind: string | null;
        login_disabled: number;
      }
    | undefined;
}

export function authenticatePasswordLogin(
  identifier: unknown,
  password: unknown
): PasswordLoginResult {
  const rawId = normalizeIdentifier(identifier);
  const pw = typeof password === "string" ? password : "";
  if (!rawId || !pw) {
    return { ok: false, status: 401, error: PASSWORD_LOGIN_INVALID_MESSAGE };
  }

  const alias = rawId.toLowerCase();
  const isReviewerAlias = alias === PORTONE_REVIEWER_LOGIN_ALIAS && !rawId.includes("@");
  if (isReviewerAlias && getPortoneReviewerLoginLock().locked) {
    return { ok: false, status: 429, error: PORTONE_REVIEWER_LOGIN_LOCKED_MESSAGE };
  }

  const user = isReviewerAlias
    ? lookupUserByAlias(PORTONE_REVIEWER_LOGIN_ALIAS)
    : lookupUserByEmail(rawId.toLowerCase());

  if (!user) {
    if (isReviewerAlias) {
      notePortoneReviewerLoginFailure();
      return { ok: false, status: 401, error: PASSWORD_LOGIN_INVALID_MESSAGE };
    }
    if (findPendingEmailSignup(rawId.toLowerCase())) {
      return { ok: false, status: 403, error: EMAIL_SIGNUP_UNVERIFIED_LOGIN_MESSAGE };
    }
    return { ok: false, status: 401, error: PASSWORD_LOGIN_INVALID_MESSAGE };
  }

  if (user.login_disabled === 1) {
    return { ok: false, status: 403, error: PORTONE_REVIEWER_DISABLED_MESSAGE };
  }

  if (!user.pw_hash && user.google_id) {
    return { ok: false, status: 401, error: PASSWORD_LOGIN_GOOGLE_ONLY_MESSAGE };
  }

  if (!verifyPassword(pw, user.pw_hash)) {
    if (isReviewerAlias) {
      const { locked } = notePortoneReviewerLoginFailure();
      if (locked) {
        return { ok: false, status: 429, error: PORTONE_REVIEWER_LOGIN_LOCKED_MESSAGE };
      }
    }
    return { ok: false, status: 401, error: PASSWORD_LOGIN_INVALID_MESSAGE };
  }

  if (isReviewerAlias) {
    clearPortoneReviewerLoginFailures();
  }

  return { ok: true, userId: user.id };
}
