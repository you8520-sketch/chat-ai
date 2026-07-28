import { getPersonaSecretSettingsCapability } from "@/lib/personaSecretCapabilities";
import { toEditorPersonaClientRow } from "@/lib/personaSecretSerialization";
import { getPersonaById } from "@/lib/userPersonas";
import type { OwnerPersonaEditorItem } from "@/lib/userPersonasClient";
import type { PersonaSecretSettingsCapability } from "@/lib/personaSecretCapabilities";

export type OwnerPersonaEditorAccessResult =
  | {
      ok: true;
      persona: OwnerPersonaEditorItem;
      capability: PersonaSecretSettingsCapability;
    }
  | {
      ok: false;
      status: 401 | 403 | 404;
      error: string;
      code?: "SECRET_SETTINGS_DISABLED";
    };

/** Shared auth/ownership/capability gate for GET /api/personas/[id]/editor. */
export function resolveOwnerPersonaEditorAccess(opts: {
  user: { id: number } | null;
  personaId: number;
}): OwnerPersonaEditorAccessResult {
  if (!opts.user) {
    return { ok: false, status: 401, error: "로그인이 필요합니다." };
  }
  if (!opts.personaId) {
    return { ok: false, status: 404, error: "페르소나를 찾을 수 없습니다." };
  }

  const capability = getPersonaSecretSettingsCapability(opts.user.id);
  if (!capability.canEdit) {
    return {
      ok: false,
      status: 403,
      code: "SECRET_SETTINGS_DISABLED",
      error: "비밀 설정은 현재 사용할 수 없습니다.",
    };
  }

  const persona = getPersonaById(opts.user.id, opts.personaId);
  if (!persona) {
    return { ok: false, status: 404, error: "페르소나를 찾을 수 없습니다." };
  }

  return {
    ok: true,
    persona: toEditorPersonaClientRow(persona),
    capability,
  };
}
