/**
 * Muse Prose M1 — admin canary + public rollout gates (default OFF, fail-closed).
 *
 * Muse-only: meta/muse-spark-1.1 (exact canonical ID).
 * Separate from PROSE_VNEXT_* — no model-specific prose wording in gate logic.
 */

const ENV_ENABLED = "PROSE_MUSE_M1_ENABLED";
const ENV_USER_IDS = "PROSE_MUSE_M1_USER_IDS";
const ENV_MODEL_IDS = "PROSE_MUSE_M1_MODEL_IDS";
const ENV_ROLLOUT_ENABLED = "PROSE_MUSE_M1_ROLLOUT_ENABLED";
const ENV_ROLLOUT_MODEL_IDS = "PROSE_MUSE_M1_ROLLOUT_MODEL_IDS";

/** Canonical Muse Spark model ID for M1 routing. */
export const MUSE_SPARK_MODEL_ID = "meta/muse-spark-1.1";

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

function normalizeModelId(modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  const id = modelId.trim().toLowerCase();
  return id || null;
}

function modelMatchesAllowlist(modelId: string | null | undefined, allow: string[]): boolean {
  const id = normalizeModelId(modelId);
  if (!id) return false;
  return allow.some((sub) => id.includes(sub));
}

function parseRolloutModelAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
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

export function isMuseSparkModel(modelId?: string | null | undefined): boolean {
  return normalizeModelId(modelId) === MUSE_SPARK_MODEL_ID;
}

/**
 * Admin M1 gate — enabled + USER_IDS + Muse model (+ optional MODEL_IDS filter).
 */
export function isMuseM1EnabledForUser(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): boolean {
  if (!isTruthyEnvFlag(process.env[ENV_ENABLED])) return false;

  const allow = parseAllowlist(process.env[ENV_USER_IDS]);
  if (allow.length === 0) return false;

  if (userId == null || !Number.isSafeInteger(userId) || userId <= 0) return false;
  if (!allow.includes(userId)) return false;

  if (!isMuseSparkModel(modelId)) return false;

  const models = parseModelAllowlist(process.env[ENV_MODEL_IDS]);
  if (models === null) return true;
  if (models.length === 0) return false;
  return modelMatchesAllowlist(modelId, models);
}

/**
 * Public M1 rollout — exact canonical model ID match only.
 */
export function isMuseM1RolloutEnabledForModel(
  modelId?: string | null | undefined
): boolean {
  if (!isTruthyEnvFlag(process.env[ENV_ROLLOUT_ENABLED])) return false;

  const allow = parseRolloutModelAllowlist(process.env[ENV_ROLLOUT_MODEL_IDS]);
  if (allow.length === 0) return false;

  const id = normalizeModelId(modelId);
  if (!id) return false;
  return allow.includes(id);
}

export const PROSE_MUSE_M1_ENV = {
  ENABLED: ENV_ENABLED,
  USER_IDS: ENV_USER_IDS,
  MODEL_IDS: ENV_MODEL_IDS,
  ROLLOUT_ENABLED: ENV_ROLLOUT_ENABLED,
  ROLLOUT_MODEL_IDS: ENV_ROLLOUT_MODEL_IDS,
};
