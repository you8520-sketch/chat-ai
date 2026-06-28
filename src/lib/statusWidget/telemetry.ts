import fs from "node:fs";
import path from "node:path";
import {
  isGeminiProOpenRouterModel,
  isAnthropicModel,
  isQwenModel,
  isDeepSeekV4ProModel,
} from "@/lib/chatModels";
import type { ParsedStatusWidgetTurnValues, ResolvedStatusWidgetTurn } from "./types";
import { statusWidgetValuesAreCorrupt } from "./parseValues";
import { statusWidgetValuesHasContent } from "./displayPolicy";
import type { TokenUsage } from "@/lib/ai";
import {
  stripStatusWidgetFromAssistantProse,
  WIDGET_EXTRACT_NARRATIVE_CHAR_BUDGET,
} from "./proseStrip";

export type StatusWidgetModelFamily =
  | "deepseek"
  | "gemini"
  | "openai"
  | "anthropic"
  | "qwen"
  | "other";

export type StatusWidgetParserMode = "standard" | "deepseek";

export type StatusWidgetResolutionSource =
  | "v3_extract"
  | "stream_capture"
  | "split_saved"
  | "split_raw"
  | "infer"
  | "backfill"
  | "none";

/** Per-turn resolution metrics — one row per widget-active chat turn */
export type StatusWidgetTurnTelemetry = {
  event: "status_widget_turn";
  chatId: number;
  modelId: string;
  modelFamily: StatusWidgetModelFamily;
  parserMode: StatusWidgetParserMode;
  streamCaptureHit: boolean;
  splitSavedHit: boolean;
  splitRawHit: boolean;
  inferHit: boolean;
  backfillAttempted: boolean;
  backfillSuccess: boolean;
  backfillSkippedReason: string | null;
  /** Main model leaked STATUS_VALUES / widget JSON — stripped before save */
  jsonParseSuccess: boolean;
  resolutionSource: StatusWidgetResolutionSource;
  finalHasContent: boolean;
  finalCorruptBeforeBackfill: boolean;
  regenerate: boolean;
};

export const STATUS_WIDGET_TELEMETRY_LOG_PREFIX = "[status-widget-telemetry]";

export { WIDGET_EXTRACT_NARRATIVE_CHAR_BUDGET } from "./proseStrip";

export function resolveStatusWidgetModelFamily(modelId: string): StatusWidgetModelFamily {
  const id = modelId.toLowerCase();
  if (isDeepSeekV4ProModel(modelId) || id.includes("deepseek")) return "deepseek";
  if (isGeminiProOpenRouterModel(modelId) || id.includes("gemini") || id.startsWith("google/")) {
    return "gemini";
  }
  if (isAnthropicModel(modelId) || id.includes("claude")) return "anthropic";
  if (isQwenModel(modelId) || id.includes("qwen")) return "qwen";
  if (id.includes("openai/") || id.includes("gpt-")) return "openai";
  return "other";
}

export function resolveStatusWidgetParserMode(modelId: string): StatusWidgetParserMode {
  return isDeepSeekV4ProModel(modelId) || isGeminiProOpenRouterModel(modelId)
    ? "deepseek"
    : "standard";
}

/** Strip widget tails the main RP model may have leaked — prose only for save & V3 extract */
export { stripStatusWidgetFromAssistantProse } from "./proseStrip";

export type ResolveStatusWidgetTurnValuesInput = {
  chatId: number;
  modelId: string;
  regenerate?: boolean;
  savedText: string;
  rawWidgetSourceText: string;
  statusWidgetTurn: ResolvedStatusWidgetTurn;
  charName: string;
  personaName: string;
  userMessage: string;
  userNote?: string;
  regenerateMessageId?: number;
};

export type ResolveStatusWidgetTurnValuesResult = {
  prose: string;
  values: ParsedStatusWidgetTurnValues | null;
  widgetExtractUsage: TokenUsage | null;
  telemetry: StatusWidgetTurnTelemetry;
};

export async function resolveStatusWidgetTurnValues(
  input: ResolveStatusWidgetTurnValuesInput
): Promise<ResolveStatusWidgetTurnValuesResult> {
  const parserMode = resolveStatusWidgetParserMode(input.modelId);

  const proseFromSaved = stripStatusWidgetFromAssistantProse(input.savedText);
  const proseFromRaw = stripStatusWidgetFromAssistantProse(input.rawWidgetSourceText);
  const prose = proseFromSaved || proseFromRaw;

  const strippedLeak =
    proseFromSaved !== input.savedText.trimEnd() ||
    proseFromRaw !== input.rawWidgetSourceText.trimEnd();

  let v3ExtractAttempted = true;
  let v3ExtractSuccess = false;
  let valuesPayload: ParsedStatusWidgetTurnValues | null = null;
  let widgetExtractUsage: TokenUsage | null = null;
  let resolutionSource: StatusWidgetResolutionSource = "none";

  try {
    const { extractStatusWidgetValuesForTurn } = await import("./extract");
    const { loadPreviousStatusWidgetValues, loadPreviousAssistantProse } = await import(
      "./loadPrevious"
    );
    const v3Result = await extractStatusWidgetValuesForTurn({
      charName: input.charName,
      personaName: input.personaName,
      userMessage: input.userMessage,
      assistantProse: prose,
      resolved: input.statusWidgetTurn,
      previousValues: loadPreviousStatusWidgetValues(
        input.chatId,
        input.regenerateMessageId
      ),
      previousAssistantProse: loadPreviousAssistantProse(
        input.chatId,
        input.regenerateMessageId
      ),
      userNote: input.userNote,
    });
    widgetExtractUsage = v3Result.usage;
    if (statusWidgetValuesHasContent(v3Result.values)) {
      v3ExtractSuccess = true;
      valuesPayload = v3Result.values;
      resolutionSource = "v3_extract";
    }
  } catch (e) {
    console.warn("[status-widget] V3 extract failed", (e as Error).message);
  }

  const finalHasContent = statusWidgetValuesHasContent(valuesPayload);
  const corruptBeforeExtract = statusWidgetValuesAreCorrupt(valuesPayload);

  const telemetry: StatusWidgetTurnTelemetry = {
    event: "status_widget_turn",
    chatId: input.chatId,
    modelId: input.modelId,
    modelFamily: resolveStatusWidgetModelFamily(input.modelId),
    parserMode,
    streamCaptureHit: false,
    splitSavedHit: strippedLeak,
    splitRawHit: false,
    inferHit: false,
    backfillAttempted: v3ExtractAttempted,
    backfillSuccess: v3ExtractSuccess,
    backfillSkippedReason: v3ExtractSuccess ? null : "v3_extract_empty",
    jsonParseSuccess: strippedLeak,
    resolutionSource: finalHasContent ? resolutionSource : "none",
    finalHasContent,
    finalCorruptBeforeBackfill: corruptBeforeExtract,
    regenerate: input.regenerate === true,
  };

  return {
    prose,
    values: finalHasContent ? valuesPayload : null,
    widgetExtractUsage,
    telemetry,
  };
}

export function logStatusWidgetTurnTelemetry(telemetry: StatusWidgetTurnTelemetry): void {
  const line = JSON.stringify(telemetry);
  console.info(`${STATUS_WIDGET_TELEMETRY_LOG_PREFIX} ${line}`);
  if (process.env.STATUS_WIDGET_TELEMETRY_LOG === "1") {
    try {
      const dir = path.join(process.cwd(), "tmp");
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, "status-widget-telemetry.jsonl"), `${line}\n`, "utf8");
    } catch {
      // optional file log — ignore
    }
  }
}

export type StatusWidgetTelemetryAggregate = {
  totalTurns: number;
  finalHasContentRate: number;
  jsonParseSuccessRate: number;
  inferRate: number;
  backfillAttemptRate: number;
  backfillSuccessRate: number;
  byModelFamily: Record<
    string,
    {
      turns: number;
      jsonParseSuccessRate: number;
      inferRate: number;
      backfillAttemptRate: number;
      backfillSuccessRate: number;
      finalHasContentRate: number;
    }
  >;
  byResolutionSource: Record<string, number>;
};

export function aggregateStatusWidgetTelemetry(
  rows: StatusWidgetTurnTelemetry[]
): StatusWidgetTelemetryAggregate {
  const totalTurns = rows.length;
  const byModelFamily: StatusWidgetTelemetryAggregate["byModelFamily"] = {};
  const byResolutionSource: Record<string, number> = {};

  let jsonParseSuccess = 0;
  let infer = 0;
  let backfillAttempt = 0;
  let backfillSuccess = 0;
  let finalHasContent = 0;

  for (const row of rows) {
    if (row.jsonParseSuccess) jsonParseSuccess++;
    if (row.inferHit) infer++;
    if (row.backfillAttempted) backfillAttempt++;
    if (row.backfillSuccess) backfillSuccess++;
    if (row.finalHasContent) finalHasContent++;
    byResolutionSource[row.resolutionSource] =
      (byResolutionSource[row.resolutionSource] ?? 0) + 1;

    const fam = row.modelFamily;
    if (!byModelFamily[fam]) {
      byModelFamily[fam] = {
        turns: 0,
        jsonParseSuccessRate: 0,
        inferRate: 0,
        backfillAttemptRate: 0,
        backfillSuccessRate: 0,
        finalHasContentRate: 0,
      };
    }
    const bucket = byModelFamily[fam];
    bucket.turns++;
    if (row.jsonParseSuccess) bucket.jsonParseSuccessRate++;
    if (row.inferHit) bucket.inferRate++;
    if (row.backfillAttempted) bucket.backfillAttemptRate++;
    if (row.backfillSuccess) bucket.backfillSuccessRate++;
    if (row.finalHasContent) bucket.finalHasContentRate++;
  }

  for (const bucket of Object.values(byModelFamily)) {
    const n = bucket.turns;
    if (n > 0) {
      bucket.jsonParseSuccessRate = bucket.jsonParseSuccessRate / n;
      bucket.inferRate = bucket.inferRate / n;
      bucket.backfillAttemptRate = bucket.backfillAttemptRate / n;
      bucket.backfillSuccessRate = bucket.backfillSuccessRate / n;
      bucket.finalHasContentRate = bucket.finalHasContentRate / n;
    }
  }

  const rate = (n: number) => (totalTurns > 0 ? n / totalTurns : 0);

  return {
    totalTurns,
    finalHasContentRate: rate(finalHasContent),
    jsonParseSuccessRate: rate(jsonParseSuccess),
    inferRate: rate(infer),
    backfillAttemptRate: rate(backfillAttempt),
    backfillSuccessRate: rate(backfillSuccess),
    byModelFamily,
    byResolutionSource,
  };
}
