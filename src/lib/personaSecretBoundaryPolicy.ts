/**
 * Persona Secret Boundary rollout — fail-closed by default in every environment.
 * Affects secret exclusion + chat-scoped reveal only; does not alter Canon rollout.
 *
 * Priority:
 * 1) PERSONA_SECRET_BOUNDARY_ENABLED=0 → force OFF for all users
 * 2) PERSONA_SECRET_BOUNDARY_ENABLED=1 → force ON for all users
 * 3) unset + user allowlist / percent canary → ON for matching users only
 * 4) otherwise → OFF
 *
 * Discovery kill switch (`PERSONA_SECRET_DISCOVERY_ENABLED`) gates observer/scene/
 * evidence/visual/investigation/transfer/knowledge-prompt writes. When Discovery is
 * OFF, Boundary still allows legacy marker strip, public-only persona projection,
 * and UNKNOWN secret zero-byte isolation.
 *
 * Discovery is also fail-closed: unset/OFF → OFF; explicit ON only when Boundary is
 * enabled for that user.
 */

export type PersonaSecretBoundaryContext = {
  userId?: number | null;
};

function parseAllowlistUserIds(raw: string | undefined): number[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

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
  const explicit = parseTriStateFlag(env.PERSONA_SECRET_BOUNDARY_ENABLED);
  if (explicit != null) return explicit;

  const userId = opts?.userId;
  if (userId != null && Number.isFinite(userId)) {
    const allowlist = parseAllowlistUserIds(env.PERSONA_SECRET_BOUNDARY_USER_IDS);
    if (allowlist.includes(userId)) return true;

    const pctRaw = env.PERSONA_SECRET_BOUNDARY_CANARY_PERCENT?.trim();
    if (pctRaw) {
      const pct = Number(pctRaw);
      if (Number.isFinite(pct) && pct > 0) {
        const bucket = Math.abs(Math.trunc(userId)) % 100;
        if (bucket < Math.min(100, Math.trunc(pct))) return true;
      }
    }
  }

  return false;
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
