import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertMessageAccess } from "@/lib/chatAccess";
import { defaultForkTitle, sanitizeChatTitle } from "@/lib/chatTitle";
import { DEFAULT_TARGET_RESPONSE_CHARS, normalizeTargetResponseChars } from "@/lib/responseLength";
import { MEMORY_CAPACITY_DEFAULT, normalizeMemoryCapacity } from "@/lib/memory/memory-capacity-shared";
import {
  countCompletedTurnsUpToMessageId,
  copyForkTurnSummaries,
  initializeForkChatMemory,
} from "@/lib/memory/memory-fork-snapshot";
import { resolveMemoryTier } from "@/lib/memory/memory-manager";
import { isMemoryFeatureEnabled } from "@/lib/memory/memory-feature";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { chatId, messageId, title: titleInput } = await req.json();
  const cId = Number(chatId);
  const mId = Number(messageId);
  if (!cId || !mId) {
    return NextResponse.json({ error: "chatId와 messageId가 필요합니다." }, { status: 400 });
  }

  const msg = assertMessageAccess(user.id, mId);
  if (!msg || msg.chat_id !== cId) {
    return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  }

  const db = getDb();
  const source = db
    .prepare("SELECT * FROM chats WHERE id=? AND user_id=?")
    .get(cId, user.id) as Record<string, unknown> | undefined;
  if (!source) return NextResponse.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });

  const toCopy = db
    .prepare(
      `SELECT id, role, content, model, usage, status, is_refunded, deduction_slices
       FROM messages WHERE chat_id=? AND id <= ? ORDER BY id ASC`
    )
    .all(cId, mId) as {
    id: number;
    role: string;
    content: string;
    model: string;
    usage: string | null;
    status: string | null;
    is_refunded: number;
    deduction_slices: string | null;
  }[];

  if (toCopy.length === 0) {
    return NextResponse.json({ error: "복사할 메시지가 없습니다." }, { status: 400 });
  }

  const branchTitle = sanitizeChatTitle(titleInput) || defaultForkTitle();
  const characterId = Number(source.character_id);
  const memoryCapacity = normalizeMemoryCapacity(source.memory_capacity ?? MEMORY_CAPACITY_DEFAULT);
  const forkTurnCount = countCompletedTurnsUpToMessageId(toCopy, mId);

  const forkResult = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO chats (user_id, character_id, mode, memory, memory_pending, memory_meta,
          memory_archived_turns, current_summary, gemini_model, user_note, selected_persona_id, user_impersonation,
          target_response_chars, title, writing_style_override, memory_capacity)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        user.id,
        characterId,
        source.mode ?? "safe",
        "",
        "[]",
        source.memory_meta ?? "{}",
        0,
        "",
        "",
        source.user_note ?? "",
        source.selected_persona_id ?? null,
        source.user_impersonation ?? 0,
        normalizeTargetResponseChars(source.target_response_chars ?? DEFAULT_TARGET_RESPONSE_CHARS),
        branchTitle,
        String(source.writing_style_override ?? ""),
        memoryCapacity
      );
    const newChatId = Number(info.lastInsertRowid);
    const messageIdMap = new Map<number, number>();

    const ins = db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, usage, status, is_refunded, deduction_slices)
       VALUES (?,?,?,?,?,?,?,?)`
    );
    for (const m of toCopy) {
      const result = ins.run(
        newChatId,
        m.role,
        m.content,
        m.model ?? "",
        m.usage,
        m.status ?? "ok",
        m.is_refunded ?? 0,
        m.deduction_slices
      );
      messageIdMap.set(m.id, Number(result.lastInsertRowid));
    }

    const copiedSummaryPages = copyForkTurnSummaries(db, {
      sourceChatId: cId,
      newChatId,
      forkTurnCount,
      messageIdMap,
    });

    return { newChatId, forkTurnCount, copiedSummaryPages };
  })();

  if (isMemoryFeatureEnabled()) {
    const tier = resolveMemoryTier(user);
    try {
      await initializeForkChatMemory({
        newChatId: forkResult.newChatId,
        userId: user.id,
        characterId,
        forkTurnCount: forkResult.forkTurnCount,
        tier,
        memoryCapacity,
      });
    } catch (e) {
      console.warn("[fork] memory snapshot init failed:", (e as Error).message);
    }
  }

  return NextResponse.json({
    ok: true,
    chatId: forkResult.newChatId,
    characterId,
    title: branchTitle,
    forkTurnCount: forkResult.forkTurnCount,
    copiedSummaryPages: forkResult.copiedSummaryPages,
  });
}
