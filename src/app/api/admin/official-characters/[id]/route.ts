import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";
import {
  canAdminManageOfficialCharacter,
  updateOfficialDisplayCreatorNameAsAdmin,
} from "@/lib/officialAdminAccess";
import { getDb } from "@/lib/db";
import { listCharacterCreatorLorebookAttachmentIds } from "@/lib/creatorLorebook";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const characterId = Number((await ctx.params).id);
  if (!Number.isInteger(characterId) || characterId <= 0) {
    return NextResponse.json({ error: "잘못된 캐릭터 ID입니다." }, { status: 400 });
  }

  const row = getDb()
    .prepare(
      `SELECT id, name, tagline, description, greeting, creator_id, creator_name, official,
              visibility, moderation_status, nsfw, updated_at
       FROM characters WHERE id=?`
    )
    .get(characterId) as
    | {
        id: number;
        name: string;
        tagline: string;
        description: string;
        greeting: string;
        creator_id: number | null;
        creator_name: string;
        official: number;
        visibility: string;
        moderation_status: string;
        nsfw: number;
        updated_at: string | null;
      }
    | undefined;
  if (!row) return NextResponse.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
  if (!canAdminManageOfficialCharacter(admin, row)) {
    return NextResponse.json({ error: "공식 캐릭터만 조회할 수 있습니다." }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    character: {
      ...row,
      lorebook_ids: listCharacterCreatorLorebookAttachmentIds(getDb(), row.id),
    },
  });
}

export async function PUT(req: Request, ctx: RouteCtx) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const characterId = Number((await ctx.params).id);
  if (!Number.isInteger(characterId) || characterId <= 0) {
    return NextResponse.json({ error: "잘못된 캐릭터 ID입니다." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = updateOfficialDisplayCreatorNameAsAdmin({
    admin,
    characterId,
    displayCreatorName: String(body.display_creator_name ?? body.displayCreatorName ?? ""),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
