import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createCharacterFromForm } from "@/lib/characterFormSave";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const b = await req.json();
  const result = await createCharacterFromForm(user, b);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    id: result.id,
    visibility: result.visibility,
    requestedVisibility: result.requestedVisibility,
    moderationStatus: result.moderationStatus,
    moderationNote: result.moderationNote,
    sharePath: result.sharePath,
    listed: result.listed,
  });
}
