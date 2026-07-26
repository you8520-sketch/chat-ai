/**
 * Muse Unknown-Information Truth Guard — admin-only canary gate
 * (default OFF, fail-closed).
 *
 * Requires ALL of:
 *   MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED=1 (or "true")
 *   AND requesting userId is a valid strict positive integer in
 *       MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS
 *   AND modelId is exactly the canonical Muse Spark model ID (meta/muse-spark-1.1)
 *   AND optional MUSE_UNKNOWN_INFO_TRUTH_GUARD_MODEL_IDS, when set, contains the
 *       exact canonical ID (no substring / alias match).
 *
 * Independent of PROSE_MUSE_M1 / PROSE_MUSE_M11 gates.
 * No public rollout path.
 */

import { isMuseSparkModel, MUSE_SPARK_MODEL_ID } from "@/lib/proseMuseM1Policy";

const ENV_ENABLED = "MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENABLED";
const ENV_USER_IDS = "MUSE_UNKNOWN_INFO_TRUTH_GUARD_USER_IDS";
const ENV_MODEL_IDS = "MUSE_UNKNOWN_INFO_TRUTH_GUARD_MODEL_IDS";

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
  if (raw == null) return null; // unset → no extra model filter
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
 * Optional MODEL_IDS further restricts to exact canonical IDs.
 */
export function isMuseUnknownInformationTruthGuardEnabledForUser(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): boolean {
  if (!isTruthyEnvFlag(process.env[ENV_ENABLED])) return false;

  const allow = parseAllowlist(process.env[ENV_USER_IDS]);
  if (allow.length === 0) return false;

  if (userId == null || !Number.isSafeInteger(userId) || userId <= 0) return false;
  if (!allow.includes(userId)) return false;

  // Exact canonical Muse Spark model only (substring matching is not allowed).
  if (!isMuseSparkModel(modelId)) return false;

  const models = parseModelAllowlist(process.env[ENV_MODEL_IDS]);
  if (models === null) return true;
  if (models.length === 0) return false;

  const id = modelId?.trim().toLowerCase() ?? null;
  if (!id) return false;
  return models.includes(id);
}

const ENV_INTRA_WORLD_ENABLED = "MUSE_INTRAWORLD_PROVENANCE_GUARD_ENABLED";

export const MUSE_UNKNOWN_INFO_TRUTH_GUARD_ENV = {
  ENABLED: ENV_ENABLED,
  USER_IDS: ENV_USER_IDS,
  MODEL_IDS: ENV_MODEL_IDS,
  INTRA_WORLD_ENABLED: ENV_INTRA_WORLD_ENABLED,
};

/**
 * Admin-only Muse intra-world provenance guard.
 * Reuses the existing Unknown Information Truth Guard user/model allowlists,
 * and additionally requires MUSE_INTRAWORLD_PROVENANCE_GUARD_ENABLED=1.
 * Fail-closed: OFF if the base Truth Guard is OFF.
 */
export function isMuseIntraWorldProvenanceGuardEnabledForUser(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): boolean {
  if (!isMuseUnknownInformationTruthGuardEnabledForUser(userId, modelId)) return false;
  return isTruthyEnvFlag(process.env[ENV_INTRA_WORLD_ENABLED]);
}

export { MUSE_SPARK_MODEL_ID, isMuseSparkModel };
