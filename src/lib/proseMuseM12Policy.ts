/**
 * Muse Prose M1.2 — admin-only canary gate (default OFF, fail-closed).
 *
 * Requires ALL of:
 *   PROSE_MUSE_M12_ENABLED=1 (or "true")
 *   AND requesting userId is a valid strict positive integer in PROSE_MUSE_M12_USER_IDS
 *   AND modelId is exactly the canonical Muse Spark model ID (meta/muse-spark-1.1)
 *   AND optional PROSE_MUSE_M12_MODEL_IDS, when set, contains the exact canonical ID.
 *
 * No public rollout path for M1.2 in this candidate.
 * No model-specific prose wording in gate logic.
 */

import { isMuseSparkModel, MUSE_SPARK_MODEL_ID } from "@/lib/proseMuseM1Policy";

const ENV_ENABLED = "PROSE_MUSE_M12_ENABLED";
const ENV_USER_IDS = "PROSE_MUSE_M12_USER_IDS";
const ENV_MODEL_IDS = "PROSE_MUSE_M12_MODEL_IDS";

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
  if (raw == null) return null; // unset → no model filter
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

/**
 * Returns true ONLY when enabled AND userId is in the allowlist
 * AND model is exactly the canonical Muse Spark model.
 * Optional PROSE_MUSE_M12_MODEL_IDS further restricts to exact canonical IDs.
 */
export function isMuseM12EnabledForUser(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): boolean {
  if (!isTruthyEnvFlag(process.env[ENV_ENABLED])) return false;

  const allow = parseAllowlist(process.env[ENV_USER_IDS]);
  if (allow.length === 0) return false; // fail-closed — no global exposure

  if (userId == null || !Number.isSafeInteger(userId) || userId <= 0) return false;
  if (!allow.includes(userId)) return false;

  // Exact canonical Muse Spark model only (substring matching is not allowed).
  if (!isMuseSparkModel(modelId)) return false;

  const models = parseModelAllowlist(process.env[ENV_MODEL_IDS]);
  if (models === null) return true; // no model filter configured
  if (models.length === 0) return false; // empty filter → fail closed

  const id = modelId?.trim().toLowerCase() ?? null;
  if (!id) return false;
  return models.includes(id);
}

export const PROSE_MUSE_M12_ENV = {
  ENABLED: ENV_ENABLED,
  USER_IDS: ENV_USER_IDS,
  MODEL_IDS: ENV_MODEL_IDS,
};

export { MUSE_SPARK_MODEL_ID };
