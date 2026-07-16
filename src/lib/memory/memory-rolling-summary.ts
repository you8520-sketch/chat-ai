import { getDb } from "@/lib/db";
import { callGeminiBackground } from "@/lib/ai";
import {
  messagesToTurns,
  splitOpeningPlayableTurns,
  ROLLING_SUMMARY_INTERVAL,
  type DialogueTurn,
  type ChatMessageRow,
} from "@/lib/hybridMemory";
import { ROLLING_SUMMARY_MAX_CHARS, ROLLING_SUMMARY_MIN_CHARS, LOREBOOK_COMPACT_FILL_RATIO } from "./memory-constants";
import { clampMemoryRecordSummary, isFallbackMemoryRecordSummary } from "./memory-summary-clamp";
import { resolveMemoryBudgetFromCapacity } from "./memory-capacity-shared";
import { isMemoryFeatureEnabled } from "./memory-feature";
import {
  loadChatTurnsWithMessageIds,
  rebuildLorebookFromRecords,
  listMemoryRecordsForChat,
} from "./memory-turn-summary";
import {
  isTurnEligibleForMemoryRecord,
  stripOocFromMemorySummary,
} from "./memory-ooc-filter";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import type { MemoryTier } from "./memory-types";
import {
  buildOocOnlyBatchPlaceholder,
  earliestMissingBatchStart,
  highestContiguousCompletedTurn,
  validateSummaryNarrative,
} from "./memory-summary-integrity";
import {
  persistValidatedSummaryBatch,
  reconcileSummarizedTurnCountFromTable,
} from "./memory-summary-persist";

export const ROLLING_SUMMARY_SYSTEM_PROMPT = `[역할]: 롤플레잉 대화의 기억 기록관.
[과업]: 제공된 ${ROLLING_SUMMARY_INTERVAL}턴의 원본 대화를 읽고 사건 흐름 기억 기록 1편을 작성하십시오.
[포함]: 주요 사건 · 감정 변화 · 핵심 대사(따옴표로 짧게) · 관계·세계관 변화
[형식]:
- 대화·세계관에서 날짜를 추론할 수 있으면 첫 줄에 [YYYY-MM-DD]만 단독 출력 (알 수 없으면 생략)
- 본문은 대화·플롯 순서대로 3인칭 서술, 각 구절을 → 로 연결 (예: A가 …했다 → B는 …했다 → …)
- 불릿·키워드 나열 금지. 한 문단 연속 흐름.
[규칙]: 대사 전문 복붙 금지. 요약 본문만 출력.
[캐릭터/유저 식별정보 준수]: 캐릭터/유저 식별정보가 제공되면 성별·호칭·신체 묘사를 절대 뒤집지 마십시오. 남성은 여성형 호칭·신체·복장으로 바꾸지 말고, 여성은 남성형 호칭·신체로 바꾸지 마십시오.
[관계/신체 역할 보존]: 성행위·신체 접촉 턴은 노골적 세부를 길게 기록하지 말고 짧게 압축하십시오. 다만 관계 변화, 감정 변화, 누가 누구를 안았는지, 보호했는지, 주도/수동 역할처럼 이후 맥락에 필요한 방향성은 정확히 보존하십시오. 삽입·피삽입 등 성별/신체 역할을 추측으로 뒤집지 마십시오. 명시되지 않았으면 중립적으로 기록하십시오.
[OOC 제외]: (OOC:) 메타·UI 연출(트위터/SNS/익명함/HTML 목업·RP 중단 등)은 기록하지 마십시오. 현재 RP 장면에서 일어난 사건·감정·관계 변화만 기록하십시오.
[분량]: **최대 ${ROLLING_SUMMARY_MAX_CHARS}자**. 중요한 사건·관계 변화가 많으면 충분히 서술하되, 일상·반복·저중요도 구간(예: 단순 신체 접촉만 이어진 턴)은 짧게 압축해도 됩니다. **${ROLLING_SUMMARY_MAX_CHARS}자를 채우기 위해 불필요한 내용을 늘리지 마십시오.** ${ROLLING_SUMMARY_MAX_CHARS}자를 절대 넘기지 마십시오. 마지막 구절을 중간에 끊지 말고 → 연결 흐름으로 자연스럽게 마무리하십시오.`;

const running = new Set<number>();
const ARROW_SEP = " → ";

function normalizeSummaryText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 해당 채팅방 메시지만 턴으로 변환 */
export function loadTurnsForChat(chatId: number): DialogueTurn[] {
  const rows = getDb()
    .prepare(`SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id ASC`)
    .all(chatId) as ChatMessageRow[];
  return messagesToTurns(rows);
}

/** @deprecated loadTurnsForChat(chatId) 사용 */
export function loadTurnsForCharacter(_userId: number, _characterId: number): DialogueTurn[] {
  return [];
}

function formatBatchDialogue(
  entries: Array<{ turnIndex: number; turn: DialogueTurn }>,
  charName: string
): string {
  return entries
    .map(
      ({ turnIndex, turn }) =>
        `[${turnIndex}턴]\n유저: ${turn.user.slice(0, 2500)}\n${charName}: ${turn.assistant.slice(0, 3500)}`
    )
    .join("\n\n");
}

async function summarizeTurnBatch(opts: {
  dialogue: string;
  charName: string;
  characterIdentity?: string | null;
  startTurn: number;
  endTurn: number;
  userPersona?: string | null;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
}): Promise<string> {
  const personaBlock = opts.userPersona?.trim()
    ? `\n\n[유저 페르소나 — 성별·호칭·신체 묘사 절대 준수]\n${opts.userPersona.trim()}`
    : "";
  const characterBlock = opts.characterIdentity?.trim()
    ? `\n\n[캐릭터 식별정보 — 성별·호칭·신체 묘사 절대 준수]\n${opts.characterIdentity.trim()}`
    : "";
  const userContent = `[${opts.startTurn}~${opts.endTurn}턴 원본 대화]\n${opts.dialogue}\n\n캐릭터: ${opts.charName}${characterBlock}${personaBlock}\n\n사건 흐름(→ 연결) 기억 기록 (최대 ${ROLLING_SUMMARY_MAX_CHARS}자, 저중요도 구간은 짧게). OOC·UI·SNS mock·RP 중단 연출은 제외하고 RP 사건만:`;
  const finishSummary = (raw: string): string => {
    const cleaned = normalizeSummaryText(raw);
    if (!cleaned) return "";
    return clampMemoryRecordSummary(cleaned);
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { text } = await callGeminiBackground(
        ROLLING_SUMMARY_SYSTEM_PROMPT,
        [{ role: "user", content: userContent }],
        opts.turnTrace,
        attempt === 0 ? "background-memory-extract" : "background-memory-extract-retry"
      );
      const first = finishSummary(text);
      if (first.length >= ROLLING_SUMMARY_MIN_CHARS) return first;
      if (attempt < 2) {
        console.warn(
          `[memory] ${ROLLING_SUMMARY_INTERVAL}턴 기억 기록 LLM 결과 짧음 (${first.length}ch) — 재시도 ${attempt + 2}/3`
        );
      }
    } catch (e) {
      console.warn(
        `[memory] ${ROLLING_SUMMARY_INTERVAL}턴 기억 기록 background LLM 실패${attempt >= 1 ? ` (재시도 ${attempt + 1}/3)` : ""}:`,
        (e as Error).message
      );
      if (attempt >= 2) break;
    }
  }
  return "";
}

function logLorebookCompact(opts: {
  inputChars: number;
  outputChars: number;
  maxChars: number;
  targetChars: number;
}): void {
  console.log("[memory] lorebook_compact", {
    compression_complete: opts.outputChars <= opts.maxChars,
    inputChars: opts.inputChars,
    outputChars: opts.outputChars,
    maxChars: opts.maxChars,
    targetChars: opts.targetChars,
  });
}

/** 로어북이 용량을 넘으면 시간순 사건 흐름(→ 연결)으로 압축 — 설정 상한에 맞춤 */
export async function compactCurrentMemory(
  existing: string,
  maxChars: number,
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace
): Promise<string> {
  const combined = existing.trim();
  const inputChars = combined.length;
  const targetMax = maxChars;
  const targetMin = Math.floor(maxChars * LOREBOOK_COMPACT_FILL_RATIO);

  if (!combined) {
    logLorebookCompact({ inputChars: 0, outputChars: 0, maxChars, targetChars: targetMax });
    return "";
  }
  if (!isMemoryFeatureEnabled()) {
    const result =
      combined.length <= maxChars ? combined : clampMemoryRecordSummary(combined, maxChars);
    logLorebookCompact({
      inputChars,
      outputChars: result.length,
      maxChars,
      targetChars: targetMax,
    });
    return result;
  }
  if (combined.length <= maxChars) {
    logLorebookCompact({
      inputChars,
      outputChars: combined.length,
      maxChars,
      targetChars: targetMax,
    });
    return combined;
  }

  async function runCompact(expandFrom?: string): Promise<string> {
    const expandBlock = expandFrom
      ? `\n[재작성]: 이전 결과(${expandFrom.length}자)가 너무 짧습니다. 원문의 중요 세부를 더 살려 **${targetMin}~${targetMax}자** 범위로 다시 작성하십시오.`
      : "";
    const system = `당신은 롤플레잉 장기 기억(현재기억) 편집자입니다. 누적된 기억 기록 전체를 하나의 압축된 사건 흐름으로 재작성하십시오.
[형식]: 시간순(오래된 것 → 최신) 사건들을 " → " 로 연결한 3인칭 연속 서술. 블록·턴 표시·불릿·키워드 나열 금지.
[보존]: 관계·호칭·약속, 신분·설정 변동, 중대 사건, 감정 변화의 흐름은 빠뜨리지 마십시오.
[분량]: **목표 ${targetMin}~${targetMax}자** (설정 상한 ${targetMax}자). 가능한 한 ${targetMax}자에 가깝게, 중요 기억을 최대한 보존하며 작성. ${targetMax}자 초과 금지. 문장·구절 중간 절단(…) 금지.${expandBlock}
압축 본문만 출력.`;
    const userContent = expandFrom
      ? `[원문]\n${combined}\n\n[이전 압축 결과 — 너무 짧음 (${expandFrom.length}자)]\n${expandFrom}`
      : combined;
    const { text } = await callGeminiBackground(
      system,
      [{ role: "user", content: userContent }],
      turnTrace,
      expandFrom ? "background-lorebook-compact-retry" : "background-lorebook-compact"
    );
    const merged = normalizeSummaryText(text);
    if (!merged) return "";
    return clampMemoryRecordSummary(merged, targetMax, ROLLING_SUMMARY_MIN_CHARS);
  }

  try {
    let result = await runCompact();
    if (result && result.length < targetMin) {
      try {
        const retried = await runCompact(result);
        if (retried.length > result.length) result = retried;
      } catch {
        /* keep first result */
      }
    }
    if (result) {
      logLorebookCompact({
        inputChars,
        outputChars: result.length,
        maxChars,
        targetChars: targetMax,
      });
      return result;
    }
  } catch {
    /* fall through */
  }
  const result = clampMemoryRecordSummary(combined, targetMax, ROLLING_SUMMARY_MIN_CHARS);
  logLorebookCompact({
    inputChars,
    outputChars: result.length,
    maxChars,
    targetChars: targetMax,
  });
  return result;
}

/** 새 히스토리 1편을 로어북 끝에 그대로 덧붙임 (무압축) */
export function appendCurrentMemory(existing: string, block: string): string {
  const trimmed = block.trim();
  if (!trimmed) return existing.trim();
  if (!existing.trim()) return trimmed;
  return `${existing.trim()}\n\n${trimmed}`;
}

function syncChatLongTermMemory(chatId: number, summary: string): void {
  getDb().prepare("UPDATE chats SET current_summary=? WHERE id=?").run(summary.trim(), chatId);
}

export { syncChatLongTermMemory };

export function resolveBatchStartTurnForTurnNumber(turnNumber: number): number {
  const n = Math.max(1, Math.floor(turnNumber));
  return Math.floor((n - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL + 1;
}

async function summarizeBatchEntries(opts: {
  eligibleEntries: Array<{ turnIndex: number; turn: DialogueTurn }>;
  charName: string;
  characterIdentity?: string | null;
  userPersona?: string | null;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
}): Promise<string> {
  const batch = opts.eligibleEntries.map((e) => e.turn);
  const summaryStartTurn = opts.eligibleEntries[0]!.turnIndex;
  const summaryEndTurn = opts.eligibleEntries[opts.eligibleEntries.length - 1]!.turnIndex;
  const dialogue = formatBatchDialogue(opts.eligibleEntries, opts.charName);

  let narrative = await summarizeTurnBatch({
    dialogue,
    charName: opts.charName,
    characterIdentity: opts.characterIdentity,
    startTurn: summaryStartTurn,
    endTurn: summaryEndTurn,
    userPersona: opts.userPersona,
    turnTrace: opts.turnTrace,
  });
  narrative = stripOocFromMemorySummary(narrative);
  return narrative.trim() ? clampMemoryRecordSummary(narrative) : "";
}

/** 재생성 — 해당 턴이 속한 6턴 배치 기억 기록을 현재 DB 대화 기준으로 재작성 */
export async function refreshRollingSummaryForRegeneratedAssistant(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  characterIdentity?: string | null;
  tier: MemoryTier;
  memoryCapacity: number;
  userPersona?: string | null;
  assistantMessageId: number;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
}): Promise<boolean> {
  if (!isMemoryFeatureEnabled()) return false;
  if (running.has(opts.chatId)) return false;

  const allTurns = loadChatTurnsWithMessageIds(opts.chatId);
  const target = allTurns.find((t) => t.assistantMessageId === opts.assistantMessageId);
  if (!target) return false;

  const batchStart = resolveBatchStartTurnForTurnNumber(target.turnNumber);
  const record = listMemoryRecordsForChat(opts.chatId).find((r) => r.turnStart === batchStart);
  if (record?.userEdited) return false;

  const memory = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);
  if (!record) {
    if (
      shouldTriggerRollingSummary(memory.message_count ?? 0, memory.summarized_turn_count ?? 0)
    ) {
      void processRollingSummaryBatch(opts).catch((e) => {
        console.warn("[memory] regen seal pending batch failed:", (e as Error).message);
      });
    }
    return false;
  }

  const batchMeta = allTurns.filter(
    (t) => t.turnNumber >= batchStart && t.turnNumber < batchStart + ROLLING_SUMMARY_INTERVAL
  );
  if (batchMeta.length === 0) return false;

  running.add(opts.chatId);
  try {
    const eligibleEntries = batchMeta
      .map((meta) => ({
        turnIndex: meta.turnNumber,
        turn: { user: meta.user, assistant: meta.assistant } satisfies DialogueTurn,
      }))
      .filter(({ turn }) => isTurnEligibleForMemoryRecord(turn.user));

    if (eligibleEntries.length === 0) return false;

    const narrative = await summarizeBatchEntries({
      eligibleEntries,
      charName: opts.charName,
      characterIdentity: opts.characterIdentity,
      userPersona: opts.userPersona,
      turnTrace: opts.turnTrace,
    });
    if (!narrative.trim()) return false;

    const lastAssistantId = batchMeta[batchMeta.length - 1]?.assistantMessageId ?? null;
    const playableCount = allTurns.filter((t) => t.turnNumber > 0).length;
    const persisted = persistValidatedSummaryBatch({
      chatId: opts.chatId,
      userId: opts.userId,
      characterId: opts.characterId,
      tier: opts.tier,
      turnStart: batchStart,
      assistantMessageId: lastAssistantId,
      summary: narrative,
      userEdited: false,
      playableTurnCount: playableCount,
    });
    if (!persisted.ok) return false;

    const lorebookBudget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity).lorebook;
    let currentMemory = rebuildLorebookFromRecords(opts.chatId);
    if (currentMemory.length > lorebookBudget) {
      currentMemory = await compactCurrentMemory(currentMemory, lorebookBudget, opts.turnTrace);
      updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
        recent_summary: currentMemory,
        membership_tier: opts.tier,
        last_compressed_at: new Date().toISOString(),
      });
      syncChatLongTermMemory(opts.chatId, currentMemory);
    }

    console.info(
      `[memory] regen batch refresh chat=${opts.chatId} batch=${batchStart} assistant=${opts.assistantMessageId} (${narrative.length}ch)`
    );
    return true;
  } catch (e) {
    console.warn("[memory] regen batch refresh failed:", (e as Error).message);
    return false;
  } finally {
    running.delete(opts.chatId);
  }
}

export function pickNextSummaryBatch(
  turns: DialogueTurn[],
  summarizedTurnCount: number
): DialogueTurn[] {
  const { playable } = splitOpeningPlayableTurns(turns);
  const pending = playable.length - summarizedTurnCount;
  if (pending < ROLLING_SUMMARY_INTERVAL) return [];
  return playable.slice(summarizedTurnCount, summarizedTurnCount + ROLLING_SUMMARY_INTERVAL);
}

/** 6턴 1배치 → 기억 기록 저장 + 로어북(recent_summary) 누적 (원자적·연속 배치) */
export async function processRollingSummaryBatch(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  characterIdentity?: string | null;
  tier: MemoryTier;
  memoryCapacity: number;
  userPersona?: string | null;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
}): Promise<boolean> {
  if (!isMemoryFeatureEnabled()) return false;
  // In-flight lock first — shrink race before any await/LLM
  if (running.has(opts.chatId)) return false;
  running.add(opts.chatId);

  try {
    const memory = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);
    const allTurns = loadChatTurnsWithMessageIds(opts.chatId);
    const playableMeta = allTurns.filter((t) => t.turnNumber > 0);
    const playableCount = playableMeta.length;

    // Counter must follow contiguous persisted batches — never trust stale summarized_turn_count alone
    const records = listMemoryRecordsForChat(opts.chatId);
    let summarized = highestContiguousCompletedTurn(records, playableCount);
    if ((memory.summarized_turn_count ?? 0) !== summarized) {
      summarized = reconcileSummarizedTurnCountFromTable({
        chatId: opts.chatId,
        userId: opts.userId,
        characterId: opts.characterId,
        tier: opts.tier,
        playableTurnCount: playableCount,
      });
      console.warn("[memory] SUMMARY_COUNTER_DRIFT reconciled", {
        chatId: opts.chatId,
        was: memory.summarized_turn_count,
        now: summarized,
      });
    }

    const missingEarliest = earliestMissingBatchStart(records, playableCount);
    const nextStart = summarized + 1;
    // Always fill earliest gap first (usually equals nextStart when contiguous)
    const batchStart = missingEarliest ?? nextStart;
    if (batchStart !== nextStart) {
      console.warn("[memory] SUMMARY_BATCH_GAP refuse non-contiguous batch", {
        chatId: opts.chatId,
        batchStart,
        nextStart,
        missingEarliest,
      });
      return false;
    }

    // Idempotent: persisted row already present → never call V3 again for this batch
    if (records.some((r) => r.turnStart === batchStart)) {
      return false;
    }

    const batchMeta = playableMeta.slice(batchStart - 1, batchStart - 1 + ROLLING_SUMMARY_INTERVAL);
    if (batchMeta.length < ROLLING_SUMMARY_INTERVAL) return false;

    // Re-check after lock + load (another worker may have just persisted)
    const latest = listMemoryRecordsForChat(opts.chatId);
    if (latest.some((r) => r.turnStart === batchStart)) {
      return false;
    }

    const endTurn = batchStart + ROLLING_SUMMARY_INTERVAL - 1;
    const eligibleEntries = batchMeta
      .map((meta, i) => ({
        turnIndex: batchStart + i,
        turn: { user: meta.user, assistant: meta.assistant } satisfies DialogueTurn,
      }))
      .filter(({ turn }) => isTurnEligibleForMemoryRecord(turn.user));

    let narrative = "";
    let summaryKind: "narrative" | "ooc_only" = "narrative";
    let reasonTag: string = "SUMMARY_SUCCESS";

    if (eligibleEntries.length === 0) {
      narrative = buildOocOnlyBatchPlaceholder(batchStart, endTurn);
      summaryKind = "ooc_only";
      reasonTag = "SUMMARY_OOC_PLACEHOLDER";
    } else {
      const dialogue = formatBatchDialogue(eligibleEntries, opts.charName);
      const summaryStartTurn = eligibleEntries[0]!.turnIndex;
      const summaryEndTurn = eligibleEntries[eligibleEntries.length - 1]!.turnIndex;

      try {
        narrative = await summarizeTurnBatch({
          dialogue,
          charName: opts.charName,
          characterIdentity: opts.characterIdentity,
          startTurn: summaryStartTurn,
          endTurn: summaryEndTurn,
          userPersona: opts.userPersona,
          turnTrace: opts.turnTrace,
        });
      } catch (e) {
        const msg = (e as Error).message ?? "";
        const reason = /timeout|aborted|ETIMEDOUT/i.test(msg)
          ? "SUMMARY_TIMEOUT"
          : "SUMMARY_EMPTY";
        console.error(`[memory] ${reason} chat=${opts.chatId} turns=${batchStart}-${endTurn}`, msg);
        return false;
      }

      if (!narrative.trim()) {
        console.error(
          `[memory] SUMMARY_EMPTY chat=${opts.chatId} turns=${batchStart}-${endTurn} — batch pending retry`
        );
        return false;
      }
      narrative = stripOocFromMemorySummary(narrative);
      if (!narrative.trim()) {
        // Empty after OOC strip is NOT a completed narrative batch — do not advance count
        console.error(
          `[memory] SUMMARY_EMPTY after OOC strip chat=${opts.chatId} turns=${batchStart}-${endTurn}`
        );
        return false;
      }
    }

    const validated = validateSummaryNarrative(narrative, summaryKind);
    if (!validated.ok) {
      console.error(
        `[memory] ${validated.reason} chat=${opts.chatId} turns=${batchStart}-${endTurn}`
      );
      return false;
    }
    narrative = validated.text;
    summaryKind = validated.kind;

    const lorebookBudget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity).lorebook;
    const lastAssistantId = batchMeta[batchMeta.length - 1]?.assistantMessageId ?? null;

    // Persist row first (atomic with counter+recent). Compact AFTER if needed, then re-persist recent only.
    const persisted = persistValidatedSummaryBatch({
      chatId: opts.chatId,
      userId: opts.userId,
      characterId: opts.characterId,
      tier: opts.tier,
      turnStart: batchStart,
      assistantMessageId: lastAssistantId,
      summary: narrative,
      summaryKind,
      userEdited: false,
      playableTurnCount: playableCount,
    });

    if (!persisted.ok) {
      console.error(
        `[memory] ${persisted.reason} chat=${opts.chatId} turns=${batchStart}-${endTurn}`,
        persisted.error
      );
      return false;
    }

    let currentMemory = rebuildLorebookFromRecords(opts.chatId);
    if (currentMemory.length > lorebookBudget) {
      currentMemory = await compactCurrentMemory(currentMemory, lorebookBudget, opts.turnTrace);
      // Re-apply compacted lorebook without changing counter/row (same transaction-safe update)
      updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
        recent_summary: currentMemory,
        membership_tier: opts.tier,
        last_compressed_at: new Date().toISOString(),
      });
      syncChatLongTermMemory(opts.chatId, currentMemory);
    }

    console.info(
      `[memory] ${ROLLING_SUMMARY_INTERVAL}턴 기억 기록 chat=${opts.chatId} turns=${batchStart}-${endTurn} (${narrative.length}ch → lorebook ${currentMemory.length}/${lorebookBudget}ch) reason=${reasonTag}`
    );
    return true;
  } catch (e) {
    console.error(
      `[memory] rolling summary failed chat=${opts.chatId}:`,
      (e as Error).message
    );
    return false;
  } finally {
    running.delete(opts.chatId);
  }
}


/** 패널·API — 특정 6턴 배치 기억 기록을 LLM으로 다시 생성 (유저 수정본은 건너뜀) */
export async function regenerateMemoryRecordBatch(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  characterIdentity?: string | null;
  tier: MemoryTier;
  memoryCapacity: number;
  turnStart: number;
  userPersona?: string | null;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
}): Promise<boolean> {
  if (!isMemoryFeatureEnabled()) return false;
  if (running.has(opts.chatId)) return false;

  const batchStart = resolveBatchStartTurnForTurnNumber(opts.turnStart);
  const record = listMemoryRecordsForChat(opts.chatId).find((r) => r.turnStart === batchStart);
  if (record?.userEdited) return false;

  const batchMeta = loadChatTurnsWithMessageIds(opts.chatId).filter(
    (t) => t.turnNumber >= batchStart && t.turnNumber < batchStart + ROLLING_SUMMARY_INTERVAL
  );
  if (batchMeta.length === 0) return false;

  running.add(opts.chatId);
  try {
    const eligibleEntries = batchMeta
      .map((meta) => ({
        turnIndex: meta.turnNumber,
        turn: { user: meta.user, assistant: meta.assistant } satisfies DialogueTurn,
      }))
      .filter(({ turn }) => isTurnEligibleForMemoryRecord(turn.user));

    if (eligibleEntries.length === 0) return false;

    const narrative = await summarizeBatchEntries({
      eligibleEntries,
      charName: opts.charName,
      characterIdentity: opts.characterIdentity,
      userPersona: opts.userPersona,
      turnTrace: opts.turnTrace,
    });
    if (!narrative.trim() || isFallbackMemoryRecordSummary(narrative)) return false;

    const lastAssistantId = batchMeta[batchMeta.length - 1]?.assistantMessageId ?? null;
    const playableCount = loadChatTurnsWithMessageIds(opts.chatId).filter(
      (t) => t.turnNumber > 0
    ).length;
    const persisted = persistValidatedSummaryBatch({
      chatId: opts.chatId,
      userId: opts.userId,
      characterId: opts.characterId,
      tier: opts.tier,
      turnStart: batchStart,
      assistantMessageId: lastAssistantId,
      summary: narrative,
      userEdited: false,
      playableTurnCount: playableCount,
    });
    if (!persisted.ok) return false;

    const lorebookBudget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity).lorebook;
    let currentMemory = rebuildLorebookFromRecords(opts.chatId);
    if (currentMemory.length > lorebookBudget) {
      currentMemory = await compactCurrentMemory(currentMemory, lorebookBudget, opts.turnTrace);
      updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
        recent_summary: currentMemory,
        membership_tier: opts.tier,
        last_compressed_at: new Date().toISOString(),
      });
      syncChatLongTermMemory(opts.chatId, currentMemory);
    }
    return true;
  } catch (e) {
    console.error("[memory] regenerateMemoryRecordBatch failed:", (e as Error).message);
    return false;
  } finally {
    running.delete(opts.chatId);
  }
}

export function scheduleCharacterRollingSummary(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  characterIdentity?: string | null;
  tier: MemoryTier;
  memoryCapacity: number;
  userPersona?: string | null;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
}): void {
  void processRollingSummaryBatch(opts);
}

export async function catchUpRollingSummaries(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  tier: MemoryTier;
  memoryCapacity: number;
  maxRounds?: number;
}): Promise<number> {
  const maxRounds = opts.maxRounds ?? 5;
  let processed = 0;
  for (let i = 0; i < maxRounds; i++) {
    const ok = await processRollingSummaryBatch(opts);
    if (!ok) break;
    processed++;
  }
  return processed;
}

export function shouldTriggerRollingSummary(messageCount: number, summarizedTurnCount: number): boolean {
  /** 배치 봉인 지연 — [1~6]은 7턴 완료 후, [7~12]는 13턴 완료 후 생성 */
  return messageCount > summarizedTurnCount + ROLLING_SUMMARY_INTERVAL;
}

export function turnsUntilNextSummary(
  messageCount: number,
  summarizedTurnCount = 0
): number {
  const sealAt = summarizedTurnCount + ROLLING_SUMMARY_INTERVAL + 1;
  if (messageCount >= sealAt) return 0;
  return sealAt - messageCount;
}
