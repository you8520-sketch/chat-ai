import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { ensureEmailSignupSchema } from "@/lib/emailSignupSchema";
import { isPortOneChargeEnabled } from "@/lib/portoneConfig";

export const PORTONE_REVIEWER_ACCOUNT_KIND = "portone_reviewer";
export const PORTONE_REVIEWER_LOGIN_ALIAS = "tester";
export const PORTONE_REVIEWER_DEFAULT_EMAIL = "portone-reviewer@hav.internal";
export const PORTONE_REVIEWER_NICKNAME = "포트원 심사";

export const PORTONE_REVIEWER_DISABLED_MESSAGE = "심사용 계정이 비활성화되었습니다.";
export const PORTONE_REVIEWER_PAID_API_MESSAGE =
  "심사용 계정에서는 유료 AI 기능을 사용할 수 없습니다.";
export const PORTONE_REVIEWER_GIFT_MESSAGE = "심사용 계정에서는 포인트를 선물할 수 없습니다.";
export const PORTONE_REVIEWER_PAYMENTS_NOT_READY_MESSAGE =
  "심사용 결제 테스트 채널이 준비되지 않았습니다.";
export const PORTONE_REVIEWER_LOGIN_MAX_FAILURES = 5;
export const PORTONE_REVIEWER_LOGIN_LOCK_MS = 15 * 60 * 1000;
export const PORTONE_REVIEWER_LOGIN_LOCKED_MESSAGE =
  "심사용 계정 로그인 시도가 제한되었습니다. 잠시 후 다시 시도해 주세요.";
export const PORTONE_REVIEWER_PAYMENTS_UNVERIFIED_REASON = "test_channel_unverified" as const;

export type ReviewerAccountFields = {
  account_kind?: string | null;
  login_disabled?: number | null;
};

export function isPortoneReviewerAccountKind(kind: string | null | undefined): boolean {
  return kind === PORTONE_REVIEWER_ACCOUNT_KIND;
}

export function isPortoneReviewerAccount(user: ReviewerAccountFields | null | undefined): boolean {
  return isPortoneReviewerAccountKind(user?.account_kind);
}

export type PortoneReviewerPaymentsReadiness = {
  ready: false;
  reason: typeof PORTONE_REVIEWER_PAYMENTS_UNVERIFIED_REASON;
  detail: string;
};

/**
 * Current env only proves that some store/channel/secret exists.
 * It cannot prove those values are the approved PG test channel, so checkout stays closed.
 */
export function inspectPortoneReviewerPaymentsReadiness(): PortoneReviewerPaymentsReadiness {
  return {
    ready: false,
    reason: PORTONE_REVIEWER_PAYMENTS_UNVERIFIED_REASON,
    detail:
      "PORTONE_REVIEWER_PAYMENTS_ENABLED and shared PortOne keys do not identify a PG test channel. Dedicated reviewer store/channel/secret plus live console confirmation are required before checkout can open.",
  };
}

export function isPortoneReviewerPaymentsReady(): boolean {
  return inspectPortoneReviewerPaymentsReadiness().ready;
}

/** Reviewer uses the dedicated test-channel flag only. Everyone else keeps the global gate. */
export function canAccessPortoneCheckout(user: ReviewerAccountFields | null | undefined): boolean {
  if (!user) return false;
  if (isPortoneReviewerAccount(user)) {
    return isPortoneReviewerPaymentsReady();
  }
  return isPortOneChargeEnabled();
}

export function getPaidProviderCallBlockReason(
  user: ReviewerAccountFields | null | undefined
): string | null {
  return isPortoneReviewerAccount(user) ? PORTONE_REVIEWER_PAID_API_MESSAGE : null;
}

export function getPointGiftBlockReason(
  user: ReviewerAccountFields | null | undefined
): string | null {
  return isPortoneReviewerAccount(user) ? PORTONE_REVIEWER_GIFT_MESSAGE : null;
}

export function getPortoneReviewerLoginLock(now = Date.now()): { locked: boolean; lockedUntil: string | null } {
  const db = getDb();
  ensureEmailSignupSchema(db);
  const row = db
    .prepare("SELECT locked_until FROM login_aliases WHERE alias = ?")
    .get(PORTONE_REVIEWER_LOGIN_ALIAS) as { locked_until: string | null } | undefined;
  const lockedUntil = row?.locked_until ?? null;
  const lockedAt = lockedUntil ? Date.parse(lockedUntil) : NaN;
  return { locked: Number.isFinite(lockedAt) && lockedAt > now, lockedUntil };
}

export function notePortoneReviewerLoginFailure(now = Date.now()): { locked: boolean } {
  const db = getDb();
  ensureEmailSignupSchema(db);
  const row = db
    .prepare("SELECT failed_attempts, locked_until FROM login_aliases WHERE alias = ?")
    .get(PORTONE_REVIEWER_LOGIN_ALIAS) as
    | { failed_attempts: number; locked_until: string | null }
    | undefined;
  if (!row) return { locked: false };

  const currentLock = Date.parse(row.locked_until ?? "");
  if (Number.isFinite(currentLock) && currentLock > now) {
    return { locked: true };
  }

  const nextAttempts = Number(row.failed_attempts ?? 0) + 1;
  const lockedUntil =
    nextAttempts >= PORTONE_REVIEWER_LOGIN_MAX_FAILURES
      ? new Date(now + PORTONE_REVIEWER_LOGIN_LOCK_MS).toISOString()
      : null;
  db.prepare("UPDATE login_aliases SET failed_attempts = ?, locked_until = ? WHERE alias = ?").run(
    nextAttempts,
    lockedUntil,
    PORTONE_REVIEWER_LOGIN_ALIAS
  );
  return { locked: Boolean(lockedUntil) };
}

export function clearPortoneReviewerLoginFailures(): void {
  const db = getDb();
  ensureEmailSignupSchema(db);
  db.prepare("UPDATE login_aliases SET failed_attempts = 0, locked_until = NULL WHERE alias = ?").run(
    PORTONE_REVIEWER_LOGIN_ALIAS
  );
}

export function revokeUserSessions(userId: number): number {
  const result = getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  return Number(result.changes ?? 0);
}

export function setPortoneReviewerLoginDisabled(userId: number, disabled: boolean): void {
  const db = getDb();
  ensureEmailSignupSchema(db);
  db.prepare("UPDATE users SET login_disabled = ?, is_admin = 0 WHERE id = ? AND account_kind = ?").run(
    disabled ? 1 : 0,
    userId,
    PORTONE_REVIEWER_ACCOUNT_KIND
  );
  if (disabled) revokeUserSessions(userId);
}

export type ProvisionPortoneReviewerInput = {
  password: string;
  email?: string;
  nickname?: string;
};

export type ProvisionPortoneReviewerResult = {
  userId: number;
  email: string;
  alias: string;
  created: boolean;
};

export function provisionPortoneReviewerAccount(
  input: ProvisionPortoneReviewerInput
): ProvisionPortoneReviewerResult {
  const password = input.password;
  if (!password) {
    throw new Error("PORTONE_REVIEWER_PASSWORD is required.");
  }

  const email = (input.email ?? PORTONE_REVIEWER_DEFAULT_EMAIL).trim().toLowerCase();
  const nickname = (input.nickname ?? PORTONE_REVIEWER_NICKNAME).trim() || PORTONE_REVIEWER_NICKNAME;
  const db = getDb();
  ensureEmailSignupSchema(db);

  return db.transaction(() => {
    const existing = db
      .prepare(
        `SELECT id, account_kind FROM users WHERE email = ?`
      )
      .get(email) as { id: number; account_kind: string | null } | undefined;

    if (existing && !isPortoneReviewerAccountKind(existing.account_kind)) {
      throw new Error("Refusing to convert an existing member into the PortOne reviewer.");
    }

    const pwHash = hashPassword(password);
    let userId: number;
    let created = false;

    if (existing) {
      userId = existing.id;
      db.prepare(
        `UPDATE users
         SET nickname = ?, pw_hash = ?, account_kind = ?, is_admin = 0, login_disabled = 0,
             is_adult = 1, site_managed = 0
         WHERE id = ?`
      ).run(nickname, pwHash, PORTONE_REVIEWER_ACCOUNT_KIND, userId);
    } else {
      const info = db
        .prepare(
          `INSERT INTO users
             (email, nickname, pw_hash, points, is_admin, is_adult, nsfw_on, account_kind, login_disabled, onboarding_completed_at)
           VALUES (?, ?, ?, 0, 0, 1, 0, ?, 0, datetime('now'))`
        )
        .run(email, nickname, pwHash, PORTONE_REVIEWER_ACCOUNT_KIND);
      userId = Number(info.lastInsertRowid);
      created = true;
    }

    db.prepare(
      `INSERT INTO login_aliases (alias, user_id)
       VALUES (?, ?)
       ON CONFLICT(alias) DO UPDATE SET user_id = excluded.user_id`
    ).run(PORTONE_REVIEWER_LOGIN_ALIAS, userId);

    return {
      userId,
      email,
      alias: PORTONE_REVIEWER_LOGIN_ALIAS,
      created,
    };
  })();
}

export function findPortoneReviewerAccount():
  | { id: number; email: string; login_disabled: number }
  | undefined {
  const db = getDb();
  ensureEmailSignupSchema(db);
  return db
    .prepare(
      `SELECT id, email, login_disabled FROM users WHERE account_kind = ? LIMIT 1`
    )
    .get(PORTONE_REVIEWER_ACCOUNT_KIND) as
    | { id: number; email: string; login_disabled: number }
    | undefined;
}
