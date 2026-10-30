import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/adminAuth";
import type { SessionUser } from "@/lib/characterFormSave";
import { saveHeldAdminAuthorPreview } from "@/lib/officialSupply/adminAuthorDraft";

export const dynamic = "force-dynamic";

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
  const actor: SessionUser = {
    id: admin.id,
    nickname: admin.nickname,
    is_adult: admin.is_adult,
    email: admin.email,
    is_admin: admin.is_admin,
    account_kind: admin.account_kind,
  };
  const saved = await saveHeldAdminAuthorPreview(actor, previewId);
  if (!saved.ok) {
    return NextResponse.json(
      {
        error: saved.error,
        ...(saved.characterId != null
          ? { characterId: saved.characterId, editPath: `/create?edit=${saved.characterId}` }
          : {}),
        ...(saved.partialSave ? { partialSave: true } : {}),
      },
      { status: saved.status }
    );
  }
  return NextResponse.json({
    ok: true,
    characterId: saved.characterId,
    alreadySaved: saved.alreadySaved,
    editPath: `/create?edit=${saved.characterId}`,
  });
}
