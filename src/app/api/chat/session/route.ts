import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { sanitizeChatTitle } from "@/lib/chatTitle";
import { parseChatSessionDeleteIds } from "@/lib/chatSessionDeleteIds";
import { deleteChatOwnedDerivedRows } from "@/lib/chatOwnedDataCleanup";
import { createExplicitChatSession } from "@/lib/chatSessionExplicitCreate";

/** Explicit “채팅 시작 / 새 채팅” — GET/prefetch must not create rooms. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const characterId = Number(body.characterId);
  if (!characterId) {
    return NextResponse.json({ error: "characterId가 필요합니다." }, { status: 400 });
  }
  const fresh = body.fresh === true || body.fresh === 1 || body.fresh === "1";
  const personaId =
    body.personaId != null && body.personaId !== "" ? Number(body.personaId) : null;

  const result = createExplicitChatSession({
    user,
    characterId,
    fresh,
    personaId: Number.isFinite(personaId) ? personaId : null,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, needVerify: result.needVerify },
      { status: result.status }
    );
  }

  return NextResponse.json({
    ok: true,
    chatId: result.chatId,
    created: result.created,
  });
}

/** 채팅방(분기) 삭제 — 메시지·북마크·환불 요청 포함 */
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = Number(body.chatId);
  const title = sanitizeChatTitle(body.title);
  if (!chatId) {
    return NextResponse.json({ error: "chatId가 필요합니다." }, { status: 400 });
  }

  const db = getDb();
  const chat = db
    .prepare("SELECT id FROM chats WHERE id=? AND user_id=?")
    .get(chatId, user.id) as { id: number } | undefined;

  if (!chat) {
    return NextResponse.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });
  }

  db.prepare("UPDATE chats SET title=? WHERE id=? AND user_id=?").run(title, chatId, user.id);

  return NextResponse.json({ ok: true, chatId, title });
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = parseChatSessionDeleteIds(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const db = getDb();
  const placeholders = parsed.ids.map(() => "?").join(",");
  const ownedChats =
    parsed.scope === "characters"
      ? (db
          .prepare(
            `SELECT id, character_id
             FROM chats
             WHERE user_id=? AND character_id IN (${placeholders})
             ORDER BY id`
          )
          .all(user.id, ...parsed.ids) as Array<{ id: number; character_id: number }>)
      : (db
          .prepare(
            `SELECT id, character_id
             FROM chats
             WHERE user_id=? AND id IN (${placeholders})`
          )
          .all(user.id, ...parsed.ids) as Array<{ id: number; character_id: number }>);

  if (
    ownedChats.length === 0 ||
    (parsed.scope === "chats" && ownedChats.length !== parsed.ids.length)
  ) {
    return NextResponse.json(
      { error: "삭제할 수 없는 대화가 포함되어 있습니다." },
      { status: 404 }
    );
  }

  const chats =
    parsed.scope === "characters"
      ? ownedChats
      : parsed.ids.map((id) => ownedChats.find((chat) => chat.id === id)!);

  db.transaction(() => {
    for (const chat of chats) {
      deleteChatOwnedDerivedRows(db, chat.id, user.id);
    }
  })();

  return NextResponse.json({
    ok: true,
    deletedChatIds: chats.map((chat) => chat.id),
    characterIds: [...new Set(chats.map((chat) => chat.character_id))],
    // Legacy clients expect this field after deleting one chat.
    characterId: chats.length === 1 ? chats[0].character_id : undefined,
  });
}
