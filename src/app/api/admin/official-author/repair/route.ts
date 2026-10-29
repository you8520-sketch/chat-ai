import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/adminAuth";
import { repairHeldAdminAuthorPreview } from "@/lib/officialSupply/adminAuthorDraft";

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
  const previewId = body && typeof body === "object" && typeof (body as { previewId?: unknown }).previewId === "string"
    ? (body as { previewId: string }).previewId
    : "";
  if (!previewId) return NextResponse.json({ error: "미리보기를 찾을 수 없습니다." }, { status: 400 });
  const preview = await repairHeldAdminAuthorPreview({ adminUserId: admin.id, previewId });
  if (!preview.ok) return NextResponse.json(preview, { status: 422 });
  return NextResponse.json(preview);
}
