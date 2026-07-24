/**
 * Persona Secret Boundary rollout — default OFF in production.
 * Affects secret exclusion + chat-scoped reveal only; does not alter Canon rollout.
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

export function isPersonaSecretBoundaryEnabled(
  opts?: PersonaSecretBoundaryContext,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = env.PERSONA_SECRET_BOUNDARY_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "disabled") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "enabled") return true;

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

  return env.NODE_ENV !== "production";
}
