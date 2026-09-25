import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  asyncRecordMatchesGenerationScope,
  resolveActiveAssistantGenerationScope,
} from "@/lib/assistantGenerationScope";
import { loadMessageSuggestedReplies } from "@/lib/suggestedReplies/job";
import { resolveClientSuggestedReplies } from "@/lib/suggestedReplies/parse";

/** Pure read/poll — never starts provider inference. */
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

  const activeScope = resolveActiveAssistantGenerationScope(messageId);
  const rawRecord = loadMessageSuggestedReplies(messageId);
  const record =
    activeScope && asyncRecordMatchesGenerationScope(rawRecord, activeScope) ? rawRecord : null;

  const client = resolveClientSuggestedReplies(record);

  return NextResponse.json({
    messageId,
    chatId: row.chat_id,
    requested: client.suggestedRepliesRequested,
    pending: client.suggestedRepliesPending,
    failed: client.suggestedRepliesFailed,
    replies: client.suggestedRepliesPending ? [] : client.suggestedReplies,
    extractedAt: record?.extractedAt ?? null,
  });
}
