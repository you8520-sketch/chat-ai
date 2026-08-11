/**
 * Persona Secret Boundary + Discovery — ON for all accounts by default.
 * Affects secret settings UI, secret exclusion/reveal, and S1–S4 discovery engine writes.
 *
 * Boundary priority:
 * 1) PERSONA_SECRET_BOUNDARY_ENABLED=0 → force OFF for all users (kill switch)
 * 2) otherwise (unset or =1 / true / on / enabled) → ON for all users
 *
 * Discovery priority:
 * 1) PERSONA_SECRET_DISCOVERY_ENABLED=0 → force OFF for all users (kill switch)
 * 2) otherwise (unset or =1) → ON only when Boundary is also ON for that user
 *
 * When Discovery is OFF but Boundary is ON, legacy marker strip, public-only persona
 * projection, and UNKNOWN secret zero-byte isolation still apply.
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
 * Persona Secret Discovery (S0–S4D engine writes).
 * Default ON for all accounts when unset; never outruns Boundary; =0 is kill switch.
 */
export function isPersonaSecretDiscoveryEnabled(
  opts?: PersonaSecretBoundaryContext,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const explicit = parseTriStateFlag(env.PERSONA_SECRET_DISCOVERY_ENABLED);
  if (explicit === false) return false;
  // unset or explicit ON — still requires Boundary.
  return isPersonaSecretBoundaryEnabled(opts, env);
}
