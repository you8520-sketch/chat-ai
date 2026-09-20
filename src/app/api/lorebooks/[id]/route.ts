import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  clearCreatorLorebookCarryoverForLorebook,
  creatorLorebookEntryCount,
  deleteCreatorLorebookAttachmentsForLorebook,
  normalizeCreatorLorebookUnit,
  parseCreatorLorebookUnitEntry,
  serializeCreatorLorebookUnit,
} from "@/lib/creatorLorebook";
import {
  LOREBOOK_NAME_LIMIT,
  LOREBOOK_SUMMARY_LIMIT,
  rowToLorebookListItem,
  type KeywordLorebookRow,
} from "@/lib/keywordLorebooks";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, creator_id, name, summary, entries_json, created_at, updated_at
       FROM keyword_lorebooks
       WHERE id = ? AND creator_id = ? AND COALESCE(scope, 'creator') = 'creator'`
    )
    .get(id, user.id) as KeywordLorebookRow | undefined;

  if (!row) return NextResponse.json({ error: "로어북을 찾을 수 없습니다." }, { status: 404 });

  const entry = parseCreatorLorebookUnitEntry(row.entries_json);
  return NextResponse.json({
    lorebook: {
      ...rowToLorebookListItem(row),
      entryCount: creatorLorebookEntryCount(row.entries_json),
    },
    keywords: entry?.keywords.join("│") ?? "",
    content: entry?.content ?? "",
  });
}

export async function PUT(req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!user.is_adult) {
    return NextResponse.json({ error: "로어북 수정은 성인인증 완료 후 가능합니다." }, { status: 403 });
  }

  const id = Number((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });

  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id FROM keyword_lorebooks
       WHERE id = ? AND creator_id = ? AND COALESCE(scope, 'creator') = 'creator'`
    )
    .get(id, user.id);
  if (!existing) return NextResponse.json({ error: "로어북을 찾을 수 없습니다." }, { status: 404 });

  const b = await req.json();
  const name = String(b.name ?? "").trim().slice(0, LOREBOOK_NAME_LIMIT);
  const summary = String(b.summary ?? "").trim().slice(0, LOREBOOK_SUMMARY_LIMIT);
  const normalized = normalizeCreatorLorebookUnit({
    keywords: b.keywords,
    content: b.content,
  });

  if (!name) return NextResponse.json({ error: "로어북 이름을 입력해 주세요." }, { status: 400 });
  if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });

  db.prepare(
    `UPDATE keyword_lorebooks SET name = ?, summary = ?, entries_json = ?, updated_at = datetime('now')
     WHERE id = ? AND creator_id = ? AND COALESCE(scope, 'creator') = 'creator'`
  ).run(name, summary, serializeCreatorLorebookUnit(normalized.entry), id, user.id);
  clearCreatorLorebookCarryoverForLorebook(db, id);

  const row = db
    .prepare(
      `SELECT id, creator_id, name, summary, entries_json, created_at, updated_at FROM keyword_lorebooks WHERE id = ?`
    )
    .get(id) as KeywordLorebookRow;

  return NextResponse.json({
    ok: true,
    lorebook: {
      ...rowToLorebookListItem(row),
      entryCount: 1,
    },
    keywords: normalized.entry.keywords.join("│"),
    content: normalized.entry.content,
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "잘못된 ID입니다." }, { status: 400 });

  const db = getDb();
  const info = db
    .prepare(
      `DELETE FROM keyword_lorebooks
       WHERE id = ? AND creator_id = ? AND COALESCE(scope, 'creator') = 'creator'`
    )
    .run(id, user.id);
  if (info.changes === 0) {
    return NextResponse.json({ error: "로어북을 찾을 수 없습니다." }, { status: 404 });
  }

  deleteCreatorLorebookAttachmentsForLorebook(db, id);
  clearCreatorLorebookCarryoverForLorebook(db, id);

  return NextResponse.json({ ok: true });
}
