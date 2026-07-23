/**
 * INTERACTIVE USER OWNERSHIP LOCK — admin canary gate.
 *
 * Purpose: production validation of the new global interactive user-ownership
 * recency lock for a single admin canary (e.g. Muse Spark provider
 * validation) WITHOUT changing behavior for any other production user.
 *
 * IMPORTANT SEPARATION:
 *  This gate is intentionally SEPARATE from the DeepSeek Canon cohort
 * (canonInjectionCohort / canonInjectionPolicy). It must NOT be combined
 * with the Canon architecture, CORE/ACTIVE/Momentum, or any model-specific
 * adapter. The only effect of this gate is to enable the provider-agnostic
 * INTERACTIVE-ONLY RECENCY OWNERSHIP LOCK in the current-user-input wrapper.
 *
 * Default: OFF — no global behavior change. Only when enabled AND the
 * requesting user is in the allowlist does the lock get injected.
 */

const ENV_ENABLED = "INTERACTIVE_USER_OWNERSHIP_LOCK_ENABLED";
const ENV_USER_IDS = "INTERACTIVE_USER_OWNERSHIP_LOCK_USER_IDS";

/**
 * Canonical positive-integer token: /^[1-9]\d*$/.
 * Rejects "1.9", "1e2", "+1", "-1", "0", "01", "abc", "" — admin-only safety
 * gate requires EXACT positive integer id matching (no coercion, no flooring).
 */
const CANONICAL_POSITIVE_INT_RE = /^[1-9]\d*$/;

function parseAllowlist(raw: string | undefined): number[] {
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!CANONICAL_POSITIVE_INT_RE.test(t)) continue; // fail closed on malformed token
    const n = Number(t);
    if (Number.isSafeInteger(n) && n > 0) out.push(n);
  }
  return out;
}

/**
 * Returns true ONLY when the gate is enabled AND userId is in the allowlist.
 * No env / no allowlist / non-allowlisted user → false (old behavior preserved).
 * Runtime userId must itself be a safe positive integer (no flooring / coercion).
 */
export function isInteractiveUserOwnershipLockEnabledForUser(
  userId: number | null | undefined
): boolean {
  const enabled = process.env[ENV_ENABLED]?.trim();
  if (enabled !== "1" && enabled?.toLowerCase() !== "true") return false;
  const allow = parseAllowlist(process.env[ENV_USER_IDS]);
  if (allow.length === 0) return false; // enabled but no valid allowlist → all OFF
  if (userId == null || !Number.isSafeInteger(userId) || userId <= 0) return false;
  return allow.includes(userId);
}

/** Test-only: reset is implicit (reads env live). Kept for symmetry with canon cohort helpers. */
export const INTERACTIVE_USER_OWNERSHIP_LOCK_ENV = {
  ENABLED: ENV_ENABLED,
  USER_IDS: ENV_USER_IDS,
};

/* ──────────────────────────────────────────────────────────────────────
 * R1 — COMPACT TERMINAL OWNERSHIP ECHO — Muse-targeted admin canary gate.
 *
 * Separate from the ownership lock gate above. Enables a COMPACT terminal
 * ownership echo appended AFTER the current-user body (literal prompt tail)
 * ONLY for an admin allowlist AND a model allowlist (default: Muse Spark).
 * DeepSeek/Gemini/HY3 production behavior is unchanged (model not matched).
 *
 * This is a compliance recency shim, NOT a Muse prose adapter: it adds no
 * dialogue quotas, prose, LENGTH, or stable/cached content.
 * ────────────────────────────────────────────────────────────────────── */

const ENV_ECHO_ENABLED = "INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_ENABLED";
const ENV_ECHO_USER_IDS = "INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_USER_IDS";
const ENV_ECHO_MODELS = "INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_MODELS";

/** Default model allowlist when env unset — Muse Spark family only. */
const DEFAULT_ECHO_MODEL_SUBSTRINGS = ["muse-spark", "muse_spark", "musespark"];

function parseModelAllowlist(raw: string | undefined): string[] {
  if (!raw) return DEFAULT_ECHO_MODEL_SUBSTRINGS;
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim().toLowerCase();
    if (t) out.push(t);
  }
  return out.length > 0 ? out : DEFAULT_ECHO_MODEL_SUBSTRINGS;
}

function modelMatchesAllowlist(modelId: string | null | undefined, allow: string[]): boolean {
  if (!modelId) return false;
  const id = modelId.trim().toLowerCase();
  if (!id) return false;
  return allow.some((sub) => id.includes(sub));
}

/**
 * Returns true ONLY when the R1 echo gate is enabled AND userId is in the
 * allowlist AND the request model matches the model allowlist (default Muse
 * Spark). No env / empty allowlist / non-allowlisted user / non-matching model
 * → false (old behavior preserved for DeepSeek/Gemini/HY3 and all non-admin).
 */
export function isInteractiveUserOwnershipTerminalEchoEnabledForUser(
  userId: number | null | undefined,
  modelId: string | null | undefined
): boolean {
  const enabled = process.env[ENV_ECHO_ENABLED]?.trim();
  if (enabled !== "1" && enabled?.toLowerCase() !== "true") return false;
  const allow = parseAllowlist(process.env[ENV_ECHO_USER_IDS]);
  if (allow.length === 0) return false; // enabled but no valid user allowlist → all OFF
  if (userId == null || !Number.isSafeInteger(userId) || userId <= 0) return false;
  if (!allow.includes(userId)) return false;
  const models = parseModelAllowlist(process.env[ENV_ECHO_MODELS]);
  return modelMatchesAllowlist(modelId, models);
}

export const INTERACTIVE_USER_OWNERSHIP_TERMINAL_ECHO_ENV = {
  ENABLED: ENV_ECHO_ENABLED,
  USER_IDS: ENV_ECHO_USER_IDS,
  MODELS: ENV_ECHO_MODELS,
};
