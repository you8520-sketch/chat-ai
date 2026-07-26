/**
 * Muse Positive Length Owner — admin-only canary gate (default OFF, fail-closed).
 *
 * Env:
 *   MUSE_POSITIVE_LENGTH_OWNER_ENABLED
 *   MUSE_POSITIVE_LENGTH_OWNER_USER_IDS
 *   MUSE_POSITIVE_LENGTH_OWNER_MODEL_IDS
 *   MUSE_POSITIVE_LENGTH_OWNER_CHAT_IDS
 *
 * Requires ENABLED + positive user allowlist + exact Muse Spark + chat allowlist.
 * Chat allowlist unset/empty/malformed → OFF. No public rollout path.
 */

import { isMuseSparkModel, MUSE_SPARK_MODEL_ID } from "@/lib/proseMuseM1Policy";

const ENV_ENABLED = "MUSE_POSITIVE_LENGTH_OWNER_ENABLED";
const ENV_USER_IDS = "MUSE_POSITIVE_LENGTH_OWNER_USER_IDS";
const ENV_MODEL_IDS = "MUSE_POSITIVE_LENGTH_OWNER_MODEL_IDS";
const ENV_CHAT_IDS = "MUSE_POSITIVE_LENGTH_OWNER_CHAT_IDS";

const CANONICAL_POSITIVE_INT_RE = /^[1-9]\d*$/;

function parseAllowlist(raw: string | undefined): number[] {
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!CANONICAL_POSITIVE_INT_RE.test(t)) continue;
    const n = Number(t);
    if (Number.isSafeInteger(n) && n > 0) out.push(n);
  }
  return out;
}

function parseModelAllowlist(raw: string | undefined): string[] | null {
  if (raw == null) return null;
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim().toLowerCase();
    if (t) out.push(t);
  }
  return out;
}

function isTruthyEnvFlag(raw: string | undefined): boolean {
  const enabled = raw?.trim();
  return enabled === "1" || enabled?.toLowerCase() === "true";
}

function isSafePositiveInt(id: number | null | undefined): id is number {
  return id != null && Number.isSafeInteger(id) && id > 0;
}

/**
 * Chat allowlist is fail-closed:
 * unset → OFF, empty → OFF, malformed-only → OFF, missing/unsafe chatId → OFF.
 */
function isChatAllowlistPass(chatId: number | null | undefined): boolean {
  const raw = process.env[ENV_CHAT_IDS];
  if (raw == null) return false;
  const allow = parseAllowlist(raw);
  if (allow.length === 0) return false;
  if (!isSafePositiveInt(chatId)) return false;
  return allow.includes(chatId);
}

/** Muse Positive Length Owner gate — replaces LENGTH + Terminal when ON. */
export function isMusePositiveLengthOwnerEnabledForUser(
  userId: number | null | undefined,
  modelId: string | null | undefined,
  chatId: number | null | undefined
): boolean {
  if (!isTruthyEnvFlag(process.env[ENV_ENABLED])) return false;

  const allow = parseAllowlist(process.env[ENV_USER_IDS]);
  if (allow.length === 0) return false;
  if (!isSafePositiveInt(userId)) return false;
  if (!allow.includes(userId)) return false;

  if (!isMuseSparkModel(modelId)) return false;

  const models = parseModelAllowlist(process.env[ENV_MODEL_IDS]);
  if (models === null) {
    // unset model list → still require exact Muse Spark (isMuseSparkModel above)
  } else if (models.length === 0) {
    return false;
  } else {
    const id = modelId?.trim().toLowerCase() ?? null;
    if (!id || !models.includes(id)) return false;
  }

  return isChatAllowlistPass(chatId);
}

export const MUSE_POSITIVE_LENGTH_OWNER_ENV = {
  ENABLED: ENV_ENABLED,
  USER_IDS: ENV_USER_IDS,
  MODEL_IDS: ENV_MODEL_IDS,
  CHAT_IDS: ENV_CHAT_IDS,
};

export { MUSE_SPARK_MODEL_ID, isMuseSparkModel };
