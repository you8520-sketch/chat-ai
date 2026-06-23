import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  LOREBOOK_NAME_LIMIT,
  LOREBOOK_SUMMARY_LIMIT,
  normalizeLorebookEntries,
  rowToLorebookListItem,
  serializeLorebookEntries,
  type KeywordLorebookRow,
} from "@/lib/keywordLorebooks";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, creator_id, name, summary, entries_json, created_at, updated_at
       FROM keyword_lorebooks WHERE creator_id = ? ORDER BY updated_at DESC, id DESC`
    )
    .all(user.id) as KeywordLorebookRow[];

  return NextResponse.json({ lorebooks: rows.map(rowToLorebookListItem) });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!user.is_adult) {
    return NextResponse.json({ error: "로어북 제작은 성인인증 완료 후 가능합니다." }, { status: 403 });
  }

  const b = await req.json();
  const name = String(b.name ?? "").trim().slice(0, LOREBOOK_NAME_LIMIT);
  const summary = String(b.summary ?? "").trim().slice(0, LOREBOOK_SUMMARY_LIMIT);
  const normalized = normalizeLorebookEntries(b.entries);

  if (!name) return NextResponse.json({ error: "로어북 이름을 입력해 주세요." }, { status: 400 });
  if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });

  const db = getDb();
  const entriesJson = serializeLorebookEntries(normalized.entries);
  const info = db
    .prepare(
      `INSERT INTO keyword_lorebooks (creator_id, name, summary, entries_json, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    )
    .run(user.id, name, summary, entriesJson);

  const id = Number(info.lastInsertRowid);
  const row = db
    .prepare(
      `SELECT id, creator_id, name, summary, entries_json, created_at, updated_at FROM keyword_lorebooks WHERE id = ?`
    )
    .get(id) as KeywordLorebookRow;

  return NextResponse.json({ ok: true, lorebook: rowToLorebookListItem(row), entries: normalized.entries });
}
