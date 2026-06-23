import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { prompt } = await req.json();
  if (!prompt?.trim()) return NextResponse.json({ error: "프롬프트를 입력하세요." }, { status: 400 });

  return NextResponse.json(
    { error: "이미지 생성은 현재 OpenRouter 전환 중입니다." },
    { status: 503 }
  );
}
