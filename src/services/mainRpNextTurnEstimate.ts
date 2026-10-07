/**
 * Room-scoped next-turn picker estimates.
 * Reuses the existing per-model assembled snapshot owner. No provider I/O.
 * Picker snapshots use currentUserMessage="" (unsent draft omitted);
 * keyword lorebook keyed only on future user text is therefore unknown.
 * Send-time admission still receives production assembled tokens.
 * Output-history samples go through usageOutputTokens → billableOpenRouterOutputTokens.
 */

import type { User } from "@/lib/auth";
import { visibleAssistantDisplayCharCount } from "@/lib/chatDisplayLength";
import type { SelectedAI } from "@/lib/chatModels";
import type { Usage } from "@/lib/chatUsage";
import { getDb } from "@/lib/db";
import { getEffectiveKrwPerUsd } from "@/lib/exchangeRate";
import { billableOpenRouterOutputTokens } from "@/lib/points";
import {
  computeMainRpNextTurnEstimates,
  isUsableOutputCalibrationSource,
  nextTurnEstimateDisplayMap,
  pickLatestProviderInputCalibrationByModel,
  pickRecentSameModelBillableOutputTokens,
  resolveMainRpNextTurnCalibrationModelId,
  resolveObservedCharsPerToken,
  type NextTurnEstimateMap,
  type NextTurnProviderInputCalibrationSample,
} from "@/lib/mainRpNextTurnEstimate";
import { isSuccessfulDurableGenerationStatus } from "@/lib/streamingPersistenceShared";
import { resolveModelPickerAssembledInputSnapshots } from "@/services/modelPickerInputSnapshot";

export type EstimateMessageRow = {
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

function calibrationTurnFields(row: EstimateMessageRow) {
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
    apiInputTokens: usage?.apiInputTokens ?? null,
    assembledInputTokens: usage?.assembledInputTokens ?? null,
    statusWidgetExtractCallCount: usage?.statusWidgetExtract?.callCount ?? null,
    statusWidgetExtractInputTokens: usage?.statusWidgetExtract?.input ?? null,
  };
}

export function readMainRpNextTurnProviderInputCalibration(
  rows: EstimateMessageRow[]
): Partial<Record<SelectedAI, NextTurnProviderInputCalibrationSample>> {
  return pickLatestProviderInputCalibrationByModel(
    rows.filter((row) => row.role === "assistant").map((row) => calibrationTurnFields(row))
  );
}

export function readMainRpNextTurnOutputHistory(
  rows: EstimateMessageRow[]
): Partial<Record<SelectedAI, number[]>> {
  return pickRecentSameModelBillableOutputTokens(
    rows.filter((row) => row.role === "assistant").map((row) => {
      const usage = parseUsage(row.usage);
      const modelId =
        resolveMainRpNextTurnCalibrationModelId(usage?.selectedAI) ??
        resolveMainRpNextTurnCalibrationModelId(usage?.model) ??
        resolveMainRpNextTurnCalibrationModelId(row.model);
      return {
        ...calibrationTurnFields(row),
        billableOutputTokens: usageOutputTokens(usage, modelId ?? ""),
      };
    })
  );
}

function estimatesFromRoomRows(
  rows: EstimateMessageRow[],
  promptTokensByModel: Partial<Record<SelectedAI, number>>,
  providerInputCalibrationByModel: Partial<
    Record<SelectedAI, NextTurnProviderInputCalibrationSample>
  >
): NextTurnEstimateMap {
  return computeMainRpNextTurnEstimates({
    promptTokensByModel,
    lastVisibleAssistantChars: readLastVisibleAssistantChars(rows),
    observedCharsPerTokenByModel: readObservedCharsPerTokenByModel(rows),
    recentBillableOutputTokensByModel: readMainRpNextTurnOutputHistory(rows),
    providerInputCalibrationByModel,
    effectiveKrwPerUsd: getEffectiveKrwPerUsd(),
  });
}

/** One-model Published next-turn estimate. No provider I/O. Not a charge owner. */
export function resolveMainRpNextTurnPublishedEstimateForModel(opts: {
  chatId: number;
  modelId: SelectedAI;
  promptTokens: number;
}): number | null {
  if (!Number.isFinite(opts.promptTokens) || opts.promptTokens <= 0) return null;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT role, content, model, usage, generation_status
       FROM messages WHERE chat_id=? ORDER BY id ASC`
    )
    .all(opts.chatId) as EstimateMessageRow[];
  const estimates = estimatesFromRoomRows(
    rows,
    {
      [opts.modelId]: opts.promptTokens,
    },
    readMainRpNextTurnProviderInputCalibration(rows)
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

  const promptTokensByModel = await resolveModelPickerAssembledInputSnapshots({
    chatId: opts.chatId,
    user: opts.user,
  });
  if (!promptTokensByModel) {
    return {
      chatId: opts.chatId,
      estimates: {},
      displayPoints: {},
      lastVisibleAssistantChars: null,
      providerInputCalibrationByModel: {},
      source: "assembled_snapshot",
    };
  }

  const rows = db
    .prepare(
      `SELECT role, content, model, usage, generation_status
       FROM messages WHERE chat_id=? ORDER BY id ASC`
    )
    .all(opts.chatId) as EstimateMessageRow[];

  const lastVisibleAssistantChars = readLastVisibleAssistantChars(rows);
  const providerInputCalibrationByModel =
    readMainRpNextTurnProviderInputCalibration(rows);
  const estimates = estimatesFromRoomRows(
    rows,
    promptTokensByModel,
    providerInputCalibrationByModel
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
