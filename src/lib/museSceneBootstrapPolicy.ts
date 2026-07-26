/**
 * Muse Scene Bootstrap — admin-only canary gates for Compact Semantic State
 * and Structural Length Anchor (default OFF, fail-closed).
 *
 * Shared allowlists:
 *   MUSE_SCENE_BOOTSTRAP_USER_IDS
 *   MUSE_SCENE_BOOTSTRAP_MODEL_IDS
 *
 * Independent component enables:
 *   MUSE_COMPACT_SCENE_STATE_ENABLED
 *   MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED
 *
 * Each component requires its own ENABLED flag PLUS the shared allowlists.
 * Exact canonical Muse Spark model only. No public rollout path.
 */

import { isMuseSparkModel, MUSE_SPARK_MODEL_ID } from "@/lib/proseMuseM1Policy";

const ENV_SEMANTIC_ENABLED = "MUSE_COMPACT_SCENE_STATE_ENABLED";
const ENV_ANCHOR_ENABLED = "MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED";
const ENV_USER_IDS = "MUSE_SCENE_BOOTSTRAP_USER_IDS";
const ENV_MODEL_IDS = "MUSE_SCENE_BOOTSTRAP_MODEL_IDS";

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

function isSharedAllowlistPass(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): boolean {
  const allow = parseAllowlist(process.env[ENV_USER_IDS]);
  if (allow.length === 0) return false;

  if (userId == null || !Number.isSafeInteger(userId) || userId <= 0) return false;
  if (!allow.includes(userId)) return false;

  if (!isMuseSparkModel(modelId)) return false;

  const models = parseModelAllowlist(process.env[ENV_MODEL_IDS]);
  if (models === null) return true;
  if (models.length === 0) return false;

  const id = modelId?.trim().toLowerCase() ?? null;
  if (!id) return false;
  return models.includes(id);
}

/** Compact Semantic State gate — independent of Structural Length Anchor. */
export function isMuseCompactSceneStateEnabledForUser(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): boolean {
  if (!isTruthyEnvFlag(process.env[ENV_SEMANTIC_ENABLED])) return false;
  return isSharedAllowlistPass(userId, modelId);
}

/** Structural Length Anchor gate — independent of Compact Semantic State. */
export function isMuseStructuralLengthAnchorEnabledForUser(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): boolean {
  if (!isTruthyEnvFlag(process.env[ENV_ANCHOR_ENABLED])) return false;
  return isSharedAllowlistPass(userId, modelId);
}

export const MUSE_SCENE_BOOTSTRAP_ENV = {
  SEMANTIC_ENABLED: ENV_SEMANTIC_ENABLED,
  ANCHOR_ENABLED: ENV_ANCHOR_ENABLED,
  USER_IDS: ENV_USER_IDS,
  MODEL_IDS: ENV_MODEL_IDS,
};

export { MUSE_SPARK_MODEL_ID, isMuseSparkModel };
