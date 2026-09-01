import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { toPublicPersonaClientRow } from "@/lib/personaSecretSerialization";
import { setPersonaActiveStatusWidgetPreset } from "@/lib/statusWidgetPresets";
import { getPublicPersonaById } from "@/lib/userPersonas";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const personaId = Number((await params).id);
  if (!Number.isInteger(personaId) || personaId <= 0) {
    return NextResponse.json({ error: "잘못된 페르소나 ID입니다." }, { status: 400 });
  }

  const body = (await req.json()) as { presetId?: unknown };
  const presetId = body.presetId == null || body.presetId === "" ? null : Number(body.presetId);
  if (presetId != null && (!Number.isInteger(presetId) || presetId <= 0)) {
    return NextResponse.json({ error: "잘못된 상태창 ID입니다." }, { status: 400 });
  }

  if (!setPersonaActiveStatusWidgetPreset(user.id, personaId, presetId)) {
    return NextResponse.json(
      { error: presetId == null ? "페르소나를 찾을 수 없습니다." : "상태창을 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  const persona = getPublicPersonaById(user.id, personaId);
  return NextResponse.json({
    ok: true,
    persona: persona ? toPublicPersonaClientRow(persona) : null,
  });
}
