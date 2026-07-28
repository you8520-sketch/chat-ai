import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getPersonaSecretSettingsCapability } from "@/lib/personaSecretCapabilities";
import { toEditorPersonaClientRow } from "@/lib/personaSecretSerialization";
import { getPersonaById } from "@/lib/userPersonas";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const personaId = Number((await params).id);
  if (!personaId) return NextResponse.json({ error: "잘못된 페르소나 ID입니다." }, { status: 400 });

  const capability = getPersonaSecretSettingsCapability(user.id);
  if (!capability.canEdit) {
    return NextResponse.json(
      { error: "비밀 설정은 현재 사용할 수 없습니다.", code: "SECRET_SETTINGS_DISABLED" },
      { status: 403 }
    );
  }

  const persona = getPersonaById(user.id, personaId);
  if (!persona) return NextResponse.json({ error: "페르소나를 찾을 수 없습니다." }, { status: 404 });

  return NextResponse.json(
    {
      persona: toEditorPersonaClientRow(persona),
      capabilities: { personaSecretSettings: capability },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
