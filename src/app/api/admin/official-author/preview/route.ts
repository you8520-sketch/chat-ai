import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/adminAuth";
import { parseAdminAuthorSelection, previewAdminOfficialCharacter } from "@/lib/officialSupply/adminAuthorDraft";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const parsed = parseAdminAuthorSelection(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const preview = await previewAdminOfficialCharacter({ adminUserId: admin.id, adminUser: admin, selection: parsed.selection });
  if (!preview.ok) return NextResponse.json(preview, { status: 422 });
  return NextResponse.json(preview);
}
