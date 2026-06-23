import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { getSessionUser } from "@/lib/auth";

const MAX_FILES = 100;
const MAX_SIZE = 8 * 1024 * 1024; // 8MB per file
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

// 캐릭터 이미지 업로드 (최대 100장)
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!user.is_adult) return NextResponse.json({ error: "성인인증 후 업로드할 수 있습니다." }, { status: 403 });

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `이미지는 최대 ${MAX_FILES}장까지 업로드할 수 있습니다.` }, { status: 400 });
  }

  const dir = path.join(process.cwd(), "public", "uploads");
  await fs.mkdir(dir, { recursive: true });

  const urls: string[] = [];
  for (const file of files) {
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: `지원하지 않는 형식입니다: ${file.name}` }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: `8MB를 초과하는 파일입니다: ${file.name}` }, { status: 400 });
    }
    const name = `${crypto.randomUUID()}.${EXT[file.type]}`;
    await fs.writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
    urls.push(`/uploads/${name}`);
  }
  return NextResponse.json({ ok: true, urls });
}
