/**
 * PROSE VNEXT — admin canary gate (default OFF, fail-closed).
 *
 * Actual ON requires BOTH:
 *   PROSE_VNEXT_ENABLED=1 (or "true")
 *   AND requesting userId is a valid strict positive integer
 *       explicitly present in PROSE_VNEXT_USER_IDS.
 *
 * No valid USER_IDS → OFF (enabled alone never exposes VNext globally).
 * Optional PROSE_VNEXT_MODEL_IDS may further restrict; never bypasses user allowlist.
 * No model-specific prose wording — gate only.
 *
 * Public model-qualified rollout (separate path, default OFF):
 *   PROSE_VNEXT_ROLLOUT_ENABLED=1 (or "true")
 *   AND exact canonical model ID listed in PROSE_VNEXT_ROLLOUT_MODEL_IDS.
 * Rollout never bypasses admin user allowlist semantics — it is an OR path for any user
 * when the model is explicitly qualified and listed.
 */

const ENV_ENABLED = "PROSE_VNEXT_ENABLED";
const ENV_USER_IDS = "PROSE_VNEXT_USER_IDS";
const ENV_MODEL_IDS = "PROSE_VNEXT_MODEL_IDS";
const ENV_ROLLOUT_ENABLED = "PROSE_VNEXT_ROLLOUT_ENABLED";
const ENV_ROLLOUT_MODEL_IDS = "PROSE_VNEXT_ROLLOUT_MODEL_IDS";

/**
 * Canonical positive-integer token: /^[1-9]\d*$/.
 * Rejects "1.9", "1e2", "+1", "-1", "0", "01", "abc", "" — fail closed.
 */
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
  // Empty after trim → treat as no valid models → fail closed at model step
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

/**
 * Returns true ONLY when enabled AND userId is in the allowlist
 * (AND model matches optional model allowlist when set).
 * Default / missing allowlist / non-allowlisted user → false.
 */
export function isProseVNextEnabledForUser(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): boolean {
  if (!isTruthyEnvFlag(process.env[ENV_ENABLED])) return false;

  const allow = parseAllowlist(process.env[ENV_USER_IDS]);
  if (allow.length === 0) return false; // fail closed — no global exposure

  if (userId == null || !Number.isSafeInteger(userId) || userId <= 0) return false;
  if (!allow.includes(userId)) return false;

  const models = parseModelAllowlist(process.env[ENV_MODEL_IDS]);
  if (models === null) return true; // no model filter configured
  if (models.length === 0) return false; // empty filter → fail closed
  return modelMatchesAllowlist(modelId, models);
}

/**
 * Public model-qualified rollout — exact canonical model ID match only.
 * Default / missing MODEL_IDS / enabled alone → false.
 */
export function isProseVNextRolloutEnabledForModel(
  modelId?: string | null | undefined
): boolean {
  if (!isTruthyEnvFlag(process.env[ENV_ROLLOUT_ENABLED])) return false;

  const allow = parseRolloutModelAllowlist(process.env[ENV_ROLLOUT_MODEL_IDS]);
  if (allow.length === 0) return false;

  const id = normalizeModelId(modelId);
  if (!id) return false;
  return allow.includes(id);
}

/**
 * Single ON switch: admin canary OR public model-qualified rollout.
 */
export function isProseVNextOn(
  userId: number | null | undefined,
  modelId?: string | null | undefined
): boolean {
  return (
    isProseVNextEnabledForUser(userId, modelId) ||
    isProseVNextRolloutEnabledForModel(modelId)
  );
}

export const PROSE_VNEXT_ENV = {
  ENABLED: ENV_ENABLED,
  USER_IDS: ENV_USER_IDS,
  MODEL_IDS: ENV_MODEL_IDS,
  ROLLOUT_ENABLED: ENV_ROLLOUT_ENABLED,
  ROLLOUT_MODEL_IDS: ENV_ROLLOUT_MODEL_IDS,
};
