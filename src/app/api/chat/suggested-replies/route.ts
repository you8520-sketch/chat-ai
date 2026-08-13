import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  isSuggestedRepliesRecordStalePending,
  loadMessageSuggestedReplies,
  requeueSuggestedRepliesExtractionIfNeeded,
} from "@/lib/suggestedReplies/job";
import {
  normalizeSuggestedReplies,
  suggestedRepliesHaveContent,
} from "@/lib/suggestedReplies/parse";

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
      `SELECT m.suggested_replies_json, m.chat_id FROM messages m
       JOIN chats c ON c.id = m.chat_id
       WHERE m.id=? AND c.user_id=? AND m.role='assistant'`
    )
    .get(messageId, user.id) as
    | { suggested_replies_json: string | null; chat_id: number }
    | undefined;

  if (!row) {
    return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  }

  let record = loadMessageSuggestedReplies(messageId);

  if (
    record &&
    (record.failed === true ||
      (record.pending === true && isSuggestedRepliesRecordStalePending(record)))
  ) {
    requeueSuggestedRepliesExtractionIfNeeded(messageId);
    record = loadMessageSuggestedReplies(messageId);
  }

  const replies = normalizeSuggestedReplies(record);
  const hasContent = suggestedRepliesHaveContent(replies);
  const pending = record?.pending === true && !hasContent;
  const failed = record?.failed === true && !hasContent && !pending;

  return NextResponse.json({
    messageId,
    chatId: row.chat_id,
    pending,
    failed,
    replies: pending ? [] : replies,
    extractedAt: record?.extractedAt ?? null,
  });
}
