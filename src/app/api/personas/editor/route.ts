import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getPersonaSecretSettingsCapability } from "@/lib/personaSecretCapabilities";
import { toEditorPersonaClientRows } from "@/lib/personaSecretSerialization";
import { ensureDefaultEditorPersona } from "@/lib/userPersonas";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const capability = getPersonaSecretSettingsCapability(user.id);
  if (!capability.canEdit) {
    return NextResponse.json(
      { error: "비밀 설정은 현재 사용할 수 없습니다.", code: "SECRET_SETTINGS_DISABLED" },
      { status: 403 }
    );
  }

  const personas = ensureDefaultEditorPersona(user.id, user.nickname);
  return NextResponse.json(
    {
      personas: toEditorPersonaClientRows(personas),
      capabilities: { personaSecretSettings: capability },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
