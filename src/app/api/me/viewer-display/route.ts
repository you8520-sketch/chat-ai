import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { resolveViewerDisplayNameForUser } from "@/lib/viewerDisplayName";
import { ensureDefaultPersona, resolveChatSelectedPersona } from "@/lib/userPersonas";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const personas = ensureDefaultPersona(user.id, user.nickname);
  const { persona } = resolveChatSelectedPersona(user, personas, null);
  const displayName = resolveViewerDisplayNameForUser(user);

  return NextResponse.json({
    nickname: user.nickname,
    personaName: persona?.name?.trim() || null,
    displayName,
  });
}
