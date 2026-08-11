/**
 * Persona Secret Boundary — ON for all accounts by default.
 * Affects secret exclusion + chat-scoped reveal + secret settings UI; does not alter Canon rollout.
 *
 * Priority:
 * 1) PERSONA_SECRET_BOUNDARY_ENABLED=0 → force OFF for all users (kill switch)
 * 2) otherwise (unset or =1 / true / on / enabled) → ON for all users
 *
 * Discovery kill switch (`PERSONA_SECRET_DISCOVERY_ENABLED`) gates observer/scene/
 * evidence/visual/investigation/transfer/knowledge-prompt writes. When Discovery is
 * OFF, Boundary still allows legacy marker strip, public-only persona projection,
 * and UNKNOWN secret zero-byte isolation.
 *
 * Discovery remains fail-closed: unset/OFF → OFF; explicit ON only when Boundary is
 * enabled for that user.
 */

export type PersonaSecretBoundaryContext = {
  userId?: number | null;
};

function parseTriStateFlag(raw: string | undefined): boolean | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "disabled") return false;
  if (v === "1" || v === "true" || v === "on" || v === "enabled") return true;
  return null;
}

export function isPersonaSecretBoundaryEnabled(
  opts?: PersonaSecretBoundaryContext,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  void opts;
  const explicit = parseTriStateFlag(env.PERSONA_SECRET_BOUNDARY_ENABLED);
  if (explicit === false) return false;
  return true;
}

/**
 * Runtime kill switch for Persona Secret Discovery (S0–S4D engine writes).
 * Fail-closed: unset/OFF → OFF. Explicit ON only when Boundary is enabled for the user.
 */
export function isPersonaSecretDiscoveryEnabled(
  opts?: PersonaSecretBoundaryContext,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const explicit = parseTriStateFlag(env.PERSONA_SECRET_DISCOVERY_ENABLED);
  if (explicit === false) return false;
  if (explicit === true) {
    // Discovery never outruns Boundary isolation.
    return isPersonaSecretBoundaryEnabled(opts, env);
  }
  // Unset: always OFF (no development auto-enable fallback).
  return false;
}
