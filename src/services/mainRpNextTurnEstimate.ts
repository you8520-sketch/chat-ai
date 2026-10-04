/**
 * Room-scoped next-turn picker estimates.
 * Reuses the existing per-model assembled snapshot owner. No provider I/O.
 */

import type { User } from "@/lib/auth";
import { visibleAssistantDisplayCharCount } from "@/lib/chatDisplayLength";
import type { SelectedAI } from "@/lib/chatModels";
import type { Usage } from "@/lib/chatUsage";
import { getDb } from "@/lib/db";
import { getEffectiveKrwPerUsd } from "@/lib/exchangeRate";
import {
  computeMainRpNextTurnEstimates,
  isUsableOutputCalibrationSource,
  nextTurnEstimateDisplayMap,
  resolveObservedCharsPerToken,
  type NextTurnEstimateMap,
} from "@/lib/mainRpNextTurnEstimate";
import { isSuccessfulDurableGenerationStatus } from "@/lib/streamingPersistenceShared";
import { resolveModelPickerAssembledInputSnapshots } from "@/services/modelPickerInputSnapshot";

type EstimateMessageRow = {
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

function usageOutputTokens(usage: Usage | null): number | null {
  if (!usage) return null;
  const total = usage.apiOutputTokens ?? usage.output ?? 0;
  if (total > 0) return total;
  const content = usage.apiContentOutputTokens ?? 0;
  const reasoning = usage.apiReasoningOutputTokens ?? 0;
  if (content + reasoning > 0) return content + reasoning;
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
    const outputTokens = usageOutputTokens(usage);
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

export type MainRpNextTurnEstimateResult = {
  chatId: number;
  estimates: NextTurnEstimateMap;
  displayPoints: Partial<Record<SelectedAI, number>>;
  lastVisibleAssistantChars: number | null;
  source: "assembled_snapshot";
};

export async function resolveMainRpNextTurnPickerEstimates(opts: {
  chatId: number;
  user: User;
  refresh?: boolean;
}): Promise<MainRpNextTurnEstimateResult | null> {
  const db = getDb();
  const owned = db
    .prepare("SELECT id FROM chats WHERE id=? AND user_id=?")
    .get(opts.chatId, opts.user.id) as { id: number } | undefined;
  if (!owned) return null;

  const promptTokensByModel = await resolveModelPickerAssembledInputSnapshots({
    chatId: opts.chatId,
    user: opts.user,
    refresh: opts.refresh,
  });
  if (!promptTokensByModel) {
    return {
      chatId: opts.chatId,
      estimates: {},
      displayPoints: {},
      lastVisibleAssistantChars: null,
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
  const estimates = computeMainRpNextTurnEstimates({
    promptTokensByModel,
    lastVisibleAssistantChars,
    observedCharsPerTokenByModel: readObservedCharsPerTokenByModel(rows),
    effectiveKrwPerUsd: getEffectiveKrwPerUsd(),
  });
  return {
    chatId: opts.chatId,
    estimates,
    displayPoints: nextTurnEstimateDisplayMap(estimates),
    lastVisibleAssistantChars,
    source: "assembled_snapshot",
  };
}
