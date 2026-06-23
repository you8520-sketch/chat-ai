import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { incrementCharacterTotalTurns } from "@/lib/characterEngagementStats";
import { getLastTurnMessageIds } from "@/lib/chatAccess";
import { getChatMemoryCapacity } from "@/lib/memory/memory-capacity";
import { reconcileMemoryAfterTurnDelete } from "@/lib/memory/memory-reconcile";
import { resolveMemoryTier } from "@/lib/memory/memory-manager";
import { isMemoryFeatureEnabled } from "@/lib/memory/memory-feature";

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { chatId } = await req.json();
  const cId = Number(chatId);
  if (!cId) return NextResponse.json({ error: "chatId가 필요합니다." }, { status: 400 });

  const db = getDb();
  const chat = db
    .prepare("SELECT id, character_id FROM chats WHERE id=? AND user_id=?")
    .get(cId, user.id) as { id: number; character_id: number } | undefined;
  if (!chat) return NextResponse.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });

  const character = db
    .prepare("SELECT name FROM characters WHERE id=?")
    .get(chat.character_id) as { name: string } | undefined;

  const lastTurn = getLastTurnMessageIds(cId);
  if (!lastTurn) {
    return NextResponse.json({ error: "삭제할 대화 턴이 없습니다." }, { status: 400 });
  }

  const idsToDelete = [lastTurn.userId];
  if (lastTurn.assistantId != null) idsToDelete.push(lastTurn.assistantId);

  db.transaction(() => {
    for (const id of idsToDelete) {
      db.prepare("DELETE FROM bookmarks WHERE message_id=?").run(id);
      db.prepare("DELETE FROM messages WHERE id=? AND chat_id=?").run(id, cId);
    }
    if (lastTurn.userId != null) {
      incrementCharacterTotalTurns(db, chat.character_id, -1);
    }
  })();

  if (isMemoryFeatureEnabled()) {
    try {
      reconcileMemoryAfterTurnDelete({
        chatId: cId,
        userId: user.id,
        characterId: chat.character_id,
        charName: character?.name ?? "캐릭터",
        tier: resolveMemoryTier(user),
        memoryCapacity: getChatMemoryCapacity(cId),
      });
    } catch (e) {
      console.warn("[memory] reconcile after turn delete failed:", (e as Error).message);
    }
  }

  return NextResponse.json({ ok: true, deletedIds: idsToDelete });
}
