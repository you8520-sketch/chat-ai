import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { analyzeAssetBatch } from "@/lib/vision";
import { isStoredAssetUrl } from "@/lib/characterAssets";
import { filenameFromPrivateMediaUrl, readMediaManifest } from "@/lib/mediaStorage";
import { isAdminUser } from "@/lib/isAdminUser";

/** 업로드된 에셋 이미지에 Gemini Vision 감정 태그 부여 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!user.is_adult) return NextResponse.json({ error: "성인인증 후 이용할 수 있습니다." }, { status: 403 });

  const { urls } = await req.json();
  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ error: "분석할 이미지 URL이 없습니다." }, { status: 400 });
  }

  const safe = urls
    .filter((u: unknown) => typeof u === "string")
    .filter((u: string) => isStoredAssetUrl(u))
    .filter((u: string) => {
      if (!u.startsWith("/media/private/")) return true;
      const filename = filenameFromPrivateMediaUrl(u);
      if (!filename) return false;
      const manifest = readMediaManifest(filename);
      if (manifest?.uploadedBy === user.id) return true;
      return isAdminUser(user);
    })
    .slice(0, 100) as string[];

  if (safe.length === 0) {
    return NextResponse.json({ error: "유효한 이미지 URL이 없습니다." }, { status: 400 });
  }

  const assets = await analyzeAssetBatch(safe);
  return NextResponse.json({ ok: true, assets });
}
