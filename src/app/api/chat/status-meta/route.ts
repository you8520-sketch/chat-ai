import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  isStatusMetaRecordStalePending,
  loadMessageStatusMeta,
  requeueStatusMetaExtractionIfNeeded,
} from "@/lib/statusMeta/job";
import { statusMetaHasDisplayContent } from "@/lib/statusMeta/render";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const url = new URL(req.url);
  const messageId = Number(url.searchParams.get("messageId"));
  if (!messageId) {
    return NextResponse.json({ error: "messageId가 필요합니다." }, { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT m.status_meta, m.chat_id FROM messages m
       JOIN chats c ON c.id = m.chat_id
       WHERE m.id=? AND c.user_id=? AND m.role='assistant'`
    )
    .get(messageId, user.id) as { status_meta: string | null; chat_id: number } | undefined;

  if (!row) {
    return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  }

  let record = loadMessageStatusMeta(messageId);

  if (
    record &&
    (record.failed === true ||
      (record.pending === true && isStatusMetaRecordStalePending(record)))
  ) {
    requeueStatusMetaExtractionIfNeeded(messageId);
    record = loadMessageStatusMeta(messageId);
  }

  const meta = record?.meta ?? null;
  const formatSpec = record?.formatSpec ?? null;
  const hasContent = statusMetaHasDisplayContent(meta, formatSpec);
  const pending = record?.pending === true && !hasContent;
  const failed = record?.failed === true && !hasContent && !pending;

  return NextResponse.json({
    messageId,
    chatId: row.chat_id,
    pending,
    failed,
    meta: pending ? null : meta,
    formatSpec,
    extractedAt: record?.extractedAt ?? null,
  });
}

