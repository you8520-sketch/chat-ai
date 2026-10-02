import fs from "fs/promises";
import { NextResponse } from "next/server";
import { evaluatePublicMediaAccess } from "@/lib/mediaAccess";
import {
  ensureApprovedPublicRendition,
  ensureLegacyBlurPreviewFromPublicName,
  isPublicRenditionFilename,
  mediaIdFromPublicRenditionFilename,
  resolveExistingPublicMediaPath,
  sanitizeMediaFilename,
} from "@/lib/mediaStorage";

type RouteCtx = { params: Promise<{ filename: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const { filename } = await ctx.params;
  const safe = sanitizeMediaFilename(filename);
  if (!safe) return NextResponse.json({ error: "잘못된 파일명입니다." }, { status: 400 });

  const access = evaluatePublicMediaAccess(safe);
  if (!access.ok) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });

  let filePath = resolveExistingPublicMediaPath(safe);
  if (!filePath && safe.startsWith("legacy-blur-")) {
    const generated = await ensureLegacyBlurPreviewFromPublicName(safe);
    if (generated) filePath = resolveExistingPublicMediaPath(safe);
  }
  if (!filePath && isPublicRenditionFilename(safe)) {
    const mediaId = mediaIdFromPublicRenditionFilename(safe);
    if (mediaId) {
      const generated = await ensureApprovedPublicRendition(mediaId);
      if (generated) filePath = resolveExistingPublicMediaPath(safe);
    }
  }
  if (!filePath) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });

  const body = await fs.readFile(filePath);
  return new Response(body, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

export const dynamic = "force-dynamic";
