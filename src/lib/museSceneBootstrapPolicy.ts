/**
 * Muse Scene Bootstrap — admin-only canary gates for Compact Semantic State
 * and Structural Length Anchor (default OFF, fail-closed).
 *
 * Shared allowlists:
 *   MUSE_SCENE_BOOTSTRAP_USER_IDS
 *   MUSE_SCENE_BOOTSTRAP_MODEL_IDS
 *
 * Independent component enables + chat allowlists:
 *   MUSE_COMPACT_SCENE_STATE_ENABLED
 *   MUSE_COMPACT_SCENE_STATE_CHAT_IDS
 *   MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED
 *   MUSE_STRUCTURAL_LENGTH_ANCHOR_CHAT_IDS
 *
 * Each component requires its own ENABLED flag, shared user/model allowlists,
 * AND its own chat-id allowlist (unset/empty/malformed → OFF).
 * Exact canonical Muse Spark model only. No public rollout path.
 */

import { isMuseSparkModel, MUSE_SPARK_MODEL_ID } from "@/lib/proseMuseM1Policy";

const ENV_SEMANTIC_ENABLED = "MUSE_COMPACT_SCENE_STATE_ENABLED";
const ENV_ANCHOR_ENABLED = "MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED";
const ENV_USER_IDS = "MUSE_SCENE_BOOTSTRAP_USER_IDS";
const ENV_MODEL_IDS = "MUSE_SCENE_BOOTSTRAP_MODEL_IDS";
const ENV_SEMANTIC_CHAT_IDS = "MUSE_COMPACT_SCENE_STATE_CHAT_IDS";
const ENV_ANCHOR_CHAT_IDS = "MUSE_STRUCTURAL_LENGTH_ANCHOR_CHAT_IDS";

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

function isSharedAllowlistPass(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): boolean {
  const allow = parseAllowlist(process.env[ENV_USER_IDS]);
  if (allow.length === 0) return false;

  if (!isSafePositiveInt(userId)) return false;
  if (!allow.includes(userId)) return false;

  if (!isMuseSparkModel(modelId)) return false;

  const models = parseModelAllowlist(process.env[ENV_MODEL_IDS]);
  if (models === null) return true;
  if (models.length === 0) return false;

  const id = modelId?.trim().toLowerCase() ?? null;
  if (!id) return false;
  return models.includes(id);
}

/**
 * Chat allowlist is fail-closed:
 * unset → OFF, empty → OFF, malformed-only → OFF, missing/unsafe chatId → OFF.
 */
function isChatAllowlistPass(
  envKey: string,
  chatId: number | null | undefined
): boolean {
  const raw = process.env[envKey];
  if (raw == null) return false;
  const allow = parseAllowlist(raw);
  if (allow.length === 0) return false;
  if (!isSafePositiveInt(chatId)) return false;
  return allow.includes(chatId);
}

/** Compact Semantic State gate — independent of Structural Length Anchor. */
export function isMuseCompactSceneStateEnabledForUser(
  userId: number | null | undefined,
  modelId: string | null | undefined,
  chatId: number | null | undefined
): boolean {
  if (!isTruthyEnvFlag(process.env[ENV_SEMANTIC_ENABLED])) return false;
  if (!isSharedAllowlistPass(userId, modelId)) return false;
  return isChatAllowlistPass(ENV_SEMANTIC_CHAT_IDS, chatId);
}

/** Structural Length Anchor gate — independent of Compact Semantic State. */
export function isMuseStructuralLengthAnchorEnabledForUser(
  userId: number | null | undefined,
  modelId: string | null | undefined,
  chatId: number | null | undefined
): boolean {
  if (!isTruthyEnvFlag(process.env[ENV_ANCHOR_ENABLED])) return false;
  if (!isSharedAllowlistPass(userId, modelId)) return false;
  return isChatAllowlistPass(ENV_ANCHOR_CHAT_IDS, chatId);
}

export const MUSE_SCENE_BOOTSTRAP_ENV = {
  SEMANTIC_ENABLED: ENV_SEMANTIC_ENABLED,
  ANCHOR_ENABLED: ENV_ANCHOR_ENABLED,
  USER_IDS: ENV_USER_IDS,
  MODEL_IDS: ENV_MODEL_IDS,
  SEMANTIC_CHAT_IDS: ENV_SEMANTIC_CHAT_IDS,
  ANCHOR_CHAT_IDS: ENV_ANCHOR_CHAT_IDS,
};

export { MUSE_SPARK_MODEL_ID, isMuseSparkModel };
