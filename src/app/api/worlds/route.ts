import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  WORLD_CONTENT_LIMIT,
  WORLD_NAME_LIMIT,
  WORLD_SUMMARY_LIMIT,
  rowToWorldListItem,
  type WorldRow,
} from "@/lib/worlds";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, creator_id, name, summary, content, created_at, updated_at
       FROM worlds WHERE creator_id = ? ORDER BY updated_at DESC, id DESC`
    )
    .all(user.id) as WorldRow[];

  return NextResponse.json({ worlds: rows.map(rowToWorldListItem) });
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

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    )
    .run(user.id, name, summary, content);

  const id = Number(info.lastInsertRowid);
  const row = db
    .prepare(
      `SELECT id, creator_id, name, summary, content, created_at, updated_at FROM worlds WHERE id = ?`
    )
    .get(id) as WorldRow;

  return NextResponse.json({ ok: true, world: rowToWorldListItem(row) });
}
