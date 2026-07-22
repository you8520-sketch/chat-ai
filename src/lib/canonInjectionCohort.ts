import { createHash } from "node:crypto";

/** Stable namespace — changing this reshuffles all cohort buckets. */
export const DEEPSEEK_CANARY_COHORT_NAMESPACE = "canon-injection-deepseek-v1";

const BUCKET_SPACE = 10_000;

export type CohortKeyKind = "user" | "chat" | "none";

export type DeepSeekCohortEligibilityReason =
  | "EXPLICIT_ALLOWLIST"
  | "PERCENT_100"
  | "PERCENT_BUCKET"
  | "PERCENT_BUCKET_MISS"
  | "PERCENT_ZERO"
  | "NO_COHORT_KEY"
  | "NOT_DEEPSEEK";

export type DeepSeekCohortEligibility = {
  eligible: boolean;
  bucket: number | null;
  keyKind: CohortKeyKind;
  reason: DeepSeekCohortEligibilityReason;
};

export type DeepSeekCohortContext = {
  userId?: number | null;
  chatId?: number | null;
};

function envTruthy(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** Fail-safe: unset / invalid / NaN / negative / >100 → 0%. */
export function parseDeepSeekCanaryPercent(): number {
  const raw = process.env.CANON_INJECTION_DEEPSEEK_CANARY_PERCENT?.trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 100) return 0;
  if (n >= 100) return 100;
  return n;
}

export function isDeepSeekMasterCanaryEnabled(): boolean {
  return envTruthy("CANON_INJECTION_DEEPSEEK_CANARY");
}

function parseAllowlistedUserIds(): Set<number> {
  const raw = process.env.CANON_INJECTION_DEEPSEEK_CANARY_USER_IDS?.trim();
  if (!raw) return new Set();
  const ids = new Set<number>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (Number.isInteger(n) && n > 0) ids.add(n);
  }
  return ids;
}

/** USER-sticky first; chatId fallback when user id unavailable. */
export function resolveDeepSeekCohortKey(input: DeepSeekCohortContext): {
  key: string | null;
  keyKind: CohortKeyKind;
} {
  const userId = input.userId;
  if (userId != null && Number.isInteger(userId) && userId > 0) {
    return { key: `user:${userId}`, keyKind: "user" };
  }
  const chatId = input.chatId;
  if (chatId != null && Number.isInteger(chatId) && chatId > 0) {
    return { key: `chat:${chatId}`, keyKind: "chat" };
  }
  return { key: null, keyKind: "none" };
}

/** Deterministic bucket 0..9999 (0.01% granularity). */
export function computeDeepSeekCohortBucket(cohortKey: string): number {
  const digest = createHash("sha256")
    .update(`${DEEPSEEK_CANARY_COHORT_NAMESPACE}\n${cohortKey}`)
    .digest();
  return digest.readUInt32BE(0) % BUCKET_SPACE;
}

/**
 * cohortEligible = explicitAllowlisted OR percentBucketEligible
 * Priority: allowlist checked before percent (allowlist bypasses bucket).
 */
export function resolveDeepSeekCohortEligibility(input: {
  userId?: number | null;
  chatId?: number | null;
  percent?: number;
}): DeepSeekCohortEligibility {
  const percent = input.percent ?? parseDeepSeekCanaryPercent();
  const userId = input.userId;
  if (userId != null && Number.isInteger(userId) && userId > 0) {
    const allowlist = parseAllowlistedUserIds();
    if (allowlist.has(userId)) {
      return {
        eligible: true,
        bucket: null,
        keyKind: "user",
        reason: "EXPLICIT_ALLOWLIST",
      };
    }
  }

  const { key, keyKind } = resolveDeepSeekCohortKey(input);
  if (!key) {
    return {
      eligible: false,
      bucket: null,
      keyKind: "none",
      reason: "NO_COHORT_KEY",
    };
  }

  if (percent <= 0) {
    return {
      eligible: false,
      bucket: computeDeepSeekCohortBucket(key),
      keyKind,
      reason: "PERCENT_ZERO",
    };
  }

  const bucket = computeDeepSeekCohortBucket(key);
  if (percent >= 100) {
    return {
      eligible: true,
      bucket,
      keyKind,
      reason: "PERCENT_100",
    };
  }

  const threshold = Math.floor(percent * 100);
  const eligible = bucket < threshold;
  return {
    eligible,
    bucket,
    keyKind,
    reason: eligible ? "PERCENT_BUCKET" : "PERCENT_BUCKET_MISS",
  };
}

/** Distribution helper for tests — synthetic stable keys only. */
export function measureSyntheticCohortEligibleRatio(
  percent: number,
  syntheticKeyCount: number
): { eligible: number; total: number; ratio: number } {
  const safePercent = Math.max(0, Math.min(100, percent));
  let eligible = 0;
  for (let i = 0; i < syntheticKeyCount; i++) {
    const key = `synthetic:${i}`;
    const bucket = computeDeepSeekCohortBucket(key);
    if (safePercent >= 100) {
      eligible++;
      continue;
    }
    if (safePercent <= 0) continue;
    const threshold = Math.floor(safePercent * 100);
    if (bucket < threshold) eligible++;
  }
  return {
    eligible,
    total: syntheticKeyCount,
    ratio: syntheticKeyCount > 0 ? eligible / syntheticKeyCount : 0,
  };
}
