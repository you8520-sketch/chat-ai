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
  buildEmptyOocBatchPlaceholder,
  earliestMissingBatchStart,
  highestContiguousCompletedTurn,
  validateSummaryNarrative,
} from "./memory-summary-integrity";
import {
  persistValidatedSummaryBatch,
  reconcileSummarizedTurnCountFromTable,
} from "./memory-summary-persist";
import {
  buildNoncanonSummaryFromTurns,
  buildPreferenceSummaryFromTurns,
  classifyMemoryBatchScopes,
  displaySummaryFromScopes,
  type MemorySummaryScope,
  type ScopePayloadV1,
} from "./memory-summary-scope";
import {
  closeActiveBranchCanon,
  promoteRecordsToBranchCanon,
} from "./memory-turn-summary";

export const ROLLING_SUMMARY_SYSTEM_PROMPT = `[${ROLLING_SUMMARY_INTERVAL}턴 히스토리 요약]

${ROLLING_SUMMARY_INTERVAL}턴 배치의 사건을 발생 순서대로 요약한다. 사건 시기와 인과관계를 누락하지 않는다.
작중 시간은 본문·상태창·정본에 명시된 경우에만 기록하며, 불명확하면 추측하지 않는다.
현실 날짜·요약 생성일·턴 범위는 본문에 쓰지 않고 서버 metadata로 관리한다.

[형식]
- 간결한 사실형 서술 또는 명사형 종결
- 원인 → 행동·선택 → 결과 → 관계·감정 변화 순
- ${ROLLING_SUMMARY_MAX_CHARS}자 이내. 중요 정보가 적으면 짧게 끝내며 분량을 억지로 채우지 않는다.
- 파편식 단문 나열과 분위기 묘사 중심 요약 금지
- 유저의 명확한 선택이 캐릭터의 태도·감정·행동에 영향을 주었으면 반드시 기록
- 유저의 생각·의도·감정을 입력에 없는 내용으로 추측하지 않는다.

[반드시 보존]
1. 주요 사건과 그 결과
2. 관계 역학 또는 감정 방향의 변화
3. 인물이 자신이나 상대를 규정한 선언
4. 약속·계약·임무·미해결 목표
5. 중요한 물건의 획득·전달·분실과 현재 소유자
6. 새로 밝혀진 비밀·정체·세계관 정보
7. 부상·능력·신분·장소 등 이후 전개에 영향을 주는 상태 변화
8. 관계와 사건의 전환점이 된 대사

[전환점 대사]
- 원문 메시지에서 정확히 확인 가능한 경우에만 최대 1~2개를 그대로 인용
- 문구가 불확실하면 인용문을 새로 만들지 말고 의미만 요약
- 장식적인 대사와 반복 대사는 제외

[삭제·압축]
- 같은 관계 역학의 반복은 최초 또는 가장 강한 전환점 한 번만 보존
- 관계나 사건 변화가 없는 분위기·감각·일상 묘사 삭제
- 성행위의 동작·신체 묘사는 삭제하되, 동의·경계·관계 전환·약속·후유증은 보존
- 같은 흐름이 여러 턴 이어지면 하나의 인과 흐름으로 병합
- 이미 캐논에 고정된 외형·직업·말투를 반복 기록하지 않음

[판단 기준]
다음 질문 중 하나라도 "예"이면 보존한다.
- 이 줄을 삭제하면 이후 사건의 인과가 달라지는가?
- 관계 궤적이나 감정 방향이 달라지는가?
- 누가 무엇을 알고 있는지가 달라지는가?
- 약속·임무·소유물·현재 상태가 달라지는가?

[식별정보]: 캐릭터/유저 식별정보가 제공되면 성별·호칭·신체 묘사를 뒤집지 않는다.
[OOC 제외]: (OOC:) 메타·UI·SNS mock·RP 중단 연출은 기록하지 않는다. 요약 본문만 출력한다.`;

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
  const userContent = `[${opts.startTurn}~${opts.endTurn}턴 원본 대화]\n${opts.dialogue}\n\n캐릭터: ${opts.charName}${characterBlock}${personaBlock}\n\n[${ROLLING_SUMMARY_INTERVAL}턴 히스토리 요약] 최대 ${ROLLING_SUMMARY_MAX_CHARS}자. OOC·UI·SNS mock·RP 중단 연출은 제외하고 RP 사건만 요약:`;
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

/** @internal test seam — fixture tests stub compact without live model calls */
let compactCurrentMemoryTestOverride:
  | null
  | ((existing: string, maxChars: number) => Promise<string>) = null;

export function __setCompactCurrentMemoryTestOverride(
  fn: null | ((existing: string, maxChars: number) => Promise<string>)
): void {
  compactCurrentMemoryTestOverride = fn;
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
  if (compactCurrentMemoryTestOverride) {
    const result = await compactCurrentMemoryTestOverride(combined, maxChars);
    logLorebookCompact({
      inputChars,
      outputChars: result.length,
      maxChars,
      targetChars: targetMax,
    });
    return result;
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
    throw new Error("SUMMARY_EMPTY");
  } catch (e) {
    logLorebookCompact({
      inputChars,
      outputChars: 0,
      maxChars,
      targetChars: targetMax,
    });
    // Do not silently truncate — callers keep prior lorebook on failure
    throw e;
  }
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
      try {
        const compacted = await compactCurrentMemory(
          currentMemory,
          lorebookBudget,
          opts.turnTrace
        );
        if (compacted.trim()) {
          currentMemory = compacted;
          updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
            recent_summary: currentMemory,
            membership_tier: opts.tier,
            last_compressed_at: new Date().toISOString(),
          });
          syncChatLongTermMemory(opts.chatId, currentMemory);
        }
      } catch (e) {
        console.warn(
          "[memory] lorebook compact skipped after regen — keeping prior text:",
          (e as Error).message
        );
      }
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
    const allEntries = batchMeta.map((meta, i) => ({
      turnIndex: batchStart + i,
      turn: { user: meta.user, assistant: meta.assistant } satisfies DialogueTurn,
    }));

    const priorRecords = listMemoryRecordsForChat(opts.chatId);
    const previousWasNoncanonOrBranch = priorRecords.some(
      (r) =>
        !r.inactive &&
        (r.summaryKind === "noncanon" ||
          (r.summaryKind === "branch_canon" && r.branchStatus === "active"))
    );
    const plan = classifyMemoryBatchScopes(allEntries, { previousWasNoncanonOrBranch });

    // Main RP turns for LLM (legacy eligibility still used as safety for "main" only)
    const mainEntries = plan.mainTurns.filter(({ turn }) =>
      isTurnEligibleForMemoryRecord(turn.user)
    );

    const scopes: ScopePayloadV1["scopes"] = {};
    let summaryKind: MemorySummaryScope = plan.primaryKind;
    let reasonTag: string = "SUMMARY_SUCCESS";
    let branchId: string | null = null;
    let branchStatus: ScopePayloadV1["branchStatus"] = null;
    let promotedBy: string | null = null;
    let promotedAt: string | null = null;

    if (plan.wantsBranchClose) {
      closeActiveBranchCanon(opts.chatId);
    }

    if (plan.preferenceTurns.length > 0) {
      scopes.preference = buildPreferenceSummaryFromTurns(plan.preferenceTurns);
    }

    if (plan.noncanonTurns.length > 0) {
      const nonText = buildNoncanonSummaryFromTurns(plan.noncanonTurns);
      if (plan.wantsBranchContinue || plan.primaryKind === "branch_canon") {
        scopes.branch_canon = nonText;
        summaryKind = "branch_canon";
        branchId = `branch-${opts.chatId}-${batchStart}`;
        branchStatus = "active";
        promotedBy = "user_continue";
        promotedAt = new Date().toISOString();
        const toPromote = priorRecords
          .filter((r) => !r.inactive && r.summaryKind === "noncanon")
          .map((r) => r.id);
        if (toPromote.length > 0) {
          promoteRecordsToBranchCanon({
            chatId: opts.chatId,
            recordIds: toPromote,
            branchId,
            promotedBy: "user_continue",
          });
        }
      } else {
        scopes.noncanon = nonText;
        if (summaryKind === "empty_ooc") summaryKind = "noncanon";
      }
    }

    if (mainEntries.length === 0 && !scopes.noncanon && !scopes.branch_canon && !scopes.preference) {
      scopes.empty_ooc = buildEmptyOocBatchPlaceholder(batchStart, endTurn);
      summaryKind = "empty_ooc";
      reasonTag = "SUMMARY_OOC_PLACEHOLDER";
    } else if (mainEntries.length > 0) {
      const dialogue = formatBatchDialogue(mainEntries, opts.charName);
      const summaryStartTurn = mainEntries[0]!.turnIndex;
      const summaryEndTurn = mainEntries[mainEntries.length - 1]!.turnIndex;
      let narrative = "";
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
        console.error(
          `[memory] SUMMARY_EMPTY after OOC strip chat=${opts.chatId} turns=${batchStart}-${endTurn}`
        );
        return false;
      }
      scopes.main_canon = narrative;
      summaryKind = scopes.noncanon || scopes.branch_canon ? "main_canon" : "main_canon";
    }

    if (plan.wantsMainAdopt && (scopes.branch_canon || scopes.noncanon)) {
      const adopted = scopes.branch_canon || scopes.noncanon || "";
      scopes.main_canon = [scopes.main_canon, adopted].filter(Boolean).join("\n");
      delete scopes.branch_canon;
      delete scopes.noncanon;
      summaryKind = "main_canon";
      branchStatus = "closed";
      promotedBy = "user_main_adopt";
      promotedAt = new Date().toISOString();
    }

    const narrative = displaySummaryFromScopes(scopes, summaryKind);
    const validated = validateSummaryNarrative(narrative, summaryKind);
    if (!validated.ok) {
      console.error(
        `[memory] ${validated.reason} chat=${opts.chatId} turns=${batchStart}-${endTurn}`
      );
      return false;
    }

    const scopePayload: ScopePayloadV1 = {
      v: 1,
      scopes,
      branchId,
      branchStatus,
      promotedBy,
      promotedAt,
    };

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
      summary: validated.text,
      summaryKind: validated.kind,
      scopePayload,
      branchId,
      branchStatus,
      promotedBy,
      promotedAt,
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
      try {
        const compacted = await compactCurrentMemory(
          currentMemory,
          lorebookBudget,
          opts.turnTrace
        );
        // Only overwrite when compact succeeded — keep prior recent_summary on failure
        if (compacted.trim()) {
          currentMemory = compacted;
          updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
            recent_summary: currentMemory,
            membership_tier: opts.tier,
            last_compressed_at: new Date().toISOString(),
          });
          syncChatLongTermMemory(opts.chatId, currentMemory);
        }
      } catch (e) {
        console.warn(
          "[memory] lorebook compact skipped after batch — keeping prior text:",
          (e as Error).message
        );
      }
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
      try {
        const compacted = await compactCurrentMemory(
          currentMemory,
          lorebookBudget,
          opts.turnTrace
        );
        if (compacted.trim()) {
          currentMemory = compacted;
          updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
            recent_summary: currentMemory,
            membership_tier: opts.tier,
            last_compressed_at: new Date().toISOString(),
          });
          syncChatLongTermMemory(opts.chatId, currentMemory);
        }
      } catch (e) {
        console.warn(
          "[memory] lorebook compact skipped after regenerate — keeping prior text:",
          (e as Error).message
        );
      }
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
