import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertMessageAccess } from "@/lib/chatAccess";
import { defaultForkTitle, sanitizeChatTitle } from "@/lib/chatTitle";
import { DEFAULT_TARGET_RESPONSE_CHARS, normalizeTargetResponseChars } from "@/lib/responseLength";
import { MEMORY_CAPACITY_DEFAULT, normalizeMemoryCapacity } from "@/lib/memory/memory-capacity-shared";
import {
  countCompletedTurnsUpToMessageId,
  countMemoryEligibleCompletedTurnsUpToMessageId,
  copyForkMemoryArtifacts,
  FORK_MEMORY_TURN_INTERVAL,
  initializeForkChatMemory,
  remapForkResetBoundary,
  snapshotForkRelationshipMeta,
} from "@/lib/memory/memory-fork-snapshot";
import { resolveMemoryTier } from "@/lib/memory/memory-manager";
import { isMemoryFeatureEnabled } from "@/lib/memory/memory-feature";
import {
  getMemorySourceBoundaryCore,
  initializeForkMemoryBoundaryCore,
} from "@/lib/memory/memory-source-boundary";
import { filterCanonicalMessageRows } from "@/lib/oocSceneRender";

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
      `SELECT id, role, content, model, usage, adult_route_meta_json, status, is_refunded,
              deduction_slices, user_message_id, status_meta, status_widget_values_json,
              status_widget_turn_active, suggested_replies_json
       FROM messages WHERE chat_id=? AND id <= ? ORDER BY id ASC`
    )
    .all(cId, mId) as {
    id: number;
    role: string;
    content: string;
    model: string;
    usage: string | null;
    adult_route_meta_json: string | null;
    status: string | null;
    is_refunded: number;
    deduction_slices: string | null;
    user_message_id: number | null;
    status_meta: string | null;
    status_widget_values_json: string | null;
    status_widget_turn_active: number | null;
    suggested_replies_json: string | null;
  }[];

  if (toCopy.length === 0) {
    return NextResponse.json({ error: "복사할 메시지가 없습니다." }, { status: 400 });
  }

  const branchTitle = sanitizeChatTitle(titleInput) || defaultForkTitle();
  const characterId = Number(source.character_id);
  const memoryCapacity = normalizeMemoryCapacity(source.memory_capacity ?? MEMORY_CAPACITY_DEFAULT);
  const forkTurnCount = countCompletedTurnsUpToMessageId(toCopy, mId);
  const tier = resolveMemoryTier(user);
  const parentBoundary = getMemorySourceBoundaryCore(db, cId);
  const memoryEligibleForkTurnCount = countMemoryEligibleCompletedTurnsUpToMessageId(
    filterCanonicalMessageRows(toCopy),
    mId,
    parentBoundary.resetAfterMessageId
  );

  const eligibleSummaryTexts = db
    .prepare(
      `SELECT summary FROM chat_turn_summaries
       WHERE chat_id=? AND (turn_number + ?) <= ?
       ORDER BY turn_number ASC`
    )
    .all(cId, FORK_MEMORY_TURN_INTERVAL - 1, memoryEligibleForkTurnCount) as { summary: string }[];
  const forkMemoryMeta = snapshotForkRelationshipMeta({
    parentMemoryMeta: typeof source.memory_meta === "string" ? source.memory_meta : "{}",
    copiedContents: [
      ...toCopy.map((message) => message.content),
      ...eligibleSummaryTexts.map((row) => row.summary),
    ],
  });

  const forkResult = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO chats (user_id, character_id, mode, memory, memory_pending, memory_meta,
          memory_archived_turns, current_summary, gemini_model, user_note, selected_persona_id, user_impersonation,
          target_response_chars, title, writing_style_override, memory_capacity, narrative_pov, pov_character_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        user.id,
        characterId,
        source.mode ?? "safe",
        "",
        "[]",
        forkMemoryMeta,
        0,
        "",
        "",
        source.user_note ?? "",
        source.selected_persona_id ?? null,
        source.user_impersonation ?? 0,
        normalizeTargetResponseChars(source.target_response_chars ?? DEFAULT_TARGET_RESPONSE_CHARS),
        branchTitle,
        String(source.writing_style_override ?? ""),
        memoryCapacity,
        String(source.narrative_pov ?? "third_person"),
        String(source.pov_character_name ?? "")
      );
    const newChatId = Number(info.lastInsertRowid);
    const messageIdMap = new Map<number, number>();

    const ins = db.prepare(
      `INSERT INTO messages (
         chat_id, role, content, model, usage, adult_route_meta_json,
         status, is_refunded, deduction_slices, status_meta, status_widget_values_json,
         status_widget_turn_active, suggested_replies_json
       )
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const m of toCopy) {
      const result = ins.run(
        newChatId,
        m.role,
        m.content,
        m.model ?? "",
        m.usage,
        m.adult_route_meta_json ?? "",
        m.status ?? "ok",
        m.is_refunded ?? 0,
        m.deduction_slices,
        m.status_meta ?? null,
        m.status_widget_values_json ?? "",
        m.status_widget_turn_active ?? 0,
        m.suggested_replies_json ?? null
      );
      messageIdMap.set(m.id, Number(result.lastInsertRowid));
    }

    const childResetAfterMessageId = remapForkResetBoundary({
      parentResetAfterMessageId: parentBoundary.resetAfterMessageId,
      forkMessageId: mId,
      copiedParentMessageIds: toCopy.map((message) => message.id),
      messageIdMap,
    });

    initializeForkMemoryBoundaryCore(db, {
      chatId: newChatId,
      userId: user.id,
      characterId,
      tier,
      resetAfterMessageId: childResetAfterMessageId,
    });

    const { copiedSummaryPages } = copyForkMemoryArtifacts(db, {
      sourceChatId: cId,
      newChatId,
      forkTurnCount: memoryEligibleForkTurnCount,
      forkMessageId: mId,
      parentResetAfterMessageId: parentBoundary.resetAfterMessageId,
      messageIdMap,
    });

    console.info("MEMORY_FORK_BOUNDARY_REMAPPED", {
      source_chat_id: cId,
      child_chat_id: newChatId,
      parent_epoch: parentBoundary.epoch,
      parent_boundary: parentBoundary.resetAfterMessageId,
      child_boundary: childResetAfterMessageId,
      eligible_turn_count: memoryEligibleForkTurnCount,
    });

    return { newChatId, forkTurnCount, memoryEligibleForkTurnCount, copiedSummaryPages };
  })();

  if (isMemoryFeatureEnabled()) {
    try {
      await initializeForkChatMemory({
        newChatId: forkResult.newChatId,
        userId: user.id,
        characterId,
        forkTurnCount: forkResult.memoryEligibleForkTurnCount,
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
