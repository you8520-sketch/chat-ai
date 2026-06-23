import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { generateProfileFromText, PROFILE_BIOGRAPHY_LIMIT } from "@/lib/generateProfile";
import { parseImageUrls } from "@/lib/imageUrls";

/** 줄글 → 사이트 공통 프로필 디자인 (로컬 즉시 처리) */
export const maxDuration = 15;
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { rawText, imageUrl, imageUrls } = await req.json();
  if (!rawText?.trim()) {
    return NextResponse.json({ error: "줄글 텍스트를 입력하세요." }, { status: 400 });
  }
  if (rawText.length > PROFILE_BIOGRAPHY_LIMIT) {
    return NextResponse.json(
      { error: `텍스트는 ${PROFILE_BIOGRAPHY_LIMIT.toLocaleString()}자 이하여야 합니다.` },
      { status: 400 }
    );
  }

  const urlInput =
    Array.isArray(imageUrls) && imageUrls.length > 0
      ? imageUrls.join("\n")
      : String(imageUrl || "");
  const parsedUrls = parseImageUrls(urlInput);

  try {
    const { profile, estimated, warning, modelUsed } = await generateProfileFromText(
      rawText,
      urlInput || undefined
    );
    return NextResponse.json({
      ok: true,
      profile,
      imageUrl: parsedUrls[0] ?? null,
      imageUrls: parsedUrls,
      estimated,
      warning: warning ?? null,
      modelUsed: modelUsed ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "변환 실패" }, { status: 500 });
  }
}
