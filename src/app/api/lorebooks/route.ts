import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  creatorLorebookEntryCount,
  insertCreatorLorebookForOwner,
} from "@/lib/creatorLorebook";
import {
  rowToLorebookListItem,
  type KeywordLorebookRow,
} from "@/lib/keywordLorebooks";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, creator_id, name, summary, entries_json, created_at, updated_at
       FROM keyword_lorebooks
       WHERE creator_id = ? AND COALESCE(scope, 'creator') = 'creator'
       ORDER BY updated_at DESC, id DESC`
    )
    .all(user.id) as KeywordLorebookRow[];

  return NextResponse.json({
    lorebooks: rows.map((row) => ({
      ...rowToLorebookListItem(row),
      entryCount: creatorLorebookEntryCount(row.entries_json),
    })),
  });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!user.is_adult) {
    return NextResponse.json({ error: "로어북 제작은 성인인증 완료 후 가능합니다." }, { status: 403 });
  }

  const b = await req.json();
  const db = getDb();
  const created = insertCreatorLorebookForOwner(db, {
    creatorId: user.id,
    name: b.name,
    summary: b.summary,
    keywords: b.keywords,
    content: b.content,
  });
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });

  const row = db
    .prepare(
      `SELECT id, creator_id, name, summary, entries_json, created_at, updated_at FROM keyword_lorebooks WHERE id = ?`
    )
    .get(created.id) as KeywordLorebookRow;

  return NextResponse.json({
    ok: true,
    lorebook: {
      ...rowToLorebookListItem(row),
      entryCount: 1,
    },
    keywords: created.entry.keywords.join("│"),
    content: created.entry.content,
  });
}
