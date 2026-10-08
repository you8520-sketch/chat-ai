/**
 * Room-scoped next-turn picker estimates.
 * Reuses the existing per-model assembled snapshot owner. No provider I/O.
 * Picker snapshots use currentUserMessage="" (unsent draft omitted);
 * keyword lorebook keyed only on future user text is therefore unknown.
 * Send-time admission still receives production assembled tokens.
 * Output-history samples go through usageOutputTokens → billableOpenRouterOutputTokens.
 * Actual-anchored history delta is attached only when the model-specific
 * candidate is the room's immediately previous successful Main RP turn.
 */

import type { User } from "@/lib/auth";
import { visibleAssistantDisplayCharCount } from "@/lib/chatDisplayLength";
import type { SelectedAI } from "@/lib/chatModels";
import type { Usage } from "@/lib/chatUsage";
import { getDb } from "@/lib/db";
import { resolveShadowBillingExchangeRateSnapshot } from "@/lib/shadowBillingExchangeRate";
import { billableOpenRouterOutputTokens } from "@/lib/points";
import {
  computeMainRpNextTurnEstimates,
  isImmediatePreviousSameModelActualAnchor,
  isUsableOutputCalibrationSource,
  nextTurnEstimateDisplayMap,
  pickLatestProviderInputCalibrationEntriesByModel,
  pickRecentSameModelBillableOutputTokens,
  resolveImmediatePreviousSuccessfulMainRpTurn,
  resolveMainRpNextTurnCalibrationModelId,
  resolveNextTurnCalibrationRowKey,
  resolveNextTurnHistoryDelta,
  resolveObservedCharsPerToken,
  type NextTurnActualAnchor,
  type NextTurnCalibrationTurnFields,
  type NextTurnEstimateMap,
  type NextTurnHistoryDelta,
  type NextTurnPromptAuditSections,
  type NextTurnProviderInputCalibrationSample,
  type NextTurnRawHistoryHealth,
} from "@/lib/mainRpNextTurnEstimate";
import { estimateTokens } from "@/lib/tokenEstimate";
import { isSuccessfulDurableGenerationStatus } from "@/lib/streamingPersistenceShared";
import {
  resolveModelPickerAssembledSnapshotEvidence,
  type ModelPickerAssemblyEvidence,
} from "@/services/modelPickerInputSnapshot";

export type EstimateMessageRow = {
  id?: number | null;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  usage: string | null;
  generation_status: string | null;
};

function parseUsage(raw: string | null): Usage | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Usage;
  } catch {
    return null;
  }
}

/** Canonical Main RP billable-output owner for next-turn output history. */
export function usageOutputTokens(usage: Usage | null, modelId: string): number | null {
  if (!usage) return null;
  if (typeof usage.output === "number" && Number.isFinite(usage.output) && usage.output > 0) {
    return usage.output;
  }
  const total = usage.apiOutputTokens ?? 0;
  const reasoning = usage.apiReasoningOutputTokens ?? 0;
  if (total > 0) {
    const billable = billableOpenRouterOutputTokens(modelId, total, reasoning);
    return billable > 0 ? billable : null;
  }
  const content = usage.apiContentOutputTokens ?? 0;
  if (content + reasoning > 0) {
    const billable = billableOpenRouterOutputTokens(modelId, content + reasoning, reasoning);
    return billable > 0 ? billable : null;
  }
  return null;
}

function readLastVisibleAssistantChars(rows: EstimateMessageRow[]): number | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row || row.role !== "assistant") continue;
    if ((row.model ?? "").trim() === "greeting") continue;
    if (!isSuccessfulDurableGenerationStatus(row.generation_status)) continue;
    const usage = parseUsage(row.usage);
    if (usage?.htmlFlashOnly) continue;
    const visible = visibleAssistantDisplayCharCount(row.content);
    if (visible <= 0) continue;
    return visible;
  }
  return null;
}

function readObservedCharsPerTokenByModel(
  rows: EstimateMessageRow[]
): Partial<Record<SelectedAI, number>> {
  const out: Partial<Record<SelectedAI, number>> = {};
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row || row.role !== "assistant") continue;
    const usage = parseUsage(row.usage);
    const modelId = (usage?.selectedAI || usage?.model || row.model || "").trim() as SelectedAI;
    if (!modelId || out[modelId] != null) continue;
    const visibleChars = visibleAssistantDisplayCharCount(row.content);
    const outputTokens = usageOutputTokens(usage, modelId);
    if (
      !isUsableOutputCalibrationSource({
        generationStatus: row.generation_status,
        model: row.model,
        visibleChars,
        outputTokens,
        htmlFlashOnly: usage?.htmlFlashOnly === true,
      })
    ) {
      continue;
    }
    const ratio = resolveObservedCharsPerToken({
      visibleChars,
      outputTokens: outputTokens!,
    });
    if (ratio != null) out[modelId] = ratio;
  }
  return out;
}

function calibrationTurnFields(
  row: EstimateMessageRow,
  rowIndex: number
): NextTurnCalibrationTurnFields {
  const usage = parseUsage(row.usage);
  return {
    generationStatus: row.generation_status,
    model: row.model,
    selectedAI: usage?.selectedAI ?? null,
    actualModel: usage?.adultRouting?.actualModel || usage?.model || null,
    htmlFlashOnly: usage?.htmlFlashOnly === true,
    estimated: usage?.estimated === true,
    fallback: usage?.fallback ?? null,
    fallbackAttempted: usage?.adultRouting?.fallbackAttempted === true,
    apiCallCount: usage?.apiCallCount ?? null,
    lengthRecoveryPasses: usage?.lengthRecoveryPasses ?? null,
    stages: usage?.stages ?? null,
    usageInputTokens: usage?.input ?? null,
    usageOutputTokens: usageOutputTokens(usage, usage?.selectedAI || usage?.model || row.model || ""),
    apiInputTokens: usage?.apiInputTokens ?? null,
    assembledInputTokens: usage?.assembledInputTokens ?? null,
    assembledPromptChars: usage?.assembledPromptChars ?? null,
    rawHistoryHealth: usage?.rawHistoryHealth ?? null,
    statusWidgetExtractCallCount: usage?.statusWidgetExtract?.callCount ?? null,
    statusWidgetExtractInputTokens: usage?.statusWidgetExtract?.input ?? null,
    rowKey: resolveNextTurnCalibrationRowKey(
      {
        rowKey:
          typeof row.id === "number" && Number.isFinite(row.id) && row.id > 0
            ? `message:${Math.trunc(row.id)}`
            : null,
      },
      rowIndex
    ),
  };
}

function assistantCalibrationTurns(
  rows: EstimateMessageRow[]
): NextTurnCalibrationTurnFields[] {
  const out: NextTurnCalibrationTurnFields[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row || row.role !== "assistant") continue;
    out.push(calibrationTurnFields(row, rowIndex));
  }
  return out;
}

function assistantContentForRowKey(
  rows: EstimateMessageRow[],
  rowKey: string
): string | null {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row || row.role !== "assistant") continue;
    const key = calibrationTurnFields(row, rowIndex).rowKey;
    if (key !== rowKey) continue;
    const content = row.content.trim();
    return content || null;
  }
  return null;
}

export function readMainRpNextTurnProviderInputCalibration(
  rows: EstimateMessageRow[]
): Partial<Record<SelectedAI, NextTurnProviderInputCalibrationSample>> {
  const entries = pickLatestProviderInputCalibrationEntriesByModel(
    assistantCalibrationTurns(rows)
  );
  const out: Partial<Record<SelectedAI, NextTurnProviderInputCalibrationSample>> = {};
  for (const [modelId, entry] of Object.entries(entries) as Array<
    [SelectedAI, (typeof entries)[SelectedAI]]
  >) {
    if (entry) out[modelId] = entry.sample;
  }
  return out;
}

export function resolveMainRpNextTurnHistoryDeltaForAnchor(
  rows: EstimateMessageRow[],
  modelId: SelectedAI,
  anchor: NextTurnActualAnchor | null | undefined,
  opts?: {
    nextPromptHistory?: Array<{ role?: string | null; content?: string | null }> | null;
    previousPromptHistory?: Array<{ role?: string | null; content?: string | null }> | null;
    currentUserEstimatedTokens?: number | null;
    currentUserMessage?: string | null;
    contextDeltaTokens?: number | null;
    removedHistoryTokens?: number | null;
    evictedMessageTexts?: string[] | null;
    nextPromptAuditSections?: NextTurnPromptAuditSections | null;
    nextRawHistoryHealth?: NextTurnRawHistoryHealth | null;
    evidence?: ModelPickerAssemblyEvidence | null;
  }
): NextTurnHistoryDelta | null {
  if (!anchor) return null;
  const nextPromptHistory = opts?.nextPromptHistory ?? opts?.evidence?.nextPromptHistory ?? null;
  if (nextPromptHistory == null) return null;
  const turns = assistantCalibrationTurns(rows);
  const immediatePrevious = resolveImmediatePreviousSuccessfulMainRpTurn(turns);
  const candidateIdentity =
    pickLatestProviderInputCalibrationEntriesByModel(turns)[modelId]?.identity ?? null;
  if (
    !isImmediatePreviousSameModelActualAnchor({
      forecastModelId: modelId,
      immediatePrevious,
      candidateIdentity,
    })
  ) {
    return null;
  }
  const previousAssistantContent = assistantContentForRowKey(
    rows,
    immediatePrevious!.identity.rowKey
  );
  const currentUserEstimatedTokens =
    opts?.currentUserEstimatedTokens ??
    opts?.evidence?.currentUserEstimatedTokens ??
    (opts?.currentUserMessage ? estimateTokens(opts.currentUserMessage) : 0);
  return resolveNextTurnHistoryDelta({
    previous: anchor,
    previousAssistantContent,
    currentUserEstimatedTokens,
    contextDeltaTokens: opts?.contextDeltaTokens,
    removedHistoryTokens: opts?.removedHistoryTokens,
    evictedMessageTexts: opts?.evictedMessageTexts,
    nextPromptHistory,
    previousPromptHistory:
      opts?.previousPromptHistory ?? opts?.evidence?.previousPromptHistory ?? null,
    nextPromptAuditSections:
      opts?.nextPromptAuditSections ?? opts?.evidence?.nextPromptAuditSections ?? null,
    nextRawHistoryHealth:
      opts?.nextRawHistoryHealth ?? opts?.evidence?.nextRawHistoryHealth ?? null,
  });
}

export function readMainRpNextTurnOutputHistory(
  rows: EstimateMessageRow[]
): Partial<Record<SelectedAI, number[]>> {
  return pickRecentSameModelBillableOutputTokens(
    rows.flatMap((row, rowIndex) => {
      if (row.role !== "assistant") return [];
      const usage = parseUsage(row.usage);
      const modelId =
        resolveMainRpNextTurnCalibrationModelId(usage?.selectedAI) ??
        resolveMainRpNextTurnCalibrationModelId(usage?.model) ??
        resolveMainRpNextTurnCalibrationModelId(row.model);
      return [
        {
          ...calibrationTurnFields(row, rowIndex),
          billableOutputTokens: usageOutputTokens(usage, modelId ?? ""),
        },
      ];
    })
  );
}

function estimatesFromRoomRows(
  rows: EstimateMessageRow[],
  promptTokensByModel: Partial<Record<SelectedAI, number>>,
  providerInputCalibrationByModel: Partial<
    Record<SelectedAI, NextTurnProviderInputCalibrationSample>
  >,
  historyDeltaByModel?: Partial<Record<SelectedAI, NextTurnHistoryDelta | null>>
): NextTurnEstimateMap {
  return computeMainRpNextTurnEstimates({
    promptTokensByModel,
    lastVisibleAssistantChars: readLastVisibleAssistantChars(rows),
    observedCharsPerTokenByModel: readObservedCharsPerTokenByModel(rows),
    recentBillableOutputTokensByModel: readMainRpNextTurnOutputHistory(rows),
    providerInputCalibrationByModel,
    historyDeltaByModel,
    effectiveKrwPerUsd: resolveShadowBillingExchangeRateSnapshot().effectiveKrwPerUsd,
  });
}

export function resolveMainRpNextTurnHistoryDeltaByModelFromRows(
  rows: EstimateMessageRow[],
  anchors: Partial<Record<SelectedAI, NextTurnActualAnchor>>,
  opts?: {
    nextPromptHistory?: Array<{ role?: string | null; content?: string | null }> | null;
    previousPromptHistory?: Array<{ role?: string | null; content?: string | null }> | null;
    currentUserEstimatedTokens?: number | null;
    currentUserMessage?: string | null;
    nextPromptAuditSections?: NextTurnPromptAuditSections | null;
    nextRawHistoryHealth?: NextTurnRawHistoryHealth | null;
    evidenceByModel?: Partial<Record<SelectedAI, ModelPickerAssemblyEvidence | null>>;
  }
): Partial<Record<SelectedAI, NextTurnHistoryDelta>> {
  const out: Partial<Record<SelectedAI, NextTurnHistoryDelta>> = {};
  for (const [modelId, anchor] of Object.entries(anchors) as Array<
    [SelectedAI, NextTurnActualAnchor | undefined]
  >) {
    if (!anchor) continue;
    const delta = resolveMainRpNextTurnHistoryDeltaForAnchor(rows, modelId, anchor, {
      ...opts,
      evidence: opts?.evidenceByModel?.[modelId] ?? null,
    });
    if (delta) out[modelId] = delta;
  }
  return out;
}

function historyDeltaByModelFromRows(
  rows: EstimateMessageRow[],
  anchors: Partial<Record<SelectedAI, NextTurnActualAnchor>>,
  opts?: Parameters<typeof resolveMainRpNextTurnHistoryDeltaByModelFromRows>[2]
): Partial<Record<SelectedAI, NextTurnHistoryDelta>> {
  return resolveMainRpNextTurnHistoryDeltaByModelFromRows(rows, anchors, opts);
}

/** One-model Published next-turn estimate. No provider I/O. Not a charge owner. */
export function resolveMainRpNextTurnPublishedEstimateForModel(opts: {
  chatId: number;
  modelId: SelectedAI;
  promptTokens: number;
  currentUserEstimatedTokens?: number | null;
  currentUserMessage?: string | null;
  nextPromptHistory?: Array<{ role?: string | null; content?: string | null }> | null;
  previousPromptHistory?: Array<{ role?: string | null; content?: string | null }> | null;
  nextPromptAuditSections?: NextTurnPromptAuditSections | null;
  nextRawHistoryHealth?: NextTurnRawHistoryHealth | null;
}): number | null {
  if (!Number.isFinite(opts.promptTokens) || opts.promptTokens <= 0) return null;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, role, content, model, usage, generation_status
       FROM messages WHERE chat_id=? ORDER BY id ASC`
    )
    .all(opts.chatId) as EstimateMessageRow[];
  const anchors = readMainRpNextTurnProviderInputCalibration(rows);
  const estimates = estimatesFromRoomRows(
    rows,
    {
      [opts.modelId]: opts.promptTokens,
    },
    anchors,
    historyDeltaByModelFromRows(rows, anchors, {
      nextPromptHistory: opts.nextPromptHistory,
      previousPromptHistory: opts.previousPromptHistory,
      currentUserEstimatedTokens: opts.currentUserEstimatedTokens,
      currentUserMessage: opts.currentUserMessage,
      nextPromptAuditSections: opts.nextPromptAuditSections,
      nextRawHistoryHealth: opts.nextRawHistoryHealth,
    })
  );
  const points = estimates[opts.modelId]?.displayPoints;
  return typeof points === "number" && Number.isSafeInteger(points) && points > 0
    ? points
    : null;
}

export type MainRpNextTurnEstimateResult = {
  chatId: number;
  estimates: NextTurnEstimateMap;
  displayPoints: Partial<Record<SelectedAI, number>>;
  lastVisibleAssistantChars: number | null;
  providerInputCalibrationByModel: Partial<
    Record<SelectedAI, NextTurnProviderInputCalibrationSample>
  >;
  source: "assembled_snapshot";
};

export async function resolveMainRpNextTurnPickerEstimates(opts: {
  chatId: number;
  user: User;
}): Promise<MainRpNextTurnEstimateResult | null> {
  const db = getDb();
  const owned = db
    .prepare("SELECT id FROM chats WHERE id=? AND user_id=?")
    .get(opts.chatId, opts.user.id) as { id: number } | undefined;
  if (!owned) return null;

  const rows = db
    .prepare(
      `SELECT id, role, content, model, usage, generation_status
       FROM messages WHERE chat_id=? ORDER BY id ASC`
    )
    .all(opts.chatId) as EstimateMessageRow[];
  const providerInputCalibrationByModel =
    readMainRpNextTurnProviderInputCalibration(rows);
  const previousSummarizedTurnCount = Object.values(providerInputCalibrationByModel)
    .map((sample) => sample?.rawHistoryHealth?.summarizedThroughTurn)
    .find((value) => typeof value === "number" && Number.isFinite(value));
  const snapshot = await resolveModelPickerAssembledSnapshotEvidence({
    chatId: opts.chatId,
    user: opts.user,
    previousSummarizedTurnCount,
  });
  if (!snapshot) {
    return {
      chatId: opts.chatId,
      estimates: {},
      displayPoints: {},
      lastVisibleAssistantChars: null,
      providerInputCalibrationByModel: {},
      source: "assembled_snapshot",
    };
  }

  const lastVisibleAssistantChars = readLastVisibleAssistantChars(rows);
  const estimates = estimatesFromRoomRows(
    rows,
    snapshot.tokensByModel,
    providerInputCalibrationByModel,
    historyDeltaByModelFromRows(rows, providerInputCalibrationByModel, {
      currentUserEstimatedTokens: 0,
      evidenceByModel: snapshot.evidenceByModel,
    })
  );
  return {
    chatId: opts.chatId,
    estimates,
    displayPoints: nextTurnEstimateDisplayMap(estimates),
    lastVisibleAssistantChars,
    providerInputCalibrationByModel,
    source: "assembled_snapshot",
  };
}
