/**
 * Muse Example-Dialog Boundary — admin canary gate (default OFF, fail-closed).
 *
 * Muse-only: meta/muse-spark-1.1 (exact canonical ID).
 *
 * Purpose: when ON, raw creator example utterances are removed from the runtime
 * prompt for the allowlisted admin + exact Muse model. Stored creator data and
 * other models are unchanged.
 */

import { MUSE_SPARK_MODEL_ID, isMuseSparkModel } from "@/lib/proseMuseM1Policy";

const ENV_ENABLED = "MUSE_EXAMPLE_DIALOG_BOUNDARY_ENABLED";
const ENV_USER_IDS = "MUSE_EXAMPLE_DIALOG_BOUNDARY_USER_IDS";
const ENV_MODEL_IDS = "MUSE_EXAMPLE_DIALOG_BOUNDARY_MODEL_IDS";

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

/**
 * Admin Muse example-dialog boundary gate.
 *
 * Requirements:
 * - enabled flag true
 * - user in explicit positive-integer allowlist
 * - exact Muse canonical model match
 * - optional exact model allowlist match (if env set, model id must be listed)
 */
export function isMuseExampleDialogBoundaryEnabledForUser(
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
  const id = modelId?.trim().toLowerCase() ?? "";
  return models.includes(id);
}

export const MUSE_EXAMPLE_DIALOG_BOUNDARY_ENV = {
  ENABLED: ENV_ENABLED,
  USER_IDS: ENV_USER_IDS,
  MODEL_IDS: ENV_MODEL_IDS,
};

export { MUSE_SPARK_MODEL_ID, isMuseSparkModel };
