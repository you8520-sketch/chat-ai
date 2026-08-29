import { getDb } from "@/lib/db";
import { callGeminiBackground } from "@/lib/ai";
import {
  splitOpeningPlayableTurns,
  RAW_HISTORY_COMPLETE_EXCHANGES,
  type DialogueTurn,
} from "@/lib/hybridMemory";
import {
  LOREBOOK_COMPACT_FILL_RATIO,
  ROLLING_SUMMARY_INTERVAL,
  ROLLING_SUMMARY_MAX_CHARS,
  ROLLING_SUMMARY_MIN_CHARS,
  resolveSummaryLogLabel,
} from "./memory-constants";
import { clampMemoryRecordSummary } from "./memory-summary-clamp";
import { resolveMemoryBudgetFromCapacity } from "./memory-capacity-shared";
import { isMemoryFeatureEnabled, isSummaryBarrierActive } from "./memory-feature";
import { extractAndPersistEpisodicFactsForSealedBatch } from "./memory-episodic-extract";
import { newBatchEndForStart, resolveNextBatchRange } from "./memory-summary-range";
import {
  findBatchControlSource,
  type BranchControlSource,
  type PersistPendingBranchControlOp,
} from "./memory-branch-control";
import {
  rebuildLorebookFromRecords,
  listMemoryRecordsForChat,
  resolveSoleClosedContinueReopen,
  isExplicitClosedBranchContinueIntent,
  selectLatestContiguousNoncanonRecordIds,
  type MemoryRecordView,
} from "./memory-turn-summary";
import { listClosedBranchIdsFromRecords } from "./memory-shadow-state";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { loadMemoryEligibleChatTurnsWithMessageIds, loadChatTurnsWithMessageIds } from "./memory-turn-loader";
import {
  getMemorySourceBoundary,
  isMemoryWriteGuardCurrentCore,
  type MemorySourceBoundary,
} from "./memory-source-boundary";
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
  isRollingSummaryGroundedInDialogue,
  resolveBatchStartForTurnNumber,
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
  selectEpisodicEligibleTurnEntries,
  shouldPromoteBranchContinue,
  type BranchStatus,
  type MemorySummaryScope,
  type ScopePayloadV1,
} from "./memory-summary-scope";

/** Post-persist branch control ops, ordered by source turn (compose must not apply these). */
type PendingBranchControlOp = PersistPendingBranchControlOp;

export function buildRollingSummarySystemPrompt(
  sourceTurnCount: number,
  maxChars = ROLLING_SUMMARY_MAX_CHARS
): string {
  return `[${sourceTurnCount}턴 히스토리 요약]

${sourceTurnCount}턴 배치의 사건을 발생 순서대로 요약한다. 사건 시기와 인과관계를 누락하지 않는다.
마지막 턴만 보고 요약하지 않는다. 응답 전에 요약 대상 source 턴의 앞·중간·뒤를 모두 검토하고,
서로 다른 중요한 사건이 있으면 각 구간의 원인·전환·결과가 최종 요약에 남았는지 자체 점검한다.
단, 변화가 없는 짧은 반응이나 반복은 생략할 수 있다.
작중 시간은 본문·상태창·정본에 명시된 경우에만 기록하며, 불명확하면 추측하지 않는다.
현실 날짜·요약 생성일·턴 범위는 본문에 쓰지 않고 서버 metadata로 관리한다.

[형식]
- 음슴체(명사형·~함·~임 종결)로 간결하게. 존댓말 서술(~했다/~였다)보다 글자를 절약한다.
- 원인 → 행동·선택 → 결과 → 관계·감정 변화 순
- 최대 ${maxChars}자. 중요 정보가 적으면 짧게 끝내며 분량을 억지로 채우지 않는다. 반복 장면이면 짧아도 된다.
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
- 성행위 턴: 체위·신음·신체 동작 묘사만 삭제. 그 안의 중요한 대화·감정 변화·관계 전환·동의·경계·약속·후유증·공수 포지션(누가 누구에게 안기는지)은 다른 사건과 똑같이 보존
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
}

/** Default prompt for the production 5-turn summary interval. */
export const ROLLING_SUMMARY_SYSTEM_PROMPT = buildRollingSummarySystemPrompt(
  ROLLING_SUMMARY_INTERVAL
);

export const ROLLING_SUMMARY_EPISTEMIC_POLICY = `[CANONICAL GROUNDING — REQUIRED]
- Output the event summary itself. Never repeat, paraphrase, or explain these summary instructions.
- Write a normal, concise RP scene summary. Character perception, sensation, and estimates ("파장을 감지했다", "안정을 느꼈다", "S급으로 추정되는") are scene content — state them plainly as what the character experienced.
- Only for strong claims that would change canon (각성, 정체, 등급 상승, 배신, 기억상실): if the source had them as a character's guess, keep the guess framing ("추측했다", "가능성이 제기됐다").
- "널 본 기억이 안 난다" does NOT mean global amnesia or "기억을 잃었다".
- Do not expose turn numbers, source checklists, or prompt wording in the final summary.`;

/** Single-flight per chat — concurrent callers await the same in-flight seal/rebuild. */
const inflight = new Map<number, Promise<boolean>>();

/** Catch-up schedules registered before async work claims inflight. */
const catchUpScheduledChats = new Set<number>();

export function isRollingSummaryInFlight(chatId: number): boolean {
  return inflight.has(chatId);
}

/** Read-only contention snapshot for main-RP vs background summary telemetry. */
export function getRollingSummaryContentionSnapshot(): {
  summaryActiveCount: number;
  catchUpScheduledCount: number;
  activeChatIds: number[];
  catchUpScheduledChatIds: number[];
} {
  return {
    summaryActiveCount: inflight.size,
    catchUpScheduledCount: catchUpScheduledChats.size,
    activeChatIds: [...inflight.keys()],
    catchUpScheduledChatIds: [...catchUpScheduledChats],
  };
}

/**
 * Run exclusive rolling-summary work for a chat.
 * If another job is already running:
 *  - coalesce=true (default): await and return that job's result
 *  - coalesce=false: await it, then run `fn` (regen/rebuild)
 */
async function withRollingSummaryLock(
  chatId: number,
  fn: () => Promise<boolean>,
  opts?: { coalesce?: boolean }
): Promise<boolean> {
  const coalesce = opts?.coalesce !== false;
  const existing = inflight.get(chatId);
  if (existing) {
    if (coalesce) return existing;
    await existing.catch(() => false);
  }
  let jobResolve!: (v: boolean) => void;
  const job = new Promise<boolean>((resolve) => {
    jobResolve = resolve;
  });
  inflight.set(chatId, job);
  try {
    const result = await fn();
    jobResolve(result);
    return result;
  } catch (e) {
    jobResolve(false);
    throw e;
  } finally {
    if (inflight.get(chatId) === job) inflight.delete(chatId);
  }
}

const ARROW_SEP = " → ";

function normalizeSummaryText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 해당 채팅방 메시지만 턴으로 변환 */
export function loadTurnsForChat(chatId: number): DialogueTurn[] {
  return loadMemoryEligibleChatTurnsWithMessageIds(chatId).map((turn) => ({
    user: turn.user,
    assistant: turn.assistant,
    assistantOnly: turn.assistantOnly,
  }));
}

/** @deprecated loadTurnsForChat(chatId) 사용 */
export function loadTurnsForCharacter(_userId: number, _characterId: number): DialogueTurn[] {
  return [];
}

function formatOpeningPreludeForSummary(openingAssistant: string): string {
  const text = openingAssistant.trim();
  if (!text) return "";
  return `[OPENING/PRELUDE CONTEXT — not source turn 1]\n${OPENING_TURN_USER}\n${text}`;
}

function resolveOpeningPreludeForBatch(
  chatId: number,
  batchStart: number
): string {
  if (batchStart !== 1) return "";
  const opening = loadChatTurnsWithMessageIds(chatId).find((t) => t.turnNumber === 0);
  if (!opening?.assistant?.trim()) return "";
  return formatOpeningPreludeForSummary(opening.assistant);
}

function formatBatchDialogue(
  entries: Array<{ turnIndex: number; turn: DialogueTurn }>,
  charName: string
): string {
  return entries
    .map(
      ({ turnIndex, turn }) =>
        `[${turnIndex}턴]\n유저: ${turn.user}\n${charName}: ${turn.assistant}`
    )
    .join("\n\n");
}

/** @internal test seam — production formatter used before the rolling-summary LLM call */
export function __formatBatchDialogueForTests(
  entries: Array<{ turnIndex: number; turn: DialogueTurn }>,
  charName: string
): string {
  return formatBatchDialogue(entries, charName);
}

export type RollingSummaryLlmCaller = (
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
  turnTrace: import("@/lib/geminiRequestTrace").GeminiTurnTrace | undefined,
  requestKind: string
) => Promise<{ text: string; usage?: import("@/lib/ai").TokenUsage }>;

/** @internal test seam — stub summarizeTurnBatch without live network */
let summarizeTurnBatchCallerOverride: RollingSummaryLlmCaller | null = null;

export function __setSummarizeTurnBatchCallerForTests(
  fn: RollingSummaryLlmCaller | null
): void {
  summarizeTurnBatchCallerOverride = fn;
}

/** @internal last summarizeTurnBatch failure reason (diagnostics for stuck seals) */
let lastSummarizeTurnBatchError: string | null = null;

export function __getLastSummarizeTurnBatchErrorForTests(): string | null {
  return lastSummarizeTurnBatchError;
}

/** @internal test seam — force persistValidatedSummaryBatch txn rollback after upsert */
let persistForceFailAfterUpsertForTests = false;

export function __setPersistForceFailAfterUpsertForTests(fail: boolean): void {
  persistForceFailAfterUpsertForTests = fail;
}

/** @internal test seam — force txn rollback after branch ops, before lorebook commit */
let persistForceFailAfterBranchOpsForTests = false;

export function __setPersistForceFailAfterBranchOpsForTests(fail: boolean): void {
  persistForceFailAfterBranchOpsForTests = fail;
}

/** @internal exported for unit tests */
export async function summarizeTurnBatch(opts: {
  dialogue: string;
  charName: string;
  characterIdentity?: string | null;
  startTurn: number;
  endTurn: number;
  sourceTurnIndexes?: number[];
  userPersona?: string | null;
  openingPrelude?: string | null;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
}): Promise<string> {
  const personaBlock = opts.userPersona?.trim()
    ? `\n\n[유저 페르소나 — 성별·호칭·신체 묘사 절대 준수]\n${opts.userPersona.trim()}`
    : "";
  const characterBlock = opts.characterIdentity?.trim()
    ? `\n\n[캐릭터 식별정보 — 성별·호칭·신체 묘사 절대 준수]\n${opts.characterIdentity.trim()}`
    : "";
  const sourceTurnIndexes = Array.from(
    new Set(
      (opts.sourceTurnIndexes?.length
        ? opts.sourceTurnIndexes
        : Array.from(
            { length: Math.max(0, opts.endTurn - opts.startTurn + 1) },
            (_, i) => opts.startTurn + i
          )
      ).filter((turn) => Number.isInteger(turn) && turn > 0)
    )
  ).sort((a, b) => a - b);
  const sourceCoverage = sourceTurnIndexes.map((turn) => `[${turn}턴]`).join(" ");
  const sourceTurnCount = Math.max(1, opts.endTurn - opts.startTurn + 1);
  const systemPrompt = buildRollingSummarySystemPrompt(sourceTurnCount);
  const openingBlock = opts.openingPrelude?.trim()
    ? `${opts.openingPrelude.trim()}\n\n`
    : "";
  const userContent = `${openingBlock}[${opts.startTurn}~${opts.endTurn}턴 원본 대화]\n${opts.dialogue}\n\n[요약 대상 RP source 턴]\n${sourceCoverage}\n위 source 턴의 앞·중간·뒤를 모두 검토한다. 서로 다른 중요한 사건이 있으면 마지막 턴 하나로 축소하지 말고 인과 순서로 보존한다. OPENING/PRELUDE CONTEXT가 있으면 턴 1~${opts.endTurn} 이해에 필요한 설정·사실만 보존하고 장식적 인사만은 요약하지 않는다. 최종 출력에는 점검표나 턴 번호를 쓰지 않는다.\n\n캐릭터: ${opts.charName}${characterBlock}${personaBlock}\n\n[${sourceTurnCount}턴 히스토리 요약] 최대 ${ROLLING_SUMMARY_MAX_CHARS}자. OOC·UI·SNS mock·RP 중단 연출은 제외하고 RP 사건만 요약:`;
  const finishSummary = (raw: string): string => {
    const cleaned = normalizeSummaryText(raw);
    if (!cleaned) return "";
    return clampMemoryRecordSummary(cleaned, ROLLING_SUMMARY_MAX_CHARS, ROLLING_SUMMARY_MIN_CHARS);
  };
  const callLlm: RollingSummaryLlmCaller =
    summarizeTurnBatchCallerOverride ??
    ((system, history, turnTrace, requestKind) =>
      callGeminiBackground(system, history, turnTrace, requestKind));

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { text } = await callLlm(
        `${systemPrompt}\n\n${ROLLING_SUMMARY_EPISTEMIC_POLICY}`,
        [{ role: "user", content: userContent }],
        opts.turnTrace,
        attempt === 0 ? "background-memory-extract" : "background-memory-extract-retry"
      );
      const first = finishSummary(text);
      const narrative = validateSummaryNarrative(first, "main_canon");
      const grounded = narrative.ok
        ? isRollingSummaryGroundedInDialogue(narrative.text, opts.dialogue)
        : false;
      if (narrative.ok && grounded) {
        return narrative.text;
      }
      lastSummarizeTurnBatchError = narrative.ok
        ? "SUMMARY_NOT_GROUNDED"
        : `SUMMARY_INVALID:${narrative.reason}`;
      // Log the rejected candidate so we can see WHY grounding failed
      // (which sentence tripped the certainty-inflation guard).
      console.warn("[memory] rolling summary rejected; retrying", {
        chars: first.length,
        narrativeValid: narrative.ok,
        grounded,
        nextAttempt: attempt + 2,
        rejectedSummaryPreview: first.slice(0, 400),
      });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      lastSummarizeTurnBatchError = msg.slice(0, 300);
      console.warn(
        `[memory] ${resolveSummaryLogLabel()} background LLM 실패${attempt >= 1 ? ` (재시도 ${attempt + 1}/3)` : ""}:`,
        msg
      );
      if (attempt >= 2) break;
    }
  }

  // Empty return preserves prior valid summary (caller must not overwrite with blank).
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

export function resolveBatchStartTurnForTurnNumber(
  turnNumber: number,
  records?: Array<{ turnStart: number; turnEnd: number; inactive?: boolean }>
): number {
  if (records) return resolveBatchStartForTurnNumber(turnNumber, records);
  const n = Math.max(1, Math.floor(turnNumber));
  const interval = ROLLING_SUMMARY_INTERVAL;
  let start = Math.floor((n - 1) / interval) * interval + 1;
  while (start + interval - 1 < n) {
    start += interval;
  }
  return start;
}

type ComposeBatchScopeMode = "seal" | "regen";

type ComposedBatchScope =
  | {
      ok: true;
      scopes: ScopePayloadV1["scopes"];
      summaryKind: MemorySummaryScope;
      branchId: string | null;
      branchStatus: BranchStatus | null;
      promotedBy: string | null;
      promotedAt: string | null;
      displaySummary: string;
      reasonTag: string;
      mainModelCalls: number;
      /**
       * Sole-closed reopen branch id (compose-only signal for scope attach).
       * Actual DB reopen is applied via pendingBranchControlOps inside persist txn.
       */
      pendingSoleClosedReopenId: string | null;
      /**
       * Branch control ops in source-turn order — applied inside persist transaction.
       * Typical: reopen_branch → close_active_branches (resume then close/adopt).
       */
      pendingBranchControlOps: PendingBranchControlOp[];
    }
  | { ok: false; reason: string; detail?: string | null };

/**
 * Rebuild every scope for a stored summary batch from current surviving messages.
 * seal: first persist (may promote/close other rows from explicit user commands).
 * regen: full payload replace; preserves explicit branch/adopt provenance; no cross-row promote.
 */
export async function composeBatchScopePayload(opts: {
  chatId: number;
  batchStart: number;
  endTurn: number;
  allEntries: Array<{
    turnIndex: number;
    turn: DialogueTurn;
    userMessageId?: number | null;
  }>;
  charName: string;
  characterIdentity?: string | null;
  userPersona?: string | null;
  openingPrelude?: string | null;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
  mode: ComposeBatchScopeMode;
  existingRecord?: MemoryRecordView | null;
  previousWasNoncanonOrBranch: boolean;
  priorRecords: MemoryRecordView[];
}): Promise<ComposedBatchScope> {
  // Deterministic sole-closed reopen candidate (pending only — no DB mutation here).
  const hasActivePriorBranch = opts.priorRecords.some(
    (r) =>
      !r.inactive &&
      r.summaryKind === "branch_canon" &&
      r.branchStatus === "active"
  );
  const hasPriorDbNoncanon = opts.priorRecords.some(
    (r) => !r.inactive && r.summaryKind === "noncanon"
  );
  const closedBranchIds = listClosedBranchIdsFromRecords(opts.priorRecords);
  // Active/noncanon "계속" path — keep broad continue (incl. in-scene dialogue).
  const hasContinueIntentEarly = opts.allEntries.some((e) =>
    shouldPromoteBranchContinue(e.turn.user)
  );
  // Sole-closed auto reopen — STRICT explicit IF/branch resume only (not bare 계속 / RP action).
  const resumeSourceEntry = opts.allEntries.find((e) =>
    isExplicitClosedBranchContinueIntent(e.turn.user)
  );
  const resumeSourceTurnIndex = resumeSourceEntry?.turnIndex ?? null;
  const hasExplicitSoleClosedContinueIntent = resumeSourceTurnIndex != null;

  // Pre-resume turns in the sealing batch count as noncanon candidates (not only prior DB).
  let hasBatchPreResumeNoncanon = false;
  if (resumeSourceTurnIndex != null) {
    const preResumeEntries = opts.allEntries.filter(
      (e) => e.turnIndex < resumeSourceTurnIndex
    );
    if (preResumeEntries.length > 0) {
      const preResumePlan = classifyMemoryBatchScopes(preResumeEntries, {
        previousWasNoncanonOrBranch: opts.previousWasNoncanonOrBranch,
      });
      hasBatchPreResumeNoncanon =
        preResumePlan.noncanonTurns.length > 0 ||
        preResumePlan.primaryKind === "noncanon" ||
        preResumePlan.primaryKind === "branch_canon" ||
        preResumePlan.wantsBranchContinue;
    }
  }
  const hasNoncanonCandidate = hasPriorDbNoncanon || hasBatchPreResumeNoncanon;

  const pendingSoleClosedReopenId =
    opts.mode === "seal"
      ? resolveSoleClosedContinueReopen({
          hasActiveBranch: hasActivePriorBranch,
          hasNoncanonCandidate,
          closedBranchIds,
          hasContinueIntent: hasExplicitSoleClosedContinueIntent,
        })
      : null;

  // Sole-closed mixed batch: classify pre-resume (main) and post-resume (branch) separately
  // so early main RP is not absorbed into branch_canon.
  let plan = classifyMemoryBatchScopes(opts.allEntries, {
    previousWasNoncanonOrBranch: opts.previousWasNoncanonOrBranch,
  });
  let branchBuilderTurns = plan.noncanonTurns;
  if (pendingSoleClosedReopenId && resumeSourceTurnIndex != null) {
    const preEntries = opts.allEntries.filter(
      (e) => e.turnIndex < resumeSourceTurnIndex
    );
    const postEntries = opts.allEntries.filter(
      (e) => e.turnIndex >= resumeSourceTurnIndex
    );
    const prePlan = classifyMemoryBatchScopes(preEntries, {
      previousWasNoncanonOrBranch: opts.previousWasNoncanonOrBranch,
    });
    const postPlan = classifyMemoryBatchScopes(postEntries, {
      previousWasNoncanonOrBranch: true,
    });
    branchBuilderTurns =
      postPlan.noncanonTurns.length > 0
        ? postPlan.noncanonTurns
        : postEntries.map((e) => ({ turnIndex: e.turnIndex, turn: e.turn }));
    const hasMain = prePlan.mainTurns.length > 0;
    const hasBranch = branchBuilderTurns.length > 0;
    plan = {
      primaryKind:
        hasMain && hasBranch
          ? "main_canon"
          : hasMain
            ? "main_canon"
            : hasBranch
              ? "branch_canon"
              : prePlan.primaryKind,
      classes: [...prePlan.classes, ...postPlan.classes],
      mainTurns: prePlan.mainTurns,
      noncanonTurns: [...prePlan.noncanonTurns, ...branchBuilderTurns],
      preferenceTurns: [...prePlan.preferenceTurns, ...postPlan.preferenceTurns],
      plainOocTurns: [...prePlan.plainOocTurns, ...postPlan.plainOocTurns],
      wantsBranchContinue: true,
      wantsBranchClose: prePlan.wantsBranchClose || postPlan.wantsBranchClose,
      wantsMainAdopt: prePlan.wantsMainAdopt || postPlan.wantsMainAdopt,
    };
  }

  const mainEntries = plan.mainTurns.filter(
    ({ turn }) => turn.assistantOnly === true || isTurnEligibleForMemoryRecord(turn.user)
  );

  const scopes: ScopePayloadV1["scopes"] = {};
  let summaryKind: MemorySummaryScope = plan.primaryKind;
  let reasonTag = "SUMMARY_SUCCESS";
  let branchId: string | null = null;
  let branchStatus: BranchStatus | null = null;
  let promotedBy: string | null = null;
  let promotedAt: string | null = null;
  let mainModelCalls = 0;

  const existing = opts.existingRecord ?? null;
  const adoptLocked =
    opts.mode === "regen" && existing?.promotedBy === "user_main_adopt";

  const continueSrc = findBatchControlSource(opts.allEntries, "branch_continue", {
    previousWasNoncanonOrBranch: opts.previousWasNoncanonOrBranch,
  });
  const closeSrc = findBatchControlSource(opts.allEntries, "branch_close");
  const adoptSrc = findBatchControlSource(opts.allEntries, "main_adopt");

  const activePriorBranch = opts.priorRecords.find(
    (r) =>
      !r.inactive &&
      r.summaryKind === "branch_canon" &&
      r.branchStatus === "active" &&
      !!r.branchId?.trim()
  );

  // Compose never mutates branch control rows — queue ops in source-turn order.
  const pendingBranchControlOps: PendingBranchControlOp[] = [];
  if (opts.mode === "seal") {
    type Staged = { sourceTurn: number; op: PendingBranchControlOp };
    const staged: Staged[] = [];
    if (pendingSoleClosedReopenId && resumeSourceEntry && resumeSourceTurnIndex != null) {
      staged.push({
        sourceTurn: resumeSourceTurnIndex,
        op: {
          op: "reopen_branch",
          branchId: pendingSoleClosedReopenId,
          sourceTurn: resumeSourceTurnIndex,
          control: {
            source: "user_turn",
            sourceUserMessageId: resumeSourceEntry.userMessageId ?? null,
            sourceTurn: resumeSourceTurnIndex,
            sourceBatchStart: opts.batchStart,
          },
        },
      });
    }
    if (plan.wantsBranchClose && closeSrc) {
      staged.push({
        sourceTurn: closeSrc.turnIndex,
        op: {
          op: "close_active_branches",
          sourceTurn: closeSrc.turnIndex,
          control: {
            source: "user_turn",
            sourceUserMessageId: closeSrc.userMessageId,
            sourceTurn: closeSrc.turnIndex,
            sourceBatchStart: opts.batchStart,
          },
        },
      });
    } else if (
      plan.wantsMainAdopt &&
      adoptSrc &&
      (pendingSoleClosedReopenId || !!activePriorBranch)
    ) {
      // Adopt must close cross-row active branch after any reopen (no active A left in LTM).
      staged.push({
        sourceTurn: adoptSrc.turnIndex,
        op: {
          op: "close_active_branches",
          sourceTurn: adoptSrc.turnIndex,
          control: {
            source: "user_turn",
            sourceUserMessageId: adoptSrc.userMessageId,
            sourceTurn: adoptSrc.turnIndex,
            sourceBatchStart: opts.batchStart,
          },
        },
      });
    }
    staged.sort((a, b) => a.sourceTurn - b.sourceTurn);
    for (const s of staged) pendingBranchControlOps.push(s.op);
  }

  if (plan.preferenceTurns.length > 0) {
    scopes.preference = buildPreferenceSummaryFromTurns(plan.preferenceTurns);
  }

  const branchOrNoncanonTurns =
    pendingSoleClosedReopenId && branchBuilderTurns.length > 0
      ? branchBuilderTurns
      : plan.noncanonTurns;

  if (branchOrNoncanonTurns.length > 0) {
    const nonText = buildNoncanonSummaryFromTurns(branchOrNoncanonTurns);
    const userWantsBranch =
      plan.wantsBranchContinue ||
      plan.primaryKind === "branch_canon" ||
      !!pendingSoleClosedReopenId;
    // Regen must keep an existing branch row as branch_canon (active or closed),
    // and must not invent a new branch from assistant text alone.
    const preserveBranchScope =
      opts.mode === "regen" &&
      existing?.summaryKind === "branch_canon" &&
      !plan.wantsMainAdopt &&
      !adoptLocked;

    if ((userWantsBranch || preserveBranchScope) && !adoptLocked) {
      scopes.branch_canon = nonText;
      // Mixed sole-closed: keep primaryKind main_canon when main exists; else branch_canon.
      if (!(pendingSoleClosedReopenId && mainEntries.length > 0)) {
        summaryKind = "branch_canon";
      }
      if (opts.mode === "regen" && existing?.branchId) {
        branchId = existing.branchId;
        if (plan.wantsBranchClose) {
          branchStatus = "closed";
        } else if (existing.branchStatus === "closed" && !plan.wantsBranchContinue) {
          branchStatus = "closed";
        } else {
          branchStatus = "active";
        }
        promotedBy = existing.promotedBy;
        promotedAt = existing.promotedAt;
      } else if (pendingSoleClosedReopenId) {
        // Attach branch scope to the pending sole-closed branch — never mint a new id.
        // Final status may be closed when the same batch later closes/adopts (ops after persist).
        branchId = pendingSoleClosedReopenId;
        branchStatus =
          plan.wantsBranchClose || plan.wantsMainAdopt ? "closed" : "active";
        promotedBy = "user_continue";
        promotedAt = new Date().toISOString();
      } else if (
        opts.mode === "seal" &&
        activePriorBranch?.branchId &&
        (plan.wantsBranchContinue || hasContinueIntentEarly)
      ) {
        // P1-B Path A: keep active branch_id; never auto-promote prior noncanon
        // (no deterministic IF identity linking noncanon rows to this branch).
        branchId = activePriorBranch.branchId;
        branchStatus = "active";
        promotedBy = activePriorBranch.promotedBy ?? "user_continue";
        promotedAt = activePriorBranch.promotedAt ?? new Date().toISOString();
      } else {
        branchId = `branch-${opts.chatId}-${opts.batchStart}`;
        branchStatus = "active";
        promotedBy = "user_continue";
        promotedAt = new Date().toISOString();
        if (opts.mode === "seal") {
          const toPromote = selectLatestContiguousNoncanonRecordIds(opts.priorRecords);
          if (toPromote.length > 0) {
            pendingBranchControlOps.push({
              op: "promote_noncanon_records",
              recordIds: toPromote,
              branchId,
              promotedBy: "user_continue",
              sourceTurn: continueSrc?.turnIndex ?? opts.batchStart,
              control: {
                source: "user_turn",
                sourceUserMessageId: continueSrc?.userMessageId ?? null,
                sourceTurn: continueSrc?.turnIndex ?? null,
                sourceBatchStart: opts.batchStart,
              },
            });
          }
        }
      }
    } else if (!adoptLocked) {
      scopes.noncanon = nonText;
      if (summaryKind === "empty_ooc") summaryKind = "noncanon";
    } else {
      // Adopted main timeline: keep IF beats inside main_canon, never re-open noncanon.
      scopes.main_canon = [scopes.main_canon, nonText].filter(Boolean).join("\n");
    }
  }

  if (mainEntries.length === 0 && !scopes.noncanon && !scopes.branch_canon && !scopes.preference && !scopes.main_canon) {
    scopes.empty_ooc = buildEmptyOocBatchPlaceholder(opts.batchStart, opts.endTurn);
    summaryKind = "empty_ooc";
    reasonTag = "SUMMARY_OOC_PLACEHOLDER";
    if (pendingSoleClosedReopenId) {
      branchId = pendingSoleClosedReopenId;
      branchStatus =
        plan.wantsBranchClose || plan.wantsMainAdopt ? "closed" : "active";
    }
  } else if (
    mainEntries.length > 0 &&
    summaryKind === "branch_canon" &&
    !!branchId &&
    !!scopes.branch_canon &&
    !pendingSoleClosedReopenId
  ) {
    // Active-branch continue (non-sole-closed): do not overwrite with main_canon.
    delete scopes.main_canon;
  } else if (mainEntries.length > 0) {
    const dialogue = formatBatchDialogue(mainEntries, opts.charName);
    const summaryStartTurn = mainEntries[0]!.turnIndex;
    const summaryEndTurn = mainEntries[mainEntries.length - 1]!.turnIndex;
    let narrative = "";
    try {
      mainModelCalls = 1;
      narrative = await summarizeTurnBatch({
        dialogue,
        charName: opts.charName,
        characterIdentity: opts.characterIdentity,
        startTurn: summaryStartTurn,
        endTurn: summaryEndTurn,
        sourceTurnIndexes: mainEntries.map((entry) => entry.turnIndex),
        userPersona: opts.userPersona,
        openingPrelude: opts.openingPrelude,
        turnTrace: opts.turnTrace,
      });
    } catch (e) {
      const msg = (e as Error).message ?? "";
      const reason = /timeout|aborted|ETIMEDOUT/i.test(msg)
        ? "SUMMARY_TIMEOUT"
        : "SUMMARY_EMPTY";
      console.error(
        `[memory] ${reason} chat=${opts.chatId} turns=${opts.batchStart}-${opts.endTurn}`,
        msg
      );
      return { ok: false, reason, detail: msg.slice(0, 300) };
    }

    if (!narrative.trim()) {
      console.error(
        `[memory] SUMMARY_EMPTY chat=${opts.chatId} turns=${opts.batchStart}-${opts.endTurn} — batch pending retry`,
        { summarizeError: lastSummarizeTurnBatchError }
      );
      return {
        ok: false,
        reason: "SUMMARY_EMPTY",
        detail: lastSummarizeTurnBatchError,
      };
    }
    narrative = stripOocFromMemorySummary(narrative);
    if (!narrative.trim()) {
      console.error(
        `[memory] SUMMARY_EMPTY after OOC strip chat=${opts.chatId} turns=${opts.batchStart}-${opts.endTurn}`
      );
      return { ok: false, reason: "SUMMARY_EMPTY", detail: "OOC_STRIP" };
    }
    scopes.main_canon = [scopes.main_canon, narrative].filter(Boolean).join("\n");
    if (opts.mode === "regen" && existing?.summaryKind === "branch_canon") {
      summaryKind = "branch_canon";
      scopes.branch_canon =
        scopes.branch_canon ??
        existing.scopes.branch_canon ??
        existing.summary;
      branchId = existing.branchId ?? branchId;
      branchStatus = existing.branchStatus ?? branchStatus;
      promotedBy = existing.promotedBy ?? promotedBy;
      promotedAt = existing.promotedAt ?? promotedAt;
    } else {
      summaryKind = "main_canon";
    }
  }

  const shouldAdopt =
    (plan.wantsMainAdopt || adoptLocked) && (scopes.branch_canon || scopes.noncanon);
  if (shouldAdopt) {
    const adopted = scopes.branch_canon || scopes.noncanon || "";
    scopes.main_canon = [scopes.main_canon, adopted].filter(Boolean).join("\n");
    delete scopes.branch_canon;
    delete scopes.noncanon;
    summaryKind = "main_canon";
    branchStatus = "closed";
    promotedBy = "user_main_adopt";
    promotedAt =
      adoptLocked && existing?.promotedAt
        ? existing.promotedAt
        : new Date().toISOString();
    if (opts.mode === "regen" && existing?.branchId) {
      branchId = existing.branchId;
    }
  }

  // Regen must not reopen a closed branch without an explicit user continue.
  if (
    opts.mode === "regen" &&
    existing?.branchStatus === "closed" &&
    !plan.wantsBranchContinue &&
    !plan.wantsMainAdopt
  ) {
    branchStatus = "closed";
    branchId = existing.branchId ?? branchId;
    if (existing.promotedBy && !promotedBy) {
      promotedBy = existing.promotedBy;
      promotedAt = existing.promotedAt;
    }
  }

  const displaySummary = displaySummaryFromScopes(scopes, summaryKind);
  const validated = validateSummaryNarrative(displaySummary, summaryKind);
  if (!validated.ok) {
    console.error(
      `[memory] ${validated.reason} chat=${opts.chatId} turns=${opts.batchStart}-${opts.endTurn}`
    );
    return { ok: false, reason: validated.reason, detail: "VALIDATE" };
  }

  return {
    ok: true,
    scopes,
    summaryKind: validated.kind,
    branchId,
    branchStatus,
    promotedBy,
    promotedAt,
    displaySummary: validated.text,
    reasonTag,
    mainModelCalls,
    pendingSoleClosedReopenId,
    pendingBranchControlOps,
  };
}

async function persistComposedBatchScopes(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  tier: MemoryTier;
  memoryCapacity: number;
  batchStart: number;
  endTurn: number;
  lastAssistantId: number | null;
  playableCount: number;
  composed: Extract<ComposedBatchScope, { ok: true }>;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
  logLabel: string;
  boundarySnapshot: MemorySourceBoundary;
  sourceUserMessageIds: number[];
  allEntries: Array<{
    turnIndex: number;
    turn: DialogueTurn;
    userMessageId?: number | null;
  }>;
  previousWasNoncanonOrBranch?: boolean;
  skipEpisodicExtract?: boolean;
  charName?: string;
  dialogue?: string;
}): Promise<boolean> {
  const scopePayload: ScopePayloadV1 = {
    v: 1,
    scopes: opts.composed.scopes,
    branchId: opts.composed.branchId,
    branchStatus: opts.composed.branchStatus,
    promotedBy: opts.composed.promotedBy,
    promotedAt: opts.composed.promotedAt,
  };

  const persisted = persistValidatedSummaryBatch({
    chatId: opts.chatId,
    userId: opts.userId,
    characterId: opts.characterId,
    tier: opts.tier,
    turnStart: opts.batchStart,
    turnEnd: opts.endTurn,
    assistantMessageId: opts.lastAssistantId,
    summary: opts.composed.displaySummary,
    summaryKind: opts.composed.summaryKind,
    scopePayload,
    branchId: opts.composed.branchId,
    branchStatus: opts.composed.branchStatus,
    promotedBy: opts.composed.promotedBy,
    promotedAt: opts.composed.promotedAt,
    userEdited: false,
    playableTurnCount: opts.playableCount,
    boundarySnapshot: opts.boundarySnapshot,
    sourceUserMessageIds: opts.sourceUserMessageIds,
    sourceStartUserMessageId: opts.sourceUserMessageIds[0] ?? null,
    sourceEndUserMessageId:
      opts.sourceUserMessageIds[opts.sourceUserMessageIds.length - 1] ?? null,
    pendingBranchControlOps: opts.composed.pendingBranchControlOps,
    __testThrowAfterUpsert: persistForceFailAfterUpsertForTests || undefined,
    __testThrowAfterBranchOps: persistForceFailAfterBranchOpsForTests || undefined,
  });

  if (!persisted.ok) {
    if (persisted.reason === "STALE_MEMORY_EPOCH") {
      console.info("MEMORY_STALE_EPOCH_REJECTED", {
        chat_id: opts.chatId,
        epoch: opts.boundarySnapshot.epoch,
        source_message_id:
          opts.sourceUserMessageIds[opts.sourceUserMessageIds.length - 1] ?? null,
      });
      return false;
    }
    console.error(
      `[memory] SUMMARY_PERSIST_FAILED reason=${persisted.reason} chat=${opts.chatId} turns=${opts.batchStart}-${opts.endTurn}`,
      persisted.error
    );
    return false;
  }

  const lorebookBudget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity).lorebook;
  const db = getDb();
  if (
    !isMemoryWriteGuardCurrentCore(db, {
      chatId: opts.chatId,
      snapshot: opts.boundarySnapshot,
      sourceUserMessageIds: opts.sourceUserMessageIds,
    })
  ) {
    return true;
  }
  let currentMemory = rebuildLorebookFromRecords(opts.chatId);
  if (currentMemory.length > lorebookBudget) {
    try {
      const compacted = await compactCurrentMemory(
        currentMemory,
        lorebookBudget,
        opts.turnTrace
      );
      if (compacted.trim()) {
        const compactedText = compacted;
        const compactCommitted = db.transaction(() => {
          if (
            !isMemoryWriteGuardCurrentCore(db, {
              chatId: opts.chatId,
              snapshot: opts.boundarySnapshot,
              sourceUserMessageIds: opts.sourceUserMessageIds,
            })
          ) {
            return false;
          }
          updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
            recent_summary: compactedText,
            membership_tier: opts.tier,
            last_compressed_at: new Date().toISOString(),
          });
          syncChatLongTermMemory(opts.chatId, compactedText);
          return true;
        }).immediate();
        if (compactCommitted) currentMemory = compactedText;
      }
    } catch (e) {
      console.warn(
        `[memory] lorebook compact skipped after ${opts.logLabel} — keeping prior text:`,
        (e as Error).message
      );
    }
  }

  console.info(
    `[memory] ${opts.logLabel} chat=${opts.chatId} turns=${opts.batchStart}-${opts.endTurn} (${opts.composed.displaySummary.length}ch → lorebook ${currentMemory.length}/${lorebookBudget}ch) reason=${opts.composed.reasonTag} mainCalls=${opts.composed.mainModelCalls}`
  );

  if (opts.charName && !opts.skipEpisodicExtract) {
    try {
      const episodicEntries = selectEpisodicEligibleTurnEntries(opts.allEntries, {
        previousWasNoncanonOrBranch: opts.previousWasNoncanonOrBranch,
      });
      if (episodicEntries.length > 0) {
        const episodicDialogue = formatBatchDialogue(
          episodicEntries.map((entry) => ({
            turnIndex: entry.turnIndex,
            turn: entry.turn,
          })),
          opts.charName
        );
        const batchUserSources = opts.allEntries.map((entry) => ({
          turn: entry.turnIndex,
          messageId: entry.userMessageId ?? null,
          text: entry.turn.user,
        }));
        await extractAndPersistEpisodicFactsForSealedBatch({
          chatId: opts.chatId,
          userId: opts.userId,
          characterId: opts.characterId,
          charName: opts.charName,
          startTurn: opts.batchStart,
          endTurn: opts.endTurn,
          dialogue: episodicDialogue,
          batchUserSources,
          boundarySnapshot: opts.boundarySnapshot,
          turnTrace: opts.turnTrace,
        });
      }
    } catch (e) {
      console.warn("[memory] episodic seal extract skipped (best-effort)", {
        chat_id: opts.chatId,
        error: (e as Error).message?.slice(0, 200) ?? "unknown",
      });
    }
  }
  return true;
}

/** Rebuild + replace full scopePayload for an existing stored batch (regen paths). */
async function rebuildExistingBatchScopePayload(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  characterIdentity?: string | null;
  tier: MemoryTier;
  memoryCapacity: number;
  userPersona?: string | null;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
  batchStart: number;
  existingRecord: MemoryRecordView;
  logLabel: string;
}): Promise<boolean> {
  const boundarySnapshot = getMemorySourceBoundary(opts.chatId);
  const allTurns = loadMemoryEligibleChatTurnsWithMessageIds(opts.chatId, boundarySnapshot);
  const endTurn = opts.existingRecord.turnEnd;
  const batchMeta = allTurns.filter(
    (t) => t.turnNumber >= opts.batchStart && t.turnNumber <= endTurn
  );
  if (batchMeta.length === 0) return false;
  const allEntries = batchMeta.map((meta) => ({
    turnIndex: meta.turnNumber,
    turn: { user: meta.user, assistant: meta.assistant } satisfies DialogueTurn,
    userMessageId: meta.userMessageId,
  }));

  const priorRecords = listMemoryRecordsForChat(opts.chatId);
  const previousWasNoncanonOrBranch = priorRecords.some(
    (r) =>
      r.turnStart !== opts.batchStart &&
      !r.inactive &&
      (r.summaryKind === "noncanon" ||
        (r.summaryKind === "branch_canon" && r.branchStatus === "active"))
  );

  const composed = await composeBatchScopePayload({
    chatId: opts.chatId,
    batchStart: opts.batchStart,
    endTurn,
    allEntries,
    charName: opts.charName,
    characterIdentity: opts.characterIdentity,
    userPersona: opts.userPersona,
    openingPrelude: resolveOpeningPreludeForBatch(opts.chatId, opts.batchStart),
    turnTrace: opts.turnTrace,
    mode: "regen",
    existingRecord: opts.existingRecord,
    previousWasNoncanonOrBranch,
    priorRecords,
  });
  if (!composed.ok) return false;

  const lastAssistantId = batchMeta[batchMeta.length - 1]?.assistantMessageId ?? null;
  const playableCount = allTurns.filter((t) => t.turnNumber > 0).length;
  return persistComposedBatchScopes({
    chatId: opts.chatId,
    userId: opts.userId,
    characterId: opts.characterId,
    tier: opts.tier,
    memoryCapacity: opts.memoryCapacity,
    batchStart: opts.batchStart,
    endTurn,
    lastAssistantId,
    playableCount,
    composed,
    turnTrace: opts.turnTrace,
    logLabel: opts.logLabel,
    boundarySnapshot,
    sourceUserMessageIds: batchMeta
      .map((turn) => turn.userMessageId)
      .filter((id): id is number => id != null),
    allEntries,
    previousWasNoncanonOrBranch,
    charName: opts.charName,
  });
}

/** 재생성 — 해당 턴이 속한 요약 배치의 scopePayload 전체를 현재 DB 대화 기준으로 재구성 */
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

  const allTurns = loadMemoryEligibleChatTurnsWithMessageIds(opts.chatId);
  const target = allTurns.find((t) => t.assistantMessageId === opts.assistantMessageId);
  if (!target) return false;

  const batchStart = resolveBatchStartForTurnNumber(
    target.turnNumber,
    listMemoryRecordsForChat(opts.chatId)
  );
  const record = listMemoryRecordsForChat(opts.chatId).find((r) => r.turnStart === batchStart);
  // Soft-deleted rows are absent for rebuild — reseal when the deferred trigger allows.
  if (record?.userEdited && !record.inactive) return false;

  const memory = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);
  const eligibleCount = allTurns.filter((t) => t.turnNumber > 0).length;
  if ((memory.message_count ?? 0) !== eligibleCount) {
    getDb()
      .prepare(
        `UPDATE chat_memories SET message_count=?, updated_at=datetime('now') WHERE chat_id=?`
      )
      .run(eligibleCount, opts.chatId);
  }
  const summarized = memory.summarized_turn_count ?? 0;
  if (!record || record.inactive) {
    if (shouldTriggerRollingSummary(eligibleCount, summarized)) {
      void processRollingSummaryBatch(opts).catch((e) => {
        console.warn("[memory] regen seal pending batch failed:", (e as Error).message);
      });
    }
    return false;
  }

  return withRollingSummaryLock(
    opts.chatId,
    () =>
      rebuildExistingBatchScopePayload({
        chatId: opts.chatId,
        userId: opts.userId,
        characterId: opts.characterId,
        charName: opts.charName,
        characterIdentity: opts.characterIdentity,
        tier: opts.tier,
        memoryCapacity: opts.memoryCapacity,
        userPersona: opts.userPersona,
        turnTrace: opts.turnTrace,
        batchStart,
        existingRecord: record,
        logLabel: `regen batch refresh assistant=${opts.assistantMessageId}`,
      }),
    { coalesce: false }
  ).catch((e) => {
    console.warn("[memory] regen batch refresh failed:", (e as Error).message);
    return false;
  });
}

export function pickNextSummaryBatch(
  turns: DialogueTurn[],
  summarizedTurnCount: number
): DialogueTurn[] {
  const { playable } = splitOpeningPlayableTurns(turns);
  const interval = ROLLING_SUMMARY_INTERVAL;
  const pending = playable.length - summarizedTurnCount;
  if (pending < interval) return [];
  return playable.slice(summarizedTurnCount, summarizedTurnCount + interval);
}

/** 5턴 1배치 → 기억 기록 저장 + 로어북(recent_summary) 누적 (원자적·연속 배치) */
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
  // Coalesce: panel backfill + "지금 생성하기" share one in-flight seal instead of
  // the second call returning false immediately (busy lock).
  return withRollingSummaryLock(opts.chatId, async () => {
    try {
      const memory = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);
      const boundarySnapshot = getMemorySourceBoundary(opts.chatId);
      const playableMeta = loadMemoryEligibleChatTurnsWithMessageIds(
        opts.chatId,
        boundarySnapshot
      );
      const playableCount = playableMeta.length;

      // Counter must follow contiguous *active* batches — never trust stale summarized_turn_count alone.
      // Soft-deleted (inactive) rows do not count as sealed and do not block reseal.
      const records = listMemoryRecordsForChat(opts.chatId);
      let summarized = highestContiguousCompletedTurn(records, playableCount);
      if ((memory.summarized_turn_count ?? 0) !== summarized) {
        summarized = reconcileSummarizedTurnCountFromTable({
          chatId: opts.chatId,
          userId: opts.userId,
          characterId: opts.characterId,
          tier: opts.tier,
          playableTurnCount: playableCount,
          boundarySnapshot,
        });
        console.warn("[memory] SUMMARY_COUNTER_DRIFT reconciled", {
          chatId: opts.chatId,
          was: memory.summarized_turn_count,
          now: summarized,
        });
      }

      const missingEarliest = earliestMissingBatchStart(records, playableCount);
      const nextBatch = resolveNextBatchRange(summarized, playableCount);
      const batchStart = missingEarliest ?? nextBatch?.turnStart ?? summarized + 1;
      if (!batchStart || batchStart < 1) return false;
      const existingSame = records.find((r) => !r.inactive && r.turnStart === batchStart);
      const endTurn =
        existingSame?.turnEnd ??
        nextBatch?.turnEnd ??
        newBatchEndForStart(batchStart);

      if (nextBatch && batchStart !== nextBatch.turnStart && !missingEarliest) {
        console.warn("[memory] SUMMARY_BATCH_GAP refuse non-contiguous batch", {
          chatId: opts.chatId,
          batchStart,
          nextStart: nextBatch.turnStart,
          missingEarliest,
        });
        return false;
      }

      console.info("MEMORY_SUMMARY_DUE", {
        chat_id: opts.chatId,
        next_start: batchStart,
        next_end: endTurn,
      });

      // Idempotent: active row already present → never call V3 again for this batch.
      if (existingSame) {
        return true;
      }

      const batchMeta = playableMeta.filter(
        (t) => t.turnNumber >= batchStart && t.turnNumber <= endTurn
      );
      if (batchMeta.length < endTurn - batchStart + 1) {
        console.warn("[memory] SUMMARY_BATCH_INCOMPLETE", {
          chatId: opts.chatId,
          batchStart,
          have: batchMeta.length,
          need: endTurn - batchStart + 1,
          playableCount,
        });
        return false;
      }

      // Re-check after lock + load (another worker may have just persisted)
      const latest = listMemoryRecordsForChat(opts.chatId);
      if (latest.some((r) => !r.inactive && r.turnStart === batchStart)) {
        return true;
      }
      const allEntries = batchMeta.map((meta) => ({
        turnIndex: meta.turnNumber,
        turn: { user: meta.user, assistant: meta.assistant } satisfies DialogueTurn,
        userMessageId: meta.userMessageId,
      }));

      const priorRecords = listMemoryRecordsForChat(opts.chatId);
      const previousWasNoncanonOrBranch = priorRecords.some(
        (r) =>
          !r.inactive &&
          (r.summaryKind === "noncanon" ||
            (r.summaryKind === "branch_canon" && r.branchStatus === "active"))
      );

      const composed = await composeBatchScopePayload({
        chatId: opts.chatId,
        batchStart,
        endTurn,
        allEntries,
        charName: opts.charName,
        characterIdentity: opts.characterIdentity,
        userPersona: opts.userPersona,
        openingPrelude: resolveOpeningPreludeForBatch(opts.chatId, batchStart),
        turnTrace: opts.turnTrace,
        mode: "seal",
        existingRecord: null,
        previousWasNoncanonOrBranch,
        priorRecords,
      });
      if (!composed.ok) {
        console.warn("[memory] SUMMARY_COMPOSE_FAILED", {
          chatId: opts.chatId,
          batchStart,
          endTurn,
          reason: composed.reason,
          detail: composed.detail ?? null,
          summarizeError: lastSummarizeTurnBatchError,
        });
        return false;
      }

      const lastAssistantId = batchMeta[batchMeta.length - 1]?.assistantMessageId ?? null;
      return persistComposedBatchScopes({
        chatId: opts.chatId,
        userId: opts.userId,
        characterId: opts.characterId,
        tier: opts.tier,
        memoryCapacity: opts.memoryCapacity,
        batchStart,
        endTurn,
        lastAssistantId,
        playableCount,
        composed,
        turnTrace: opts.turnTrace,
        logLabel: resolveSummaryLogLabel(),
        boundarySnapshot,
        sourceUserMessageIds: batchMeta
          .map((turn) => turn.userMessageId)
          .filter((id): id is number => id != null),
        allEntries,
        previousWasNoncanonOrBranch,
        charName: opts.charName,
      });
    } catch (e) {
      console.error(
        `[memory] rolling summary failed chat=${opts.chatId}:`,
        (e as Error).message
      );
      return false;
    }
  });
}

/** @internal test seam — last summarizeTurnBatch failure (diagnostics) */
export function __getLastSummarizeTurnBatchError(): string | null {
  return lastSummarizeTurnBatchError;
}


/** 패널·API — 특정 요약 배치 scopePayload 전체를 현재 메시지 기준으로 재구성 (유저 수정본은 건너뜀) */
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

  const batchStart = resolveBatchStartForTurnNumber(
    opts.turnStart,
    listMemoryRecordsForChat(opts.chatId)
  );
  const record = listMemoryRecordsForChat(opts.chatId).find((r) => r.turnStart === batchStart);
  if (record?.userEdited) return false;
  if (!record) return false;

  return withRollingSummaryLock(
    opts.chatId,
    () =>
      rebuildExistingBatchScopePayload({
        chatId: opts.chatId,
        userId: opts.userId,
        characterId: opts.characterId,
        charName: opts.charName,
        characterIdentity: opts.characterIdentity,
        tier: opts.tier,
        memoryCapacity: opts.memoryCapacity,
        userPersona: opts.userPersona,
        turnTrace: opts.turnTrace,
        batchStart,
        existingRecord: record,
        logLabel: "regenerateMemoryRecordBatch",
      }),
    { coalesce: false }
  ).catch((e) => {
    console.error("[memory] regenerateMemoryRecordBatch failed:", (e as Error).message);
    return false;
  });
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
  return messageCount >= summarizedTurnCount + ROLLING_SUMMARY_INTERVAL;
}

/** Next batch seal completes at this playable turn. */
export function summarySealAtTurn(summarizedTurnCount = 0): number {
  return summarizedTurnCount + ROLLING_SUMMARY_INTERVAL;
}

export function turnsUntilNextSummary(
  messageCount: number,
  summarizedTurnCount = 0
): number {
  const sealAt = summarySealAtTurn(summarizedTurnCount);
  if (messageCount >= sealAt) return 0;
  return sealAt - messageCount;
}

export type SummaryBarrierResult =
  | { ok: true; summarizedThrough: number }
  | { ok: false; reason: string; pendingRange: string };

export type NonBlockingSummaryPrepResult = {
  summarizedThrough: number;
  unsummarizedTurns: number;
  pendingRange: string | null;
  catchUpScheduled: boolean;
};

/** Read committed summary frontier — no LLM, no await. */
export function resolveCommittedSummaryFrontier(
  chatId: number,
  completedTurns: number
): number {
  if (!isMemoryFeatureEnabled()) return 0;
  const records = listMemoryRecordsForChat(chatId);
  return highestContiguousCompletedTurn(records, completedTurns);
}

/**
 * Schedule durable summary catch-up off the main RP critical path.
 * Reuses DB rows + single-flight lock — not a separate queue system.
 */
export function scheduleSummaryCatchUpDurable(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  characterIdentity?: string | null;
  tier: MemoryTier;
  memoryCapacity: number;
  userPersona?: string | null;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
  maxRounds?: number;
}): boolean {
  if (!isMemoryFeatureEnabled()) return false;

  if (
    isRollingSummaryInFlight(opts.chatId) ||
    catchUpScheduledChats.has(opts.chatId)
  ) {
    console.info("MEMORY_SUMMARY_CATCHUP_COALESCED", { chat_id: opts.chatId });
    return true;
  }

  catchUpScheduledChats.add(opts.chatId);
  void catchUpRollingSummaries({
    chatId: opts.chatId,
    userId: opts.userId,
    characterId: opts.characterId,
    charName: opts.charName,
    tier: opts.tier,
    memoryCapacity: opts.memoryCapacity,
    maxRounds: opts.maxRounds ?? 5,
  })
    .catch((e) => {
      console.error("[memory] summary catch-up failed (non-blocking):", {
        chat_id: opts.chatId,
        error: (e as Error).message,
      });
    })
    .finally(() => {
      catchUpScheduledChats.delete(opts.chatId);
    });

  return true;
}

/**
 * Non-blocking summary prep for main RP — reads committed frontier, schedules catch-up,
 * never awaits summary LLM on the chat critical path.
 */
export function prepareNonBlockingSummaryForMainRp(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  characterIdentity?: string | null;
  tier: MemoryTier;
  memoryCapacity: number;
  userPersona?: string | null;
  completedTurns: number;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
}): NonBlockingSummaryPrepResult {
  if (!isMemoryFeatureEnabled()) {
    return {
      summarizedThrough: 0,
      unsummarizedTurns: opts.completedTurns,
      pendingRange: null,
      catchUpScheduled: false,
    };
  }

  const summarizedThrough = resolveCommittedSummaryFrontier(
    opts.chatId,
    opts.completedTurns
  );
  const unsummarizedTurns = Math.max(0, opts.completedTurns - summarizedThrough);
  const needsCatchUp = unsummarizedTurns > RAW_HISTORY_COMPLETE_EXCHANGES;
  const next = resolveNextBatchRange(summarizedThrough, opts.completedTurns);
  const pendingRange =
    needsCatchUp && next ? `${next.turnStart}~${next.turnEnd}` : null;

  if (needsCatchUp) {
    console.info("MEMORY_SUMMARY_CATCHUP_SCHEDULED", {
      chat_id: opts.chatId,
      summarized_through: summarizedThrough,
      completed_turns: opts.completedTurns,
      unsummarized: unsummarizedTurns,
      pending_range: pendingRange,
    });
  }

  const catchUpScheduled = needsCatchUp
    ? scheduleSummaryCatchUpDurable({
        chatId: opts.chatId,
        userId: opts.userId,
        characterId: opts.characterId,
        charName: opts.charName,
        characterIdentity: opts.characterIdentity,
        tier: opts.tier,
        memoryCapacity: opts.memoryCapacity,
        userPersona: opts.userPersona,
        turnTrace: opts.turnTrace,
        maxRounds:
          unsummarizedTurns > RAW_HISTORY_COMPLETE_EXCHANGES + ROLLING_SUMMARY_INTERVAL
            ? 8
            : 5,
      })
    : false;

  return {
    summarizedThrough,
    unsummarizedTurns,
    pendingRange,
    catchUpScheduled,
  };
}

/** Await/coalesce pending summary seals before main-model context assembly. */
export async function ensureSummaryBarrier(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  characterIdentity?: string | null;
  tier: MemoryTier;
  memoryCapacity: number;
  userPersona?: string | null;
  completedTurns: number;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
}): Promise<SummaryBarrierResult> {
  if (!isMemoryFeatureEnabled()) {
    return { ok: true, summarizedThrough: 0 };
  }

  const recordsInitial = listMemoryRecordsForChat(opts.chatId);
  const summarizedInitial = highestContiguousCompletedTurn(
    recordsInitial,
    opts.completedTurns
  );
  if (!isSummaryBarrierActive()) {
    return { ok: true, summarizedThrough: summarizedInitial };
  }

  const maxRounds = 4;
  for (let round = 0; round < maxRounds; round++) {
    const records = listMemoryRecordsForChat(opts.chatId);
    const summarized = highestContiguousCompletedTurn(records, opts.completedTurns);
    const unsummarized = opts.completedTurns - summarized;
    if (unsummarized <= RAW_HISTORY_COMPLETE_EXCHANGES) {
      return { ok: true, summarizedThrough: summarized };
    }

    const next = resolveNextBatchRange(summarized, opts.completedTurns);
    const pendingRange = next
      ? `${next.turnStart}~${next.turnEnd}`
      : `${summarized + 1}~?`;

    if (unsummarized > RAW_HISTORY_COMPLETE_EXCHANGES + 1) {
      console.info("MEMORY_COVERAGE_LAG", {
        chat_id: opts.chatId,
        summarized_through: summarized,
        completed_turns: opts.completedTurns,
        unsummarized,
      });
    }

    if (isRollingSummaryInFlight(opts.chatId)) {
      console.info("MEMORY_SUMMARY_BARRIER_WAIT", {
        chat_id: opts.chatId,
        pending_range: pendingRange,
      });
    }

    const ok = await processRollingSummaryBatch(opts);
    if (!ok) {
      console.error("MEMORY_SUMMARY_BARRIER_FAILED", {
        chat_id: opts.chatId,
        pending_range: pendingRange,
        reason: lastSummarizeTurnBatchError ?? "SUMMARY_SEAL_FAILED",
      });
      return {
        ok: false,
        reason: "SUMMARY_BARRIER_FAILED",
        pendingRange,
      };
    }
  }

  const records = listMemoryRecordsForChat(opts.chatId);
  const summarized = highestContiguousCompletedTurn(records, opts.completedTurns);
  if (opts.completedTurns - summarized <= RAW_HISTORY_COMPLETE_EXCHANGES) {
    return { ok: true, summarizedThrough: summarized };
  }
  return {
    ok: false,
    reason: "SUMMARY_BARRIER_FAILED",
    pendingRange: `${summarized + 1}~?`,
  };
}
