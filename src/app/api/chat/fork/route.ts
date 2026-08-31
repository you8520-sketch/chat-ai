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
import { recomputeAndPersistUserCoauthorMode } from "@/lib/userCoauthorState";
import { insertForkChatRow } from "@/lib/chatForkCreate";

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
              status_widget_turn_active, suggested_replies_json,
              user_coauthor_semantics_version
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
    user_coauthor_semantics_version?: number | null;
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
       WHERE chat_id=? AND turn_end IS NOT NULL AND turn_end <= ?
       ORDER BY turn_number ASC`
    )
    .all(cId, memoryEligibleForkTurnCount) as { summary: string }[];
  const forkMemoryMeta = snapshotForkRelationshipMeta({
    parentMemoryMeta: typeof source.memory_meta === "string" ? source.memory_meta : "{}",
    copiedContents: [
      ...toCopy.map((message) => message.content),
      ...eligibleSummaryTexts.map((row) => row.summary),
    ],
  });

  const forkResult = db.transaction(() => {
    const newChatId = insertForkChatRow(db, {
      userId: user.id,
      characterId,
      mode: String(source.mode ?? "safe"),
      memoryPending: "[]",
      memoryMeta: forkMemoryMeta,
      memoryArchivedTurns: 0,
      currentSummary: "",
      geminiModel: "",
      userNote: String(source.user_note ?? ""),
      selectedPersonaId:
        source.selected_persona_id == null ? null : Number(source.selected_persona_id),
      userImpersonation: Number(source.user_impersonation ?? 0),
      targetResponseChars: normalizeTargetResponseChars(
        source.target_response_chars ?? DEFAULT_TARGET_RESPONSE_CHARS
      ),
      title: branchTitle,
      writingStyleOverride: String(source.writing_style_override ?? ""),
      memoryCapacity,
      narrativePov: String(source.narrative_pov ?? "third_person"),
      povCharacterName: String(source.pov_character_name ?? ""),
    });
    const messageIdMap = new Map<number, number>();

    const ins = db.prepare(
      `INSERT INTO messages (
         chat_id, role, content, model, usage, adult_route_meta_json,
         status, is_refunded, deduction_slices, status_meta, status_widget_values_json,
         status_widget_turn_active, suggested_replies_json,
         user_coauthor_semantics_version
       )
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
        m.suggested_replies_json ?? null,
        Number(m.user_coauthor_semantics_version ?? 0)
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

    recomputeAndPersistUserCoauthorMode(db, newChatId);

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
