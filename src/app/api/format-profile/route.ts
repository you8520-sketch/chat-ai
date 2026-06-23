import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { formatProfileText } from "@/lib/formatProfile";

/** 줄글 → 구조화된 캐릭터 프로필 JSON (DeepSeek V4 Pro / OpenRouter) */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { text } = await req.json();
  if (!text?.trim()) {
    return NextResponse.json({ error: "줄글 텍스트를 입력하세요." }, { status: 400 });
  }
  if (text.length > 20000) {
    return NextResponse.json({ error: "텍스트는 20,000자 이하여야 합니다." }, { status: 400 });
  }

  try {
    const { data, estimated } = await formatProfileText(text);
    return NextResponse.json({ ok: true, profile: data, estimated });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "변환 실패" }, { status: 500 });
  }
}
