import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { parseGenresJson } from "@/lib/characterGenres";
import { loadUserWorldLibrary } from "@/lib/worldLibrary";
import {
  WORLD_CONTENT_LIMIT,
  WORLD_NAME_LIMIT,
  WORLD_SELECT_COLUMNS,
  WORLD_SUMMARY_LIMIT,
  parseWorldTrpgFlags,
  rowToWorldListItem,
  sanitizeWorldCoverUrl,
  type WorldRow,
} from "@/lib/worlds";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  return NextResponse.json({ worlds: loadUserWorldLibrary(user.id) });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!user.is_adult) {
    return NextResponse.json({ error: "세계관 제작은 성인인증 완료 후 가능합니다." }, { status: 403 });
  }

  const b = await req.json();
  const name = String(b.name ?? "").trim().slice(0, WORLD_NAME_LIMIT);
  const summary = String(b.summary ?? "").trim().slice(0, WORLD_SUMMARY_LIMIT);
  const content = String(b.content ?? "").trim();

  if (!name) return NextResponse.json({ error: "세계관 이름을 입력해 주세요." }, { status: 400 });
  if (!content) return NextResponse.json({ error: "세계관 본문을 입력해 주세요." }, { status: 400 });
  if (content.length > WORLD_CONTENT_LIMIT) {
    return NextResponse.json(
      { error: `세계관 본문은 ${WORLD_CONTENT_LIMIT.toLocaleString()}자 이하여야 합니다.` },
      { status: 400 }
    );
  }

  const { trpgEnabled, trpgVisibility } = parseWorldTrpgFlags(b);
  const genresJson = JSON.stringify(parseGenresJson(b.genres));
  const coverUrl = sanitizeWorldCoverUrl(b.coverUrl ?? b.cover_url);

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility, genres, cover_url, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(user.id, name, summary, content, trpgEnabled, trpgVisibility, genresJson, coverUrl);

  const id = Number(info.lastInsertRowid);
  const row = db
    .prepare(
      `SELECT ${WORLD_SELECT_COLUMNS}
       FROM worlds WHERE id = ?`
    )
    .get(id) as WorldRow;

  return NextResponse.json({ ok: true, world: rowToWorldListItem(row) });
}
