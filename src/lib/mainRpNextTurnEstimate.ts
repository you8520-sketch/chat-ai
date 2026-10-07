/**
 * Next Main RP turn estimate owner.
 * Same-model actual-anchored input delta → optional same-model
 * billable-output-history median → Published user-charge out.
 * `predictedBillableInputTokens` is a user-charge forecast, not a physical
 * provider tokenizer count.
 * Input forecast starts from the previous successful same-model billable
 * input and adds/removes only the next-request history and context delta.
 * Actual-anchored delta is eligible only when that same-model actual is
 * the room's immediately previous successful Main RP turn. Older same-model
 * anchors fall back to `uncalibrated_assembled`. This owner does not replay
 * multi-turn history from a stale model anchor.
 * Whole-prompt assembled ratio is not a live owner.
 * Output-history samples must already be billable tokens from
 * `usageOutputTokens` → `billableOpenRouterOutputTokens`. This owner does
 * not invent a second output-normalization rule.
 * Picker display and #1400 admission both consume this owner.
 * Output numbers here are a price forecast only — not a generation max/cap.
 * Not a billing settlement or lease owner.
 *
 * Picker assembled snapshots omit the unsent draft (`currentUserMessage=""`).
 * Keyword lorebook that only triggers on future user text cannot be known
 * in advance; do not invent extra prompt to compensate. Send-time admission
 * already uses the production `buildContext` tokens that include the actual
 * current user message and triggered lorebook.
 */

import { isMainRpModel, MAIN_RP_MODEL_IDS, type SelectedAI } from "@/lib/chatModels";
import { NARRATIVE_LENGTH_CONTINUATION_STAGE } from "@/lib/narrativeLengthContinuation";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import { computePublishedStandardPreviewDisplayPoints } from "@/lib/publishedUserCharge";
import {
  CATASTROPHIC_MIN_RESPONSE_CHARS,
  KOREAN_CHARS_PER_OUTPUT_TOKEN,
  UNIFIED_TIER_AIM_CHARS,
} from "@/lib/responseLengthConstants";
import { SERVER_UNDER_LENGTH_RECOVERY_STAGE } from "@/lib/serverUnderLengthRecovery";
import { isStatusWidgetExtractStageLabel } from "@/lib/statusWidget/receiptUsage";
import { isSuccessfulDurableGenerationStatus } from "@/lib/streamingPersistenceShared";
import { estimateTokens, estimateTokensFromCharCount } from "@/lib/tokenEstimate";

export const NEXT_TURN_ESTIMATE_VERSION = "main-rp-next-turn-v1";

export const NEXT_TURN_OUTPUT_HISTORY_MIN_SAMPLES = 3;
export const NEXT_TURN_OUTPUT_HISTORY_MAX_SAMPLES = 5;

export type NextTurnOutputBasis =
  | "aim_floor"
  | "last_visible"
  | "observed_ratio"
  | "same_model_output_history";

export type NextTurnInputForecastSource =
  | "uncalibrated_assembled"
  | "same_model_actual_anchored_delta";

export type NextTurnInputCalibrationSource = NextTurnInputForecastSource;

export type NextTurnInputCalibrationConfidence = "none" | "latest_same_model";

export type NextTurnRawHistoryState =
  | "raw_retained"
  | "raw_evicted"
  | "summary_compacted"
  | "unknown";

export type NextTurnAssembledPromptChars = {
  system?: number;
  systemRules?: number;
  characterSettings?: number;
  dynamic?: number;
  history?: number;
  currentUser?: number;
  total?: number;
};

/** Content-free promptAudit breakdown. History/current-user stay out of context delta. */
export type NextTurnPromptAuditSections = {
  systemRules: number;
  characterSetting: number;
  worldLore: number;
  memory: number;
  persona: number;
  userNote: number;
  dialogueExamples: number;
};

export type NextTurnHistoryMessage = {
  role?: string | null;
  content?: string | null;
};

export type NextTurnRawHistoryHealth = {
  rawCompleteExchanges?: number;
  summarizedThroughTurn?: number;
  unsummarizedCompletedTurns?: number;
  realRawCompleteExchanges?: number;
};

export type NextTurnHistoryDelta = {
  previousAssistantRetained: boolean;
  retainedNewHistoryTokens: number;
  removedHistoryTokens: number;
  contextDeltaTokens: number;
  currentUserEstimatedTokens: number;
  previousRawHistoryState: NextTurnRawHistoryState;
  nextRawHistoryState: NextTurnRawHistoryState;
};

export type NextTurnEstimateRow = {
  promptTokens: number;
  expectedOutputTokens: number;
  outputChars: number;
  displayPoints: number;
  outputBasis: NextTurnOutputBasis;
  localAssembledInputTokens: number;
  predictedBillableInputTokens: number;
  actualBillableInputTokens: number | null;
  previousActualOutputTokens: number | null;
  priorAssembledInputTokens: number | null;
  calibrationSource: NextTurnInputForecastSource;
  calibrationConfidence: NextTurnInputCalibrationConfidence;
  forecastSource: NextTurnInputForecastSource;
  retainedNewHistoryTokens: number | null;
  removedHistoryTokens: number | null;
  contextDeltaTokens: number | null;
  currentUserEstimatedTokens: number | null;
  previousRawHistoryState: NextTurnRawHistoryState | null;
  nextRawHistoryState: NextTurnRawHistoryState | null;
  outputHistorySampleCount: number | null;
};

export type NextTurnEstimateMap = Partial<Record<SelectedAI, NextTurnEstimateRow>>;

export type NextTurnProviderInputCalibrationSample = NextTurnActualAnchor;

export type NextTurnActualAnchor = {
  actualBillableInputTokens: number;
  actualBillableOutputTokens: number;
  assembledInputTokens?: number | null;
  aggregateApiInputTokens?: number | null;
  syncAuxInputTokens?: number | null;
  assembledPromptChars?: NextTurnAssembledPromptChars | null;
  rawHistoryHealth?: NextTurnRawHistoryHealth | null;
};

/** Reader-only row identity. Never expose assistant content through this type. */
export type NextTurnAnchorRowIdentity = {
  rowKey: string;
  modelId: SelectedAI;
};

export type NextTurnImmediatePreviousSuccessfulTurn = {
  identity: NextTurnAnchorRowIdentity;
  usableSample: NextTurnActualAnchor | null;
};

export type NextTurnProviderInputCalibrationEntry = {
  identity: NextTurnAnchorRowIdentity;
  sample: NextTurnActualAnchor;
};

function isFinitePositiveToken(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export type NextTurnCalibrationStageFields = {
  stage?: string | null;
  input?: number | null;
};

export type NextTurnCalibrationTurnFields = {
  generationStatus?: string | null;
  model?: string | null;
  selectedAI?: string | null;
  actualModel?: string | null;
  htmlFlashOnly?: boolean;
  estimated?: boolean;
  fallback?: string | boolean | null;
  fallbackAttempted?: boolean;
  apiCallCount?: number | null;
  lengthRecoveryPasses?: number | null;
  stages?: NextTurnCalibrationStageFields[] | null;
  usageInputTokens?: number | null;
  usageOutputTokens?: number | null;
  apiInputTokens?: number | null;
  assembledInputTokens?: number | null;
  assembledPromptChars?: NextTurnAssembledPromptChars | null;
  rawHistoryHealth?: NextTurnRawHistoryHealth | null;
  statusWidgetExtractCallCount?: number | null;
  statusWidgetExtractInputTokens?: number | null;
  rowKey?: string | null;
};

export type NextTurnCalibrationRejection =
  | "html_flash_only"
  | "greeting"
  | "unsuccessful_generation"
  | "estimated"
  | "fallback"
  | "fallback_attempted"
  | "length_recovery_passes"
  | "narrative_length_continuation"
  | "server_under_length_recovery"
  | "unclassified_main_rp_multi_stage"
  | "unclassified_multi_call_without_stages"
  | "unusable_model"
  | "model_mismatch";

function stageLabel(stage: NextTurnCalibrationStageFields | null | undefined): string {
  return typeof stage?.stage === "string" ? stage.stage : "";
}

export function isMainRpSupplementStageLabel(stage: string | null | undefined): boolean {
  if (!stage) return false;
  return (
    stage === NARRATIVE_LENGTH_CONTINUATION_STAGE ||
    stage === SERVER_UNDER_LENGTH_RECOVERY_STAGE
  );
}

export function resolveSyncAuxInputTokens(
  input: NextTurnCalibrationTurnFields
): number | null {
  if (isFinitePositiveToken(input.statusWidgetExtractInputTokens)) {
    return input.statusWidgetExtractInputTokens;
  }
  const auxInputs = (input.stages ?? [])
    .filter((stage) => isStatusWidgetExtractStageLabel(stageLabel(stage)))
    .map((stage) => stage.input)
    .filter(isFinitePositiveToken);
  if (auxInputs.length === 0) return null;
  return auxInputs.reduce((sum, value) => sum + value, 0);
}

export function resolveAuxiliaryPlatformFundedCallCount(
  input: NextTurnCalibrationTurnFields
): number {
  if (
    typeof input.statusWidgetExtractCallCount === "number" &&
    Number.isFinite(input.statusWidgetExtractCallCount) &&
    input.statusWidgetExtractCallCount > 0
  ) {
    return Math.floor(input.statusWidgetExtractCallCount);
  }
  return (input.stages ?? []).filter((stage) =>
    isStatusWidgetExtractStageLabel(stageLabel(stage))
  ).length;
}

export function firstNextTurnCalibrationRejection(
  input: NextTurnCalibrationTurnFields
): NextTurnCalibrationRejection | null {
  if (input.htmlFlashOnly) return "html_flash_only";
  if ((input.model ?? "").trim() === "greeting") return "greeting";
  if ((input.selectedAI ?? "").trim() === "greeting") return "greeting";
  if (!isSuccessfulDurableGenerationStatus(input.generationStatus)) {
    return "unsuccessful_generation";
  }
  if (input.estimated === true) return "estimated";
  if (input.fallback) return "fallback";
  if (input.fallbackAttempted === true) return "fallback_attempted";
  if ((input.lengthRecoveryPasses ?? 0) > 0) return "length_recovery_passes";

  const labels = (input.stages ?? []).map(stageLabel);
  if (labels.includes(NARRATIVE_LENGTH_CONTINUATION_STAGE)) {
    return "narrative_length_continuation";
  }
  if (labels.includes(SERVER_UNDER_LENGTH_RECOVERY_STAGE)) {
    return "server_under_length_recovery";
  }

  const mainRpStages = labels.filter(
    (stage) => stage && !isStatusWidgetExtractStageLabel(stage)
  );
  if (mainRpStages.length > 1) return "unclassified_main_rp_multi_stage";

  const auxCalls = resolveAuxiliaryPlatformFundedCallCount(input);
  const extraCalls = (input.apiCallCount ?? 1) - 1 - auxCalls;
  if ((input.stages == null || input.stages.length === 0) && extraCalls > 0) {
    return "unclassified_multi_call_without_stages";
  }

  const selected =
    resolveMainRpNextTurnCalibrationModelId(input.selectedAI) ??
    resolveMainRpNextTurnCalibrationModelId(input.model);
  if (!selected) return "unusable_model";

  if (input.actualModel != null && String(input.actualModel).trim() !== "") {
    const actual = resolveMainRpNextTurnCalibrationModelId(input.actualModel);
    if (actual == null || actual !== selected) return "model_mismatch";
  }
  return null;
}

export function isUncontaminatedSameModelCalibrationTurn(
  input: NextTurnCalibrationTurnFields
): boolean {
  return firstNextTurnCalibrationRejection(input) == null;
}

export function meanPositiveTokens(values: number[]): number | null {
  const clean = values.filter(isFinitePositiveToken);
  if (clean.length === 0) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

export function trimmedMeanPositiveTokens(values: number[]): number | null {
  const clean = [...values].filter(isFinitePositiveToken).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  if (clean.length < 3) return meanPositiveTokens(clean);
  const inner = clean.slice(1, -1);
  return inner.reduce((sum, value) => sum + value, 0) / inner.length;
}

export function medianPositiveTokens(values: number[]): number | null {
  const clean = [...values].filter(isFinitePositiveToken).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  if (clean.length % 2 === 1) return clean[mid] ?? null;
  const left = clean[mid - 1];
  const right = clean[mid];
  if (left == null || right == null) return null;
  return (left + right) / 2;
}

export function resolveOutputHistoryForecastTokens(
  values: number[] | null | undefined
): number | null {
  if (!values) return null;
  const clean = values.filter(isFinitePositiveToken);
  if (clean.length < NEXT_TURN_OUTPUT_HISTORY_MIN_SAMPLES) return null;
  const window = clean.slice(-NEXT_TURN_OUTPUT_HISTORY_MAX_SAMPLES);
  const median = medianPositiveTokens(window);
  if (median == null) return null;
  return Math.max(1, Math.round(median));
}

export function describeNextTurnOutputBasis(basis: NextTurnOutputBasis): string {
  switch (basis) {
    case "aim_floor":
      return "target_3200_chars";
    case "last_visible":
      return "last_visible_chars";
    case "observed_ratio":
      return "last_visible_over_observed_chars_per_token";
    case "same_model_output_history":
      return "median_recent_billable_output_tokens";
    default: {
      const _never: never = basis;
      return _never;
    }
  }
}

export function resolveMainRpNextTurnCalibrationModelId(
  raw: string | null | undefined
): SelectedAI | null {
  if (typeof raw !== "string") return null;
  const canonical = canonicalizePublishedModelId(raw);
  if (!canonical || canonical === "greeting") return null;
  return isMainRpModel(canonical) ? (canonical as SelectedAI) : null;
}

export function resolveNextTurnInputCalibrationConfidence(
  source: NextTurnInputForecastSource
): NextTurnInputCalibrationConfidence {
  switch (source) {
    case "uncalibrated_assembled":
      return "none";
    case "same_model_actual_anchored_delta":
      return "latest_same_model";
    default: {
      const _never: never = source;
      return _never;
    }
  }
}

export function isPreviousAssistantRetainedInHistory(input: {
  nextPromptHistory?: NextTurnHistoryMessage[] | null;
  previousAssistantContent?: string | null;
}): boolean {
  const previous = (input.previousAssistantContent ?? "").trim();
  if (!previous || !input.nextPromptHistory?.length) return false;
  return input.nextPromptHistory.some(
    (message) =>
      message.role === "assistant" && (message.content ?? "").trim() === previous
  );
}

export function nextTurnHistoryMessageIdentity(message: NextTurnHistoryMessage): string {
  return `${message.role ?? ""}\n${(message.content ?? "").trim()}`;
}

export function resolveRemovedHistoryTexts(input: {
  previousPromptHistory?: NextTurnHistoryMessage[] | null;
  nextPromptHistory?: NextTurnHistoryMessage[] | null;
}): string[] {
  const nextKeys = new Set(
    (input.nextPromptHistory ?? []).map(nextTurnHistoryMessageIdentity)
  );
  const removed: string[] = [];
  for (const message of input.previousPromptHistory ?? []) {
    const content = (message.content ?? "").trim();
    if (!content) continue;
    if (!nextKeys.has(nextTurnHistoryMessageIdentity(message))) {
      removed.push(content);
    }
  }
  return removed;
}

export function nonHistoryTokensFromPromptAuditSections(
  sections: NextTurnPromptAuditSections | null | undefined
): number {
  if (!sections) return 0;
  return (
    Math.max(0, sections.systemRules) +
    Math.max(0, sections.characterSetting) +
    Math.max(0, sections.worldLore) +
    Math.max(0, sections.memory) +
    Math.max(0, sections.persona) +
    Math.max(0, sections.userNote) +
    Math.max(0, sections.dialogueExamples)
  );
}

export function promptAuditSectionsFromAssembledPromptChars(
  chars: NextTurnAssembledPromptChars | null | undefined
): NextTurnPromptAuditSections | null {
  if (!chars) return null;
  const systemRules = estimateTokensFromCharCount(chars.systemRules ?? 0);
  const characterSetting = estimateTokensFromCharCount(chars.characterSettings ?? 0);
  const dynamic = estimateTokensFromCharCount(chars.dynamic ?? 0);
  if (systemRules + characterSetting + dynamic > 0) {
    return {
      systemRules,
      characterSetting,
      worldLore: dynamic,
      memory: 0,
      persona: 0,
      userNote: 0,
      dialogueExamples: 0,
    };
  }
  const system = estimateTokensFromCharCount(chars.system ?? 0);
  if (system <= 0) return null;
  return {
    systemRules: system,
    characterSetting: 0,
    worldLore: 0,
    memory: 0,
    persona: 0,
    userNote: 0,
    dialogueExamples: 0,
  };
}

export function promptAuditSectionsFromPromptAudit(input: {
  breakdown?: NextTurnPromptAuditSections | null;
}): NextTurnPromptAuditSections | null {
  if (!input.breakdown) return null;
  return {
    systemRules: Math.max(0, input.breakdown.systemRules),
    characterSetting: Math.max(0, input.breakdown.characterSetting),
    worldLore: Math.max(0, input.breakdown.worldLore),
    memory: Math.max(0, input.breakdown.memory),
    persona: Math.max(0, input.breakdown.persona),
    userNote: Math.max(0, input.breakdown.userNote),
    dialogueExamples: Math.max(0, input.breakdown.dialogueExamples),
  };
}

export function resolveNextTurnRawHistoryState(input: {
  previous?: NextTurnRawHistoryHealth | null;
  next?: NextTurnRawHistoryHealth | null;
  previousAssistantRetained: boolean;
  removedHistoryTokens: number;
}): { previous: NextTurnRawHistoryState; next: NextTurnRawHistoryState } {
  const prevSummarized = input.previous?.summarizedThroughTurn ?? 0;
  const nextSummarized = input.next?.summarizedThroughTurn ?? prevSummarized;
  if (nextSummarized > prevSummarized) {
    return { previous: "raw_retained", next: "summary_compacted" };
  }
  if (input.removedHistoryTokens > 0) {
    return {
      previous: input.previousAssistantRetained ? "raw_retained" : "unknown",
      next: "raw_evicted",
    };
  }
  if (input.previousAssistantRetained) {
    return { previous: "raw_retained", next: "raw_retained" };
  }
  return { previous: "unknown", next: "unknown" };
}

export function resolveNextTurnHistoryDelta(input: {
  previous: NextTurnActualAnchor;
  previousAssistantRetained?: boolean;
  previousAssistantContent?: string | null;
  currentUserEstimatedTokens?: number | null;
  contextDeltaTokens?: number | null;
  removedHistoryTokens?: number | null;
  nextAssembledPromptChars?: NextTurnAssembledPromptChars | null;
  nextPromptAuditSections?: NextTurnPromptAuditSections | null;
  nextRawHistoryHealth?: NextTurnRawHistoryHealth | null;
  evictedMessageTexts?: string[] | null;
  nextPromptHistory?: NextTurnHistoryMessage[] | null;
  previousPromptHistory?: NextTurnHistoryMessage[] | null;
}): NextTurnHistoryDelta {
  const previousAssistantRetained =
    input.nextPromptHistory != null
      ? isPreviousAssistantRetainedInHistory({
          nextPromptHistory: input.nextPromptHistory,
          previousAssistantContent: input.previousAssistantContent,
        })
      : input.previousAssistantRetained === true;
  const retainedNewHistoryTokens = previousAssistantRetained
    ? Math.max(0, Math.round(input.previous.actualBillableOutputTokens))
    : 0;
  const evictedFromHistories =
    input.previousPromptHistory != null && input.nextPromptHistory != null
      ? resolveRemovedHistoryTexts({
          previousPromptHistory: input.previousPromptHistory,
          nextPromptHistory: input.nextPromptHistory,
        })
      : [];
  const evictedFromTexts = (input.evictedMessageTexts ?? evictedFromHistories).reduce(
    (sum, text) => sum + estimateTokens(text),
    0
  );
  const removedHistoryTokens = Math.max(
    0,
    Math.round(input.removedHistoryTokens ?? evictedFromTexts)
  );
  let contextDeltaTokens = Math.round(input.contextDeltaTokens ?? 0);
  if (input.contextDeltaTokens == null) {
    const previousSections = promptAuditSectionsFromAssembledPromptChars(
      input.previous.assembledPromptChars
    );
    const nextSections =
      input.nextPromptAuditSections ??
      promptAuditSectionsFromAssembledPromptChars(input.nextAssembledPromptChars);
    const previousNonHistory = nonHistoryTokensFromPromptAuditSections(previousSections);
    const nextNonHistory = nonHistoryTokensFromPromptAuditSections(nextSections);
    if (previousNonHistory > 0 || nextNonHistory > 0) {
      contextDeltaTokens = nextNonHistory - previousNonHistory;
    }
  }
  const currentUserEstimatedTokens = Math.max(
    0,
    Math.round(input.currentUserEstimatedTokens ?? 0)
  );
  const rawState = resolveNextTurnRawHistoryState({
    previous: input.previous.rawHistoryHealth,
    next: input.nextRawHistoryHealth,
    previousAssistantRetained,
    removedHistoryTokens,
  });
  return {
    previousAssistantRetained,
    retainedNewHistoryTokens,
    removedHistoryTokens,
    contextDeltaTokens,
    currentUserEstimatedTokens,
    previousRawHistoryState: rawState.previous,
    nextRawHistoryState: rawState.next,
  };
}

export function applyActualAnchoredInputDelta(input: {
  previous: NextTurnActualAnchor;
  historyDelta: NextTurnHistoryDelta;
  localAssembledInputTokens?: number;
}): {
  predictedBillableInputTokens: number;
  actualBillableInputTokens: number;
  previousActualOutputTokens: number;
  forecastSource: NextTurnInputForecastSource;
  calibrationSource: NextTurnInputForecastSource;
  calibrationConfidence: NextTurnInputCalibrationConfidence;
} {
  const predicted = Math.max(
    1,
    Math.round(
      input.previous.actualBillableInputTokens +
        input.historyDelta.retainedNewHistoryTokens +
        input.historyDelta.currentUserEstimatedTokens +
        input.historyDelta.contextDeltaTokens -
        input.historyDelta.removedHistoryTokens
    )
  );
  const source = "same_model_actual_anchored_delta" as const;
  return {
    predictedBillableInputTokens: predicted,
    actualBillableInputTokens: Math.round(input.previous.actualBillableInputTokens),
    previousActualOutputTokens: Math.round(input.previous.actualBillableOutputTokens),
    forecastSource: source,
    calibrationSource: source,
    calibrationConfidence: resolveNextTurnInputCalibrationConfidence(source),
  };
}

export function applyNextTurnInputForecast(input: {
  localAssembledInputTokens: number;
  previous?: NextTurnActualAnchor | null;
  historyDelta?: NextTurnHistoryDelta | null;
}): {
  predictedBillableInputTokens: number;
  actualBillableInputTokens: number | null;
  previousActualOutputTokens: number | null;
  forecastSource: NextTurnInputForecastSource;
  calibrationSource: NextTurnInputForecastSource;
  calibrationConfidence: NextTurnInputCalibrationConfidence;
} {
  const localAssembled = Math.round(input.localAssembledInputTokens);
  if (
    input.previous &&
    isFinitePositiveToken(input.previous.actualBillableInputTokens) &&
    isFinitePositiveToken(input.previous.actualBillableOutputTokens) &&
    input.historyDelta
  ) {
    return applyActualAnchoredInputDelta({
      previous: input.previous,
      historyDelta: input.historyDelta,
      localAssembledInputTokens: localAssembled,
    });
  }
  const source = "uncalibrated_assembled" as const;
  return {
    predictedBillableInputTokens: localAssembled,
    actualBillableInputTokens: null,
    previousActualOutputTokens: null,
    forecastSource: source,
    calibrationSource: source,
    calibrationConfidence: resolveNextTurnInputCalibrationConfidence(source),
  };
}

export function resolveNextTurnOutputChars(
  lastVisibleAssistantChars: number | null | undefined
): number {
  if (
    typeof lastVisibleAssistantChars === "number" &&
    Number.isFinite(lastVisibleAssistantChars) &&
    lastVisibleAssistantChars > UNIFIED_TIER_AIM_CHARS
  ) {
    return Math.round(lastVisibleAssistantChars);
  }
  return UNIFIED_TIER_AIM_CHARS;
}

export function resolveObservedCharsPerToken(input: {
  visibleChars: number;
  outputTokens: number;
}): number | null {
  if (
    !Number.isFinite(input.visibleChars) ||
    !Number.isFinite(input.outputTokens) ||
    input.visibleChars < CATASTROPHIC_MIN_RESPONSE_CHARS ||
    input.outputTokens <= 0
  ) {
    return null;
  }
  const ratio = input.visibleChars / input.outputTokens;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return ratio;
}

export function estimateNextTurnOutputTokens(input: {
  outputChars: number;
  observedCharsPerToken?: number | null;
}): number {
  const ratio =
    typeof input.observedCharsPerToken === "number" &&
    Number.isFinite(input.observedCharsPerToken) &&
    input.observedCharsPerToken > 0
      ? input.observedCharsPerToken
      : KOREAN_CHARS_PER_OUTPUT_TOKEN;
  return Math.max(1, Math.ceil(input.outputChars / ratio));
}

export function isUsableOutputCalibrationSource(input: {
  generationStatus?: string | null;
  model?: string | null;
  visibleChars: number;
  outputTokens: number | null;
  htmlFlashOnly?: boolean;
}): boolean {
  if (input.htmlFlashOnly) return false;
  if ((input.model ?? "").trim() === "greeting") return false;
  if (!isSuccessfulDurableGenerationStatus(input.generationStatus)) return false;
  if (input.visibleChars < CATASTROPHIC_MIN_RESPONSE_CHARS) return false;
  if (input.outputTokens == null || input.outputTokens <= 0) return false;
  return resolveObservedCharsPerToken({
    visibleChars: input.visibleChars,
    outputTokens: input.outputTokens,
  }) != null;
}

export function isUsableProviderInputCalibrationSource(
  input: NextTurnCalibrationTurnFields
): boolean {
  if (!isUncontaminatedSameModelCalibrationTurn(input)) return false;
  if (!isFinitePositiveToken(input.usageInputTokens)) return false;
  return isFinitePositiveToken(input.usageOutputTokens);
}

export function resolveNextTurnCalibrationRowKey(
  input: { rowKey?: string | null },
  fallbackIndex: number
): string {
  const explicit = (input.rowKey ?? "").trim();
  if (explicit) return explicit;
  return `index:${Math.trunc(fallbackIndex)}`;
}

export function isImmediatePreviousSuccessfulMainRpAssistantTurn(
  input: NextTurnCalibrationTurnFields
): boolean {
  if (input.htmlFlashOnly) return false;
  if ((input.model ?? "").trim() === "greeting") return false;
  if ((input.selectedAI ?? "").trim() === "greeting") return false;
  if (!isSuccessfulDurableGenerationStatus(input.generationStatus)) return false;
  const selected =
    resolveMainRpNextTurnCalibrationModelId(input.selectedAI) ??
    resolveMainRpNextTurnCalibrationModelId(input.model);
  return selected != null;
}

export function providerInputCalibrationSampleFromTurn(
  candidate: NextTurnCalibrationTurnFields
): NextTurnActualAnchor | null {
  if (!isUsableProviderInputCalibrationSource(candidate)) return null;
  const reportedInputTokens = candidate.usageInputTokens as number;
  const reportedOutputTokens = candidate.usageOutputTokens as number;
  const assembledInputTokens = isFinitePositiveToken(candidate.assembledInputTokens)
    ? candidate.assembledInputTokens
    : null;
  const aggregateApiInputTokens = isFinitePositiveToken(candidate.apiInputTokens)
    ? candidate.apiInputTokens
    : null;
  const syncAuxInputTokens = resolveSyncAuxInputTokens(candidate);
  return {
    actualBillableInputTokens: assembledInputTokens
      ? Math.min(reportedInputTokens, assembledInputTokens)
      : reportedInputTokens,
    actualBillableOutputTokens: reportedOutputTokens,
    ...(assembledInputTokens != null ? { assembledInputTokens } : {}),
    ...(aggregateApiInputTokens != null ? { aggregateApiInputTokens } : {}),
    ...(syncAuxInputTokens != null ? { syncAuxInputTokens } : {}),
    ...(candidate.assembledPromptChars
      ? { assembledPromptChars: candidate.assembledPromptChars }
      : {}),
    ...(candidate.rawHistoryHealth ? { rawHistoryHealth: candidate.rawHistoryHealth } : {}),
  };
}

export function resolveImmediatePreviousSuccessfulMainRpTurn(
  candidatesNewestLast: NextTurnCalibrationTurnFields[]
): NextTurnImmediatePreviousSuccessfulTurn | null {
  for (let i = candidatesNewestLast.length - 1; i >= 0; i -= 1) {
    const candidate = candidatesNewestLast[i];
    if (!candidate) continue;
    if (!isImmediatePreviousSuccessfulMainRpAssistantTurn(candidate)) continue;
    const modelId =
      resolveMainRpNextTurnCalibrationModelId(candidate.selectedAI) ??
      resolveMainRpNextTurnCalibrationModelId(candidate.model);
    if (!modelId) continue;
    return {
      identity: {
        rowKey: resolveNextTurnCalibrationRowKey(candidate, i),
        modelId,
      },
      usableSample: providerInputCalibrationSampleFromTurn(candidate),
    };
  }
  return null;
}

export function pickLatestProviderInputCalibrationEntriesByModel(
  candidatesNewestLast: NextTurnCalibrationTurnFields[]
): Partial<Record<SelectedAI, NextTurnProviderInputCalibrationEntry>> {
  const out: Partial<Record<SelectedAI, NextTurnProviderInputCalibrationEntry>> = {};
  for (let i = candidatesNewestLast.length - 1; i >= 0; i -= 1) {
    const candidate = candidatesNewestLast[i];
    if (!candidate) continue;
    const sample = providerInputCalibrationSampleFromTurn(candidate);
    if (!sample) continue;
    const modelId =
      resolveMainRpNextTurnCalibrationModelId(candidate.selectedAI) ??
      resolveMainRpNextTurnCalibrationModelId(candidate.model);
    if (!modelId || out[modelId] != null) continue;
    out[modelId] = {
      identity: {
        rowKey: resolveNextTurnCalibrationRowKey(candidate, i),
        modelId,
      },
      sample,
    };
  }
  return out;
}

export function isImmediatePreviousSameModelActualAnchor(input: {
  forecastModelId: SelectedAI;
  immediatePrevious: NextTurnImmediatePreviousSuccessfulTurn | null | undefined;
  candidateIdentity: NextTurnAnchorRowIdentity | null | undefined;
}): boolean {
  const previous = input.immediatePrevious;
  const candidate = input.candidateIdentity;
  if (!previous || !previous.usableSample || !candidate) return false;
  if (!previous.identity.rowKey || !candidate.rowKey) return false;
  return (
    input.forecastModelId === previous.identity.modelId &&
    candidate.modelId === previous.identity.modelId &&
    candidate.rowKey === previous.identity.rowKey
  );
}

export function isUsableOutputHistorySource(input: NextTurnCalibrationTurnFields & {
  billableOutputTokens?: number | null;
}): boolean {
  if (!isUncontaminatedSameModelCalibrationTurn(input)) return false;
  return isFinitePositiveToken(input.billableOutputTokens);
}

export function pickLatestProviderInputCalibrationByModel(
  candidatesNewestLast: NextTurnCalibrationTurnFields[]
): Partial<Record<SelectedAI, NextTurnProviderInputCalibrationSample>> {
  const entries = pickLatestProviderInputCalibrationEntriesByModel(candidatesNewestLast);
  const out: Partial<Record<SelectedAI, NextTurnProviderInputCalibrationSample>> = {};
  for (const modelId of MAIN_RP_MODEL_IDS) {
    const entry = entries[modelId];
    if (entry) out[modelId] = entry.sample;
  }
  return out;
}

export function pickRecentSameModelBillableOutputTokens(
  candidatesOldestFirst: Array<
    NextTurnCalibrationTurnFields & { billableOutputTokens?: number | null }
  >
): Partial<Record<SelectedAI, number[]>> {
  const out: Partial<Record<SelectedAI, number[]>> = {};
  for (const candidate of candidatesOldestFirst) {
    if (!isUsableOutputHistorySource(candidate)) continue;
    const modelId =
      resolveMainRpNextTurnCalibrationModelId(candidate.selectedAI) ??
      resolveMainRpNextTurnCalibrationModelId(candidate.model);
    if (!modelId || !isFinitePositiveToken(candidate.billableOutputTokens)) continue;
    const list = out[modelId] ?? [];
    list.push(candidate.billableOutputTokens);
    if (list.length > NEXT_TURN_OUTPUT_HISTORY_MAX_SAMPLES) list.shift();
    out[modelId] = list;
  }
  return out;
}

export function resolveNextTurnOutputForecast(input: {
  lastVisibleAssistantChars?: number | null;
  observedCharsPerToken?: number | null;
  recentBillableOutputTokens?: number[] | null;
}): {
  expectedOutputTokens: number;
  outputChars: number;
  outputBasis: NextTurnOutputBasis;
  outputHistorySampleCount: number | null;
} {
  const outputChars = resolveNextTurnOutputChars(input.lastVisibleAssistantChars);
  const historyTokens = resolveOutputHistoryForecastTokens(input.recentBillableOutputTokens);
  if (historyTokens != null && input.recentBillableOutputTokens) {
    const count = input.recentBillableOutputTokens.filter(isFinitePositiveToken).length;
    return {
      expectedOutputTokens: historyTokens,
      outputChars,
      outputBasis: "same_model_output_history",
      outputHistorySampleCount: Math.min(count, NEXT_TURN_OUTPUT_HISTORY_MAX_SAMPLES),
    };
  }
  const expectedOutputTokens = estimateNextTurnOutputTokens({
    outputChars,
    observedCharsPerToken: input.observedCharsPerToken,
  });
  const outputBasis: NextTurnOutputBasis =
    typeof input.observedCharsPerToken === "number" && input.observedCharsPerToken > 0
      ? "observed_ratio"
      : outputChars > UNIFIED_TIER_AIM_CHARS
        ? "last_visible"
        : "aim_floor";
  return {
    expectedOutputTokens,
    outputChars,
    outputBasis,
    outputHistorySampleCount: null,
  };
}

export function computeMainRpNextTurnEstimates(input: {
  promptTokensByModel: Partial<Record<SelectedAI, number>>;
  lastVisibleAssistantChars?: number | null;
  observedCharsPerTokenByModel?: Partial<Record<SelectedAI, number | null>>;
  recentBillableOutputTokensByModel?: Partial<Record<SelectedAI, number[] | null>>;
  providerInputCalibrationByModel?: Partial<
    Record<SelectedAI, NextTurnActualAnchor | null>
  >;
  historyDeltaByModel?: Partial<Record<SelectedAI, NextTurnHistoryDelta | null>>;
  effectiveKrwPerUsd: number;
}): NextTurnEstimateMap {
  const out: NextTurnEstimateMap = {};
  for (const modelId of MAIN_RP_MODEL_IDS) {
    const assembled = input.promptTokensByModel[modelId];
    if (typeof assembled !== "number" || !Number.isFinite(assembled) || assembled <= 0) {
      continue;
    }
    const localAssembledInputTokens = Math.round(assembled);
    const previous = input.providerInputCalibrationByModel?.[modelId] ?? null;
    const historyDelta = input.historyDeltaByModel?.[modelId] ?? null;
    const forecast = applyNextTurnInputForecast({
      localAssembledInputTokens,
      previous,
      historyDelta,
    });
    const predictedBillableInputTokens = forecast.predictedBillableInputTokens;
    const observed = input.observedCharsPerTokenByModel?.[modelId];
    const outputForecast = resolveNextTurnOutputForecast({
      lastVisibleAssistantChars: input.lastVisibleAssistantChars,
      observedCharsPerToken: observed,
      recentBillableOutputTokens: input.recentBillableOutputTokensByModel?.[modelId],
    });
    const displayPoints = computePublishedStandardPreviewDisplayPoints({
      modelId,
      promptTokens: predictedBillableInputTokens,
      outputTokens: outputForecast.expectedOutputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      effectiveKrwPerUsd: input.effectiveKrwPerUsd,
    });
    if (displayPoints == null) continue;
    out[modelId] = {
      promptTokens: predictedBillableInputTokens,
      expectedOutputTokens: outputForecast.expectedOutputTokens,
      outputChars: outputForecast.outputChars,
      displayPoints,
      outputBasis: outputForecast.outputBasis,
      localAssembledInputTokens,
      predictedBillableInputTokens,
      actualBillableInputTokens: forecast.actualBillableInputTokens,
      previousActualOutputTokens: forecast.previousActualOutputTokens,
      priorAssembledInputTokens:
        previous?.assembledInputTokens != null
          ? Math.round(previous.assembledInputTokens)
          : null,
      calibrationSource: forecast.calibrationSource,
      calibrationConfidence: forecast.calibrationConfidence,
      forecastSource: forecast.forecastSource,
      retainedNewHistoryTokens: historyDelta?.retainedNewHistoryTokens ?? null,
      removedHistoryTokens: historyDelta?.removedHistoryTokens ?? null,
      contextDeltaTokens: historyDelta?.contextDeltaTokens ?? null,
      currentUserEstimatedTokens: historyDelta?.currentUserEstimatedTokens ?? null,
      previousRawHistoryState: historyDelta?.previousRawHistoryState ?? null,
      nextRawHistoryState: historyDelta?.nextRawHistoryState ?? null,
      outputHistorySampleCount: outputForecast.outputHistorySampleCount,
    };
  }
  return out;
}

export function nextTurnEstimateDisplayMap(
  estimates: NextTurnEstimateMap
): Partial<Record<SelectedAI, number>> {
  const out: Partial<Record<SelectedAI, number>> = {};
  for (const modelId of MAIN_RP_MODEL_IDS) {
    const points = estimates[modelId]?.displayPoints;
    if (typeof points === "number" && Number.isSafeInteger(points) && points > 0) {
      out[modelId] = points;
    }
  }
  return out;
}
