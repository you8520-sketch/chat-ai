import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { normalizeMemoryMeta, parseMemoryMeta } from "@/lib/chatMemory";
import { resolveRelationshipMetaNamesForCharacter } from "@/lib/relationshipMetaCharacterName";
import {
  getSubscriptionTier,
  listPublicUserPersonas,
  resolveChatSelectedPersona,
} from "@/lib/userPersonas";
import {
  clearMemoryForChat,
  getMemorySnapshot,
  resolveMemoryTier,
  updateLorebookForChat,
  regenerateMemoryRecordBatch,
  isFallbackMemoryRecordSummary,
} from "@/lib/memory/memory-manager";
import {
  prepareMemoryPanelView,
  scheduleMemoryPanelBackfill,
  syncAndCompressMemoryFromChat,
} from "@/lib/memory/memory-backfill";
import { resolveLorebookFromRecordsSync } from "@/lib/memory/memory-lorebook-resolve";
import { resolveMemoryBudgetFromCapacity } from "@/lib/memory/memory-capacity-shared";
import { getChatMemoryCapacity } from "@/lib/memory/memory-capacity";
import {
  adoptBranchToMainCanon,
  closeActiveBranchCanon,
  closeActiveBranchesExcept,
  listMemoryRecordsForChat,
  listVisibleMemoryRecordsForChat,
  markMemoryRecordInactive,
  MEMORY_RECORD_MAX_CHARS,
  MEMORY_RECORD_MIN_CHARS,
  promoteRecordsToBranchCanon,
  rebuildLorebookFromRecords,
  reopenClosedBranchCanon,
  updateMemoryRecordById,
} from "@/lib/memory/memory-turn-summary";
import { updateChatMemory, getOrCreateChatMemory } from "@/lib/memory/memory-db";
import { reconcileMemoryAfterRecordDelete } from "@/lib/memory/memory-reconcile";
import { countMemoryEligibleCompletedTurns } from "@/lib/memory/memory-turn-loader";
import {
  expectedSealedTurnCount,
  highestContiguousCompletedTurn,
} from "@/lib/memory/memory-summary-integrity";
import {
  loadChatRelationshipMeta,
  removeRelationshipMetaItem,
  saveChatRelationshipMeta,
  type RelationshipMetaCategory,
} from "@/lib/memory/memory-relationship-meta";

async function resolveChatCharacter(chatId: number, userId: number) {
  const db = getDb();
  const chat = db
    .prepare(
      "SELECT id, character_id, memory_meta, memory_capacity, selected_persona_id FROM chats WHERE id=? AND user_id=?"
    )
    .get(chatId, userId) as
    | {
        id: number;
        character_id: number;
        memory_meta: string;
        memory_capacity?: number;
        selected_persona_id: number | null;
      }
    | undefined;
  return chat;
}

function resolveRelationshipMetaNames(
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>,
  chat: { character_id: number; selected_persona_id: number | null },
  chatId: number
) {
  const personas = listPublicUserPersonas(user.id);
  const { persona } = resolveChatSelectedPersona(user, personas, chat.selected_persona_id, chatId);
  const userName = persona?.name?.trim() || user.nickname;
  return resolveRelationshipMetaNamesForCharacter(chat.character_id, userName);
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const chatId = Number(new URL(req.url).searchParams.get("chatId"));
  if (!chatId) return Response.json({ error: "chatId가 필요합니다." }, { status: 400 });

  const chat = await resolveChatCharacter(chatId, user.id);
  if (!chat) return Response.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });

  const db = getDb();
  const charRow = db
    .prepare("SELECT name FROM characters WHERE id=?")
    .get(chat.character_id) as { name: string } | undefined;
  const names = resolveRelationshipMetaNames(user, chat, chatId);
  const tier = resolveMemoryTier(user);
  const memoryCapacity = getChatMemoryCapacity(chatId);

  const backfillOpts = {
    userId: user.id,
    characterId: chat.character_id,
    chatId,
    charName: charRow?.name ?? "캐릭터",
    tier,
    memoryCapacity,
  };
  prepareMemoryPanelView(backfillOpts);
  const eligibleTurnCount = countMemoryEligibleCompletedTurns(chatId);
  const allRecords = listMemoryRecordsForChat(chatId);
  const activeContiguous = highestContiguousCompletedTurn(allRecords, eligibleTurnCount);
  const expectedSealed = expectedSealedTurnCount(eligibleTurnCount);
  // Missing sealed batch(es) for current playable turns — e.g. 8 turns but no [1~6].
  // Do NOT require visible UI rows empty; empty_ooc / soft-delete drift also counts.
  const needsSealCatchUp = activeContiguous < expectedSealed;

  const explicitBackfill = new URL(req.url).searchParams.get("backfill") === "1";
  const awaitCatchUp = new URL(req.url).searchParams.get("awaitCatchUp") === "1";
  let sealCatchUp: {
    attempted: boolean;
    ok: boolean;
    error: string | null;
  } = { attempted: false, ok: false, error: null };

  // Auto-fill: if playable turns already cover a sealed window but history is
  // missing (e.g. 8 turns, no [1~6]), await seal here — do not ask the user to
  // click, and do not fire-and-forget (that raced with a busy lock and failed instantly).
  if (needsSealCatchUp) {
    sealCatchUp.attempted = true;
    try {
      const ok = await syncAndCompressMemoryFromChat(backfillOpts);
      const afterEligible = countMemoryEligibleCompletedTurns(chatId);
      const after = highestContiguousCompletedTurn(
        listMemoryRecordsForChat(chatId),
        afterEligible
      );
      sealCatchUp.ok = after >= expectedSealedTurnCount(afterEligible);
      if (!sealCatchUp.ok) {
        sealCatchUp.error = ok
          ? "요약 배치가 아직 비어 있습니다. 패널을 다시 열면 자동으로 재시도합니다."
          : "요약 생성에 실패했습니다. 패널을 다시 열면 자동으로 재시도합니다.";
      }
    } catch (e) {
      sealCatchUp.error = (e as Error).message || "요약 생성 중 오류";
    }
  } else if (explicitBackfill || awaitCatchUp) {
    scheduleMemoryPanelBackfill(backfillOpts);
  }

  const eligibleAfter = countMemoryEligibleCompletedTurns(chatId);
  const activeContiguousAfter = highestContiguousCompletedTurn(
    listMemoryRecordsForChat(chatId),
    eligibleAfter
  );
  const expectedSealedAfter = expectedSealedTurnCount(eligibleAfter);
  const stillDue = activeContiguousAfter < expectedSealedAfter;
  const memoryRecords = listVisibleMemoryRecordsForChat(chatId);
  const memRow = getOrCreateChatMemory(chatId, user.id, chat.character_id, tier);
  const summarizedTurnCount = memRow.summarized_turn_count ?? 0;

  const rawMeta = parseMemoryMeta(chat.memory_meta);
  const meta = normalizeMemoryMeta(rawMeta, names);
  if (JSON.stringify(rawMeta) !== JSON.stringify(meta)) {
    saveChatRelationshipMeta(chatId, meta);
  }
  const snapshot = getMemorySnapshot(chatId, user.id, chat.character_id, tier, memoryCapacity);
  const lorebookBudget = resolveMemoryBudgetFromCapacity(memoryCapacity).lorebook;
  const displayLorebook =
    resolveLorebookFromRecordsSync(chatId, lorebookBudget).text ||
    snapshot.lorebook.trim();
  const displayText = displayLorebook.trim();

  const displayMeta = { ...meta, currentLocation: undefined };

  return Response.json({
    longTerm: displayText,
    lorebook: displayLorebook,
    recentSummary: displayLorebook,
    currentMemory: displayLorebook,
    archiveSummary: snapshot.archiveSummary,
    meta: displayMeta,
    limit: snapshot.limit,
    memoryCapacity: snapshot.memoryCapacity,
    tier: snapshot.tier,
    longTermChars: displayText.length,
    totalTurns: eligibleAfter,
    eligibleTurnCount: eligibleAfter,
    summarizedTurnCount,
    expectedSealedTurnCount: expectedSealedAfter,
    activeContiguousTurnCount: activeContiguousAfter,
    summarySealDue: stillDue,
    sealCatchUp,
    bufferCount: snapshot.bufferCount,
    messagesUntilCompression: snapshot.messagesUntilCompression,
    budget: snapshot.budget,
    subscriptionTier: getSubscriptionTier(user),
    memoryRecords: memoryRecords.map((r) => ({
      ...r,
      isFallbackSummary: isFallbackMemoryRecordSummary(r.summary),
    })),
    memoryRecordMinChars: MEMORY_RECORD_MIN_CHARS,
    memoryRecordMaxChars: MEMORY_RECORD_MAX_CHARS,
    // legacy fields for older clients
    turnSummaries: memoryRecords.map((r) => ({
      id: r.id,
      turnNumber: r.turnStart,
      summary: r.summary,
      userEdited: r.userEdited,
      charCount: r.charCount,
    })),
    turnSummaryMaxChars: MEMORY_RECORD_MAX_CHARS,
  });
}

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const chatId = Number(body.chatId);
  const action = body.action as
    | "updateLorebook"
    | "clear"
    | "updateMemoryRecord"
    | "updateTurnSummary"
    | "regenerateMemoryRecord"
    | "catchUpSummary"
    | "deleteRelationshipMetaItem"
    | "continueBranch"
    | "reopenBranch"
    | "adoptMainCanon"
    | "keepNoncanon"
    | "deleteMemoryRecord"
    | undefined;

  if (!chatId) return Response.json({ error: "chatId가 필요합니다." }, { status: 400 });

  const chat = await resolveChatCharacter(chatId, user.id);
  if (!chat) return Response.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });

  const tier = resolveMemoryTier(user);
  const memoryCapacity = getChatMemoryCapacity(chatId);

  if (action === "clear") {
    clearMemoryForChat(chatId, user.id, chat.character_id, tier);
    const snapshot = getMemorySnapshot(chatId, user.id, chat.character_id, tier, memoryCapacity);
    return Response.json({ ok: true, ...snapshot });
  }

  if (action === "catchUpSummary") {
    const charRow = getDb()
      .prepare("SELECT name FROM characters WHERE id=?")
      .get(chat.character_id) as { name: string } | undefined;
    const opts = {
      userId: user.id,
      characterId: chat.character_id,
      chatId,
      charName: charRow?.name ?? "캐릭터",
      tier,
      memoryCapacity,
    };
    prepareMemoryPanelView(opts);
    try {
      await syncAndCompressMemoryFromChat(opts);
    } catch (e) {
      return Response.json(
        { error: (e as Error).message || "요약 생성에 실패했습니다." },
        { status: 500 }
      );
    }
    const eligible = countMemoryEligibleCompletedTurns(chatId);
    const contiguous = highestContiguousCompletedTurn(
      listMemoryRecordsForChat(chatId),
      eligible
    );
    const expected = expectedSealedTurnCount(eligible);
    const lorebook = rebuildLorebookFromRecords(chatId);
    const records = listVisibleMemoryRecordsForChat(chatId);
    if (contiguous < expected) {
      return Response.json(
        {
          ok: false,
          error:
            "요약이 아직 생성되지 않았습니다. 잠시 후 다시 시도하거나 대화를 한 턴 더 진행해 주세요.",
          lorebook,
          memoryRecords: records,
          eligibleTurnCount: eligible,
          summarizedTurnCount: contiguous,
          expectedSealedTurnCount: expected,
        },
        { status: 409 }
      );
    }
    return Response.json({
      ok: true,
      lorebook,
      memoryRecords: records,
      eligibleTurnCount: eligible,
      summarizedTurnCount: contiguous,
      expectedSealedTurnCount: expected,
    });
  }

  if (action === "updateLorebook") {
    const lorebook = typeof body.lorebook === "string" ? body.lorebook : "";
    const snapshot = await updateLorebookForChat(
      chatId,
      user.id,
      chat.character_id,
      lorebook,
      tier,
      memoryCapacity
    );
    return Response.json({ ok: true, ...snapshot });
  }

  if (action === "updateMemoryRecord" || action === "updateTurnSummary") {
    const recordId = Number(body.recordId ?? body.summaryId);
    const summary = typeof body.summary === "string" ? body.summary : "";
    if (!recordId) return Response.json({ error: "recordId가 필요합니다." }, { status: 400 });
    const updated = updateMemoryRecordById(chatId, recordId, summary);
    if (!updated) {
      return Response.json(
        { error: `기억 기록은 ${MEMORY_RECORD_MIN_CHARS}~${MEMORY_RECORD_MAX_CHARS}자여야 합니다.` },
        { status: 400 }
      );
    }
    return Response.json({ ok: true, memoryRecord: updated, turnSummary: updated });
  }

  if (action === "regenerateMemoryRecord") {
    const recordId = Number(body.recordId ?? body.summaryId);
    const turnStart = Number(body.turnStart);
    const record = recordId
      ? listMemoryRecordsForChat(chatId).find((r) => r.id === recordId)
      : turnStart
        ? listMemoryRecordsForChat(chatId).find((r) => r.turnStart === turnStart)
        : undefined;
    if (!record) {
      return Response.json({ error: "기억 기록을 찾을 수 없습니다." }, { status: 404 });
    }
    if (record.userEdited) {
      return Response.json({ error: "직접 수정한 기록은 자동 재생성할 수 없습니다." }, { status: 400 });
    }
    const charRow = getDb()
      .prepare("SELECT name FROM characters WHERE id=?")
      .get(chat.character_id) as { name: string } | undefined;
    const ok = await regenerateMemoryRecordBatch({
      chatId,
      userId: user.id,
      characterId: chat.character_id,
      charName: charRow?.name ?? "캐릭터",
      tier,
      memoryCapacity,
      turnStart: record.turnStart,
    });
    if (!ok) {
      return Response.json(
        { error: "요약 재생성에 실패했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 502 }
      );
    }
    const refreshed = listMemoryRecordsForChat(chatId).find((r) => r.id === record.id);
    return Response.json({ ok: true, memoryRecord: refreshed, turnSummary: refreshed });
  }

  if (action === "deleteRelationshipMetaItem") {
    const category = body.category as RelationshipMetaCategory | undefined;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!category || !["items", "thoughts", "promises"].includes(category)) {
      return Response.json({ error: "category(items|thoughts|promises)가 필요합니다." }, { status: 400 });
    }
    if (!text) return Response.json({ error: "text가 필요합니다." }, { status: 400 });
    const names = resolveRelationshipMetaNames(user, chat, chatId);
    const prev = loadChatRelationshipMeta(chatId, names);
    const next = removeRelationshipMetaItem(prev, category, text);
    saveChatRelationshipMeta(chatId, next);
    return Response.json({ ok: true, meta: { ...next, currentLocation: undefined } });
  }

  if (action === "continueBranch") {
    const recordId = Number(body.recordId);
    if (!recordId) return Response.json({ error: "recordId가 필요합니다." }, { status: 400 });
    const branchId = `branch-${chatId}-${recordId}-${Date.now()}`;
    const n = promoteRecordsToBranchCanon({
      chatId,
      recordIds: [recordId],
      branchId,
      promotedBy: "user_ui_continue",
      control: { source: "ui" },
    });
    if (n < 1) return Response.json({ error: "분기 승격에 실패했습니다." }, { status: 400 });
    closeActiveBranchesExcept(chatId, branchId);
    const lorebook = rebuildLorebookFromRecords(chatId);
    updateChatMemory(chatId, user.id, chat.character_id, { recent_summary: lorebook, membership_tier: tier });
    const refreshed = listMemoryRecordsForChat(chatId).find((r) => r.id === recordId);
    return Response.json({ ok: true, memoryRecord: refreshed, lorebook });
  }

  if (action === "reopenBranch") {
    const recordId = Number(body.recordId);
    const branchIdRaw = typeof body.branchId === "string" ? body.branchId.trim() : "";
    if (!recordId && !branchIdRaw) {
      return Response.json({ error: "recordId 또는 branchId가 필요합니다." }, { status: 400 });
    }
    if (recordId) {
      const row = listMemoryRecordsForChat(chatId).find((r) => r.id === recordId);
      if (!row || row.inactive) {
        return Response.json({ error: "기록을 찾을 수 없습니다." }, { status: 404 });
      }
      if (row.summaryKind !== "branch_canon") {
        return Response.json({ error: "종료된 분기 기록만 다시 이어갈 수 있습니다." }, { status: 400 });
      }
      if (!row.branchId?.trim()) {
        return Response.json({ error: "branch_id가 없습니다." }, { status: 400 });
      }
    }
    const result = reopenClosedBranchCanon({
      chatId,
      recordId: recordId || null,
      branchId: branchIdRaw || null,
      source: "ui_reopen",
    });
    if (!result.ok) {
      return Response.json({ error: "분기 재개에 실패했습니다.", reason: result.reason }, { status: 400 });
    }
    const lorebook = rebuildLorebookFromRecords(chatId);
    updateChatMemory(chatId, user.id, chat.character_id, {
      recent_summary: lorebook,
      membership_tier: tier,
    });
    const refreshed = recordId
      ? listMemoryRecordsForChat(chatId).find((r) => r.id === recordId)
      : listMemoryRecordsForChat(chatId).find((r) => r.branchId === result.branchId);
    return Response.json({
      ok: true,
      branchId: result.branchId,
      memoryRecord: refreshed,
      lorebook,
    });
  }

  if (action === "adoptMainCanon") {
    const recordId = Number(body.recordId);
    if (!recordId) return Response.json({ error: "recordId가 필요합니다." }, { status: 400 });
    const ok = adoptBranchToMainCanon({
      chatId,
      recordId,
      promotedBy: "user_ui_adopt",
    });
    if (!ok) return Response.json({ error: "본편 반영에 실패했습니다." }, { status: 400 });
    const lorebook = rebuildLorebookFromRecords(chatId);
    updateChatMemory(chatId, user.id, chat.character_id, { recent_summary: lorebook, membership_tier: tier });
    const refreshed = listMemoryRecordsForChat(chatId).find((r) => r.id === recordId);
    return Response.json({ ok: true, memoryRecord: refreshed, lorebook });
  }

  if (action === "keepNoncanon") {
    closeActiveBranchCanon(chatId, { source: "ui" });
    const lorebook = rebuildLorebookFromRecords(chatId);
    updateChatMemory(chatId, user.id, chat.character_id, { recent_summary: lorebook, membership_tier: tier });
    return Response.json({ ok: true, lorebook });
  }

  if (action === "deleteMemoryRecord") {
    const recordId = Number(body.recordId);
    if (!recordId) return Response.json({ error: "recordId가 필요합니다." }, { status: 400 });
    if (!markMemoryRecordInactive(chatId, recordId)) {
      return Response.json({ error: "기록을 찾을 수 없습니다." }, { status: 404 });
    }
    const db = getDb();
    const charRow = db
      .prepare("SELECT name FROM characters WHERE id=?")
      .get(chat.character_id) as { name: string } | undefined;
    reconcileMemoryAfterRecordDelete({
      chatId,
      userId: user.id,
      characterId: chat.character_id,
      charName: charRow?.name ?? "캐릭터",
      tier,
      memoryCapacity,
    });
    const lorebook = rebuildLorebookFromRecords(chatId);
    return Response.json({ ok: true, lorebook });
  }

  return Response.json(
    {
      error:
        "action이 필요합니다. (updateLorebook | updateMemoryRecord | regenerateMemoryRecord | catchUpSummary | continueBranch | reopenBranch | adoptMainCanon | keepNoncanon | deleteMemoryRecord | deleteRelationshipMetaItem | clear)",
    },
    { status: 400 }
  );
}
