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

function parseAllowlist(raw: string | undefined): number[] {
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const n = Number(t);
    if (Number.isFinite(n) && n > 0) out.push(Math.floor(n));
  }
  return out;
}

/**
 * Returns true ONLY when the gate is enabled AND userId is in the allowlist.
 * No env / no allowlist / non-allowlisted user → false (old behavior preserved).
 */
export function isInteractiveUserOwnershipLockEnabledForUser(
  userId: number | null | undefined
): boolean {
  const enabled = process.env[ENV_ENABLED]?.trim();
  if (enabled !== "1" && enabled?.toLowerCase() !== "true") return false;
  const allow = parseAllowlist(process.env[ENV_USER_IDS]);
  if (allow.length === 0) return false;
  if (userId == null || !Number.isFinite(userId)) return false;
  return allow.includes(Math.floor(userId));
}

/** Test-only: reset is implicit (reads env live). Kept for symmetry with canon cohort helpers. */
export const INTERACTIVE_USER_OWNERSHIP_LOCK_ENV = {
  ENABLED: ENV_ENABLED,
  USER_IDS: ENV_USER_IDS,
};
