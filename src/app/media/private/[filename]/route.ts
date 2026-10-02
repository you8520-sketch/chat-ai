import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { evaluatePrivateMediaAccess } from "@/lib/mediaAccess";
import { resolveExistingPrivateMediaPath, sanitizeMediaFilename } from "@/lib/mediaStorage";

type RouteCtx = { params: Promise<{ filename: string }> };

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(_req: Request, ctx: RouteCtx) {
  const { filename } = await ctx.params;
  const safe = sanitizeMediaFilename(filename);
  if (!safe) return NextResponse.json({ error: "잘못된 파일명입니다." }, { status: 400 });

  const user = await getSessionUser();
  const access = evaluatePrivateMediaAccess(user, safe);
  if (!access.ok) {
    return NextResponse.json({ error: "접근할 수 없습니다." }, { status: 403 });
  }

  const filePath = resolveExistingPrivateMediaPath(safe);
  if (!filePath) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });

  const ext = path.extname(safe).toLowerCase();
  const body = await fs.readFile(filePath);
  return new Response(body, {
    headers: {
      "Content-Type": MIME_BY_EXT[ext] ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
    },
  });
}

export const dynamic = "force-dynamic";
