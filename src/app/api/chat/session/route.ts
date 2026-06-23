import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { adjustCharacterStatsOnChatDelete } from "@/lib/characterEngagementStats";

/** 채팅방(분기) 삭제 — 메시지·북마크·환불 요청 포함 */
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = Number(body.chatId);
  if (!chatId) {
    return NextResponse.json({ error: "chatId가 필요합니다." }, { status: 400 });
  }

  const db = getDb();
  const chat = db
    .prepare("SELECT id, character_id FROM chats WHERE id=? AND user_id=?")
    .get(chatId, user.id) as { id: number; character_id: number } | undefined;

  if (!chat) {
    return NextResponse.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });
  }

  db.transaction(() => {
    adjustCharacterStatsOnChatDelete(db, chat.character_id, user.id, chatId);
    db.prepare(
      `DELETE FROM bookmarks
       WHERE message_id IN (SELECT id FROM messages WHERE chat_id=?)`
    ).run(chatId);
    db.prepare("DELETE FROM report_refunds WHERE chat_id=?").run(chatId);
    db.prepare("DELETE FROM messages WHERE chat_id=?").run(chatId);
    db.prepare("DELETE FROM chats WHERE id=? AND user_id=?").run(chatId, user.id);
  })();

  return NextResponse.json({ ok: true, characterId: chat.character_id });
}
