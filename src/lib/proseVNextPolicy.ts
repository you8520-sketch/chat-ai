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
 */

const ENV_ENABLED = "PROSE_VNEXT_ENABLED";
const ENV_USER_IDS = "PROSE_VNEXT_USER_IDS";
const ENV_MODEL_IDS = "PROSE_VNEXT_MODEL_IDS";

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

function modelMatchesAllowlist(modelId: string | null | undefined, allow: string[]): boolean {
  if (!modelId) return false;
  const id = modelId.trim().toLowerCase();
  if (!id) return false;
  return allow.some((sub) => id.includes(sub));
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
  const enabled = process.env[ENV_ENABLED]?.trim();
  if (enabled !== "1" && enabled?.toLowerCase() !== "true") return false;

  const allow = parseAllowlist(process.env[ENV_USER_IDS]);
  if (allow.length === 0) return false; // fail closed — no global exposure

  if (userId == null || !Number.isSafeInteger(userId) || userId <= 0) return false;
  if (!allow.includes(userId)) return false;

  const models = parseModelAllowlist(process.env[ENV_MODEL_IDS]);
  if (models === null) return true; // no model filter configured
  if (models.length === 0) return false; // empty filter → fail closed
  return modelMatchesAllowlist(modelId, models);
}

export const PROSE_VNEXT_ENV = {
  ENABLED: ENV_ENABLED,
  USER_IDS: ENV_USER_IDS,
  MODEL_IDS: ENV_MODEL_IDS,
};
