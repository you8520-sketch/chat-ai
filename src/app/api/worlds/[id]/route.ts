import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { parseGenresJson } from "@/lib/characterGenres";
import {
  WORLD_CONTENT_LIMIT,
  WORLD_NAME_LIMIT,
  WORLD_SELECT_COLUMNS,
  WORLD_SUMMARY_LIMIT,
  parseWorldTrpgFlags,
  rowToWorldListItem,
  type WorldRow,
} from "@/lib/worlds";

type RouteCtx = { params: Promise<{ id: string }> };

function loadOwnedWorld(db: ReturnType<typeof getDb>, userId: number, id: number): WorldRow | undefined {
  return db
    .prepare(
      `SELECT ${WORLD_SELECT_COLUMNS}
       FROM worlds WHERE id = ? AND creator_id = ?`
    )
    .get(id, userId) as WorldRow | undefined;
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });

  const row = loadOwnedWorld(getDb(), user.id, id);
  if (!row) return NextResponse.json({ error: "세계관을 찾을 수 없습니다." }, { status: 404 });

  return NextResponse.json({ world: rowToWorldListItem(row) });
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!user.is_adult) {
    return NextResponse.json({ error: "세계관 수정은 성인인증 완료 후 가능합니다." }, { status: 403 });
  }

  const id = Number((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });

  const db = getDb();
  const existing = loadOwnedWorld(db, user.id, id);
  if (!existing) return NextResponse.json({ error: "세계관을 찾을 수 없습니다." }, { status: 404 });

  const b = await req.json();
  const name = b.name != null ? String(b.name).trim().slice(0, WORLD_NAME_LIMIT) : existing.name;
  const summary = b.summary != null ? String(b.summary).trim().slice(0, WORLD_SUMMARY_LIMIT) : existing.summary;
  const content = b.content != null ? String(b.content).trim() : existing.content;
  const trpgFlags =
    b.trpgEnabled != null || b.trpgVisibility != null
      ? parseWorldTrpgFlags({
          trpgEnabled: b.trpgEnabled ?? existing.trpg_enabled,
          trpgVisibility: b.trpgVisibility ?? existing.trpg_visibility,
        })
      : {
          trpgEnabled: Number(existing.trpg_enabled ?? 0) === 1 ? 1 : 0,
          trpgVisibility: Number(existing.trpg_enabled ?? 0) === 1 ? "public" : "private",
        };
  const genresJson = JSON.stringify(
    parseGenresJson(trpgFlags.trpgEnabled ? (b.genres ?? existing.genres) : [])
  );

  if (!name) return NextResponse.json({ error: "세계관 이름을 입력해 주세요." }, { status: 400 });
  if (!content) return NextResponse.json({ error: "세계관 본문을 입력해 주세요." }, { status: 400 });
  if (content.length > WORLD_CONTENT_LIMIT) {
    return NextResponse.json(
      { error: `세계관 본문은 ${WORLD_CONTENT_LIMIT.toLocaleString()}자 이하여야 합니다.` },
      { status: 400 }
    );
  }

  db.prepare(
    `UPDATE worlds SET name = ?, summary = ?, content = ?, trpg_enabled = ?, trpg_visibility = ?, genres = ?, updated_at = datetime('now') WHERE id = ? AND creator_id = ?`
  ).run(name, summary, content, trpgFlags.trpgEnabled, trpgFlags.trpgVisibility, genresJson, id, user.id);

  const row = loadOwnedWorld(db, user.id, id)!;
  return NextResponse.json({ ok: true, world: rowToWorldListItem(row) });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });

  const db = getDb();
  const existing = loadOwnedWorld(db, user.id, id);
  if (!existing) return NextResponse.json({ error: "세계관을 찾을 수 없습니다." }, { status: 404 });

  db.prepare("DELETE FROM worlds WHERE id = ? AND creator_id = ?").run(id, user.id);
  return NextResponse.json({ ok: true });
}
