import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { ensureEmailSignupSchema } from "@/lib/emailSignupSchema";
import { isPortOneChargeEnabled, isPortOneServerVerifyConfigured } from "@/lib/portoneConfig";

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
export const PORTONE_REVIEWER_KG_TEST_CHECKOUT_KIND = "reviewer_kg_test";
export const PORTONE_REVIEWER_KG_TEST_ENABLE_FLAG = "PORTONE_REVIEWER_KG_TEST_CHECKOUT_ENABLED";
/** Confirmed public KG Inicis test identifiers. Not secrets. */
export const PORTONE_REVIEWER_KG_TEST_STORE_ID = "store-a8f42240-555d-4df7-a6e2-3eb1407257a9";
export const PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY = "channel-key-587c7ec0-0845-42cd-95d9-245d85ea83ea";
export const PORTONE_REVIEWER_KG_TEST_CHANNEL_NAME = "hav_KG_INICIS_TEST";
export const PORTONE_REVIEWER_KG_TEST_MID = "INIpayTest";

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

function envFlagOn(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

function resolvedReviewerKgTestIdentifiers():
  | { ok: true; storeId: string; channelKey: string }
  | { ok: false; reason: "channel_mismatch" } {
  const envStore = process.env.PORTONE_REVIEWER_STORE_ID?.trim() || "";
  const envChannel = process.env.PORTONE_REVIEWER_CHANNEL_KEY?.trim() || "";
  const storeId = envStore || PORTONE_REVIEWER_KG_TEST_STORE_ID;
  const channelKey = envChannel || PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY;
  if (
    storeId !== PORTONE_REVIEWER_KG_TEST_STORE_ID ||
    channelKey !== PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY
  ) {
    return { ok: false, reason: "channel_mismatch" };
  }
  return { ok: true, storeId, channelKey };
}

export type PortoneReviewerPaymentsReadiness =
  | {
      ready: true;
      storeId: string;
      channelKey: string;
      channelName: typeof PORTONE_REVIEWER_KG_TEST_CHANNEL_NAME;
      payMethod: "CARD";
    }
  | {
      ready: false;
      reason:
        | "flag_off"
        | "secret_missing"
        | "channel_mismatch"
        | typeof PORTONE_REVIEWER_PAYMENTS_UNVERIFIED_REASON;
      detail: string;
    };

/**
 * Fail-closed. An env name or shared live/public key is not enough.
 * Store/channel values must match the confirmed KG Inicis test identifiers.
 */
export function inspectPortoneReviewerPaymentsReadiness(): PortoneReviewerPaymentsReadiness {
  if (!envFlagOn(PORTONE_REVIEWER_KG_TEST_ENABLE_FLAG)) {
    return {
      ready: false,
      reason: envFlagOn("PORTONE_REVIEWER_PAYMENTS_ENABLED")
        ? PORTONE_REVIEWER_PAYMENTS_UNVERIFIED_REASON
        : "flag_off",
      detail:
        "Reviewer KG test checkout stays closed until PORTONE_REVIEWER_KG_TEST_CHECKOUT_ENABLED is explicitly on and the confirmed test store/channel match.",
    };
  }

  if (!isPortOneServerVerifyConfigured()) {
    return {
      ready: false,
      reason: "secret_missing",
      detail: "Reviewer KG test checkout needs a server-only PortOne API secret.",
    };
  }

  const identifiers = resolvedReviewerKgTestIdentifiers();
  if (!identifiers.ok) {
    return {
      ready: false,
      reason: "channel_mismatch",
      detail: "Reviewer checkout only accepts the confirmed KG Inicis test store and channel.",
    };
  }

  return {
    ready: true,
    storeId: identifiers.storeId,
    channelKey: identifiers.channelKey,
    channelName: PORTONE_REVIEWER_KG_TEST_CHANNEL_NAME,
    payMethod: "CARD",
  };
}

export function isPortoneReviewerPaymentsReady(): boolean {
  return inspectPortoneReviewerPaymentsReadiness().ready;
}

export function getPortoneReviewerKgTestCheckoutContext():
  | { ok: true; storeId: string; channelKey: string; channelName: string; payMethod: "CARD" }
  | { ok: false; reason: PortoneReviewerPaymentsReadiness & { ready: false } } {
  const readiness = inspectPortoneReviewerPaymentsReadiness();
  if (!readiness.ready) return { ok: false, reason: readiness };
  return {
    ok: true,
    storeId: readiness.storeId,
    channelKey: readiness.channelKey,
    channelName: readiness.channelName,
    payMethod: readiness.payMethod,
  };
}

export function isConfirmedReviewerKgTestChannel(input: {
  storeId?: string | null;
  channelKey?: string | null;
}): boolean {
  return (
    input.storeId === PORTONE_REVIEWER_KG_TEST_STORE_ID &&
    input.channelKey === PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY
  );
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
