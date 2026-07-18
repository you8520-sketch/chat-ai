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
import { clampMemoryRecordSummary } from "./memory-summary-clamp";
import { resolveMemoryBudgetFromCapacity } from "./memory-capacity-shared";
import { isMemoryFeatureEnabled } from "./memory-feature";
import {
  findBatchControlSource,
  type BranchControlSource,
} from "./memory-branch-control";
import {
  loadChatTurnsWithMessageIds,
  rebuildLorebookFromRecords,
  listMemoryRecordsForChat,
  listDistinctClosedBranchIds,
  closeActiveBranchCanon,
  promoteRecordsToBranchCanon,
  reopenClosedBranchCanon,
  resolveSoleClosedContinueReopen,
  isExplicitClosedBranchContinueIntent,
  selectLatestContiguousNoncanonRecordIds,
  type MemoryRecordView,
} from "./memory-turn-summary";

/** Post-persist branch control ops, ordered by source turn (compose must not apply these). */
type PendingBranchControlOp =
  | {
      op: "reopen_branch";
      branchId: string;
      sourceTurn: number;
      control: BranchControlSource;
    }
  | {
      op: "close_active_branches";
      sourceTurn: number;
      control: BranchControlSource;
    };
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
  shouldPromoteBranchContinue,
  type BranchStatus,
  type MemorySummaryScope,
  type ScopePayloadV1,
} from "./memory-summary-scope";

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

/** @internal test seam — force persistValidatedSummaryBatch txn rollback after upsert */
let persistForceFailAfterUpsertForTests = false;

export function __setPersistForceFailAfterUpsertForTests(fail: boolean): void {
  persistForceFailAfterUpsertForTests = fail;
}

/** @internal exported for unit tests */
export async function summarizeTurnBatch(opts: {
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
  const callLlm: RollingSummaryLlmCaller =
    summarizeTurnBatchCallerOverride ??
    ((system, history, turnTrace, requestKind) =>
      callGeminiBackground(system, history, turnTrace, requestKind));

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { text } = await callLlm(
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

export function resolveBatchStartTurnForTurnNumber(turnNumber: number): number {
  const n = Math.max(1, Math.floor(turnNumber));
  return Math.floor((n - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL + 1;
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
       * Actual DB reopen is applied via pendingBranchControlOps after persist.
       */
      pendingSoleClosedReopenId: string | null;
      /**
       * Branch control ops in source-turn order — applied only after successful persist.
       * Typical: reopen_branch → close_active_branches (resume then close/adopt).
       */
      pendingBranchControlOps: PendingBranchControlOp[];
    }
  | { ok: false; reason: string };

/**
 * Rebuild every scope for a 6-turn batch from current surviving messages.
 * seal: first persist (may promote/close other rows from explicit user commands).
 * regen: full payload replace; preserves explicit branch/adopt provenance; no cross-row promote.
 */
async function composeBatchScopePayload(opts: {
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
  const closedBranchIds = listDistinctClosedBranchIds(opts.chatId);
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

  const mainEntries = plan.mainTurns.filter(({ turn }) =>
    isTurnEligibleForMemoryRecord(turn.user)
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
          // P1-B Path B: promote only latest contiguous noncanon group.
          const toPromote = selectLatestContiguousNoncanonRecordIds(
            opts.priorRecords
          );
          if (toPromote.length > 0) {
            promoteRecordsToBranchCanon({
              chatId: opts.chatId,
              recordIds: toPromote,
              branchId,
              promotedBy: "user_continue",
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
        userPersona: opts.userPersona,
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
      return { ok: false, reason };
    }

    if (!narrative.trim()) {
      console.error(
        `[memory] SUMMARY_EMPTY chat=${opts.chatId} turns=${opts.batchStart}-${opts.endTurn} — batch pending retry`
      );
      return { ok: false, reason: "SUMMARY_EMPTY" };
    }
    narrative = stripOocFromMemorySummary(narrative);
    if (!narrative.trim()) {
      console.error(
        `[memory] SUMMARY_EMPTY after OOC strip chat=${opts.chatId} turns=${opts.batchStart}-${opts.endTurn}`
      );
      return { ok: false, reason: "SUMMARY_EMPTY" };
    }
    scopes.main_canon = [scopes.main_canon, narrative].filter(Boolean).join("\n");
    summaryKind = "main_canon";
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
    return { ok: false, reason: validated.reason };
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
    __testThrowAfterUpsert: persistForceFailAfterUpsertForTests || undefined,
  });

  if (!persisted.ok) {
    console.error(
      `[memory] ${persisted.reason} chat=${opts.chatId} turns=${opts.batchStart}-${opts.endTurn}`,
      persisted.error
    );
    return false;
  }

  // Apply pending branch control in source-turn order after successful persist.
  const pendingOps = opts.composed.pendingBranchControlOps ?? [];
  for (const pending of pendingOps) {
    if (pending.op === "reopen_branch") {
      reopenClosedBranchCanon({
        chatId: opts.chatId,
        branchId: pending.branchId,
        source: "seal_sole_closed_continue",
        control: pending.control,
      });
    } else if (pending.op === "close_active_branches") {
      closeActiveBranchCanon(opts.chatId, pending.control);
    }
  }

  const lorebookBudget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity).lorebook;
  let currentMemory = rebuildLorebookFromRecords(opts.chatId);
  if (pendingOps.length > 0) {
    updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
      recent_summary: currentMemory,
      membership_tier: opts.tier,
    });
    syncChatLongTermMemory(opts.chatId, currentMemory);
  }
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
        `[memory] lorebook compact skipped after ${opts.logLabel} — keeping prior text:`,
        (e as Error).message
      );
    }
  }

  console.info(
    `[memory] ${opts.logLabel} chat=${opts.chatId} turns=${opts.batchStart}-${opts.endTurn} (${opts.composed.displaySummary.length}ch → lorebook ${currentMemory.length}/${lorebookBudget}ch) reason=${opts.composed.reasonTag} mainCalls=${opts.composed.mainModelCalls}`
  );
  return true;
}

/** Rebuild + replace full scopePayload for an existing 6-turn batch (regen paths). */
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
  const allTurns = loadChatTurnsWithMessageIds(opts.chatId);
  const batchMeta = allTurns.filter(
    (t) =>
      t.turnNumber >= opts.batchStart &&
      t.turnNumber < opts.batchStart + ROLLING_SUMMARY_INTERVAL
  );
  if (batchMeta.length === 0) return false;

  const endTurn = opts.batchStart + ROLLING_SUMMARY_INTERVAL - 1;
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
  });
}

/** 재생성 — 해당 턴이 속한 6턴 배치의 scopePayload 전체를 현재 DB 대화 기준으로 재구성 */
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

  running.add(opts.chatId);
  try {
    return await rebuildExistingBatchScopePayload({
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
    });
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
      turnTrace: opts.turnTrace,
      mode: "seal",
      existingRecord: null,
      previousWasNoncanonOrBranch,
      priorRecords,
    });
    if (!composed.ok) return false;

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
      logLabel: `${ROLLING_SUMMARY_INTERVAL}턴 기억 기록`,
    });
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


/** 패널·API — 특정 6턴 배치 scopePayload 전체를 현재 메시지 기준으로 재구성 (유저 수정본은 건너뜀) */
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
  if (!record) return false;

  running.add(opts.chatId);
  try {
    return await rebuildExistingBatchScopePayload({
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
    });
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
