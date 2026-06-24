import fs from "node:fs";
import path from "node:path";
import {
  isDeepSeekV4ProModel,
  isGemini25ProModel,
  isGeminiProOpenRouterModel,
  isAnthropicModel,
  isQwenModel,
} from "@/lib/chatModels";
import type { ParsedStatusWidgetTurnValues, ResolvedStatusWidgetTurn } from "./types";
import {
  inferWidgetValuesFromProse,
  sanitizeParsedStatusWidgetValues,
  splitProseAndStatusWidgetValues,
  statusWidgetValuesAreCorrupt,
} from "./parseValues";
import { splitProseAndStatusWidgetValuesDeepSeek } from "./deepseekCapture";
import { statusWidgetValuesHasContent } from "./displayPolicy";

export type StatusWidgetModelFamily =
  | "deepseek"
  | "gemini"
  | "openai"
  | "anthropic"
  | "qwen"
  | "other";

export type StatusWidgetParserMode = "standard" | "deepseek";

export type StatusWidgetResolutionSource =
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
  /** <<<STATUS_VALUES>>> / legacy trailing JSON parse succeeded (split path) */
  jsonParseSuccess: boolean;
  resolutionSource: StatusWidgetResolutionSource;
  finalHasContent: boolean;
  finalCorruptBeforeBackfill: boolean;
  regenerate: boolean;
};

export const STATUS_WIDGET_TELEMETRY_LOG_PREFIX = "[status-widget-telemetry]";

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

function pickSplitFn(modelId: string) {
  return resolveStatusWidgetParserMode(modelId) === "deepseek"
    ? splitProseAndStatusWidgetValuesDeepSeek
    : splitProseAndStatusWidgetValues;
}

function hasSplitValues(values: ParsedStatusWidgetTurnValues): boolean {
  return Boolean(values.character || values.user);
}

export type ResolveStatusWidgetTurnValuesInput = {
  chatId: number;
  modelId: string;
  regenerate?: boolean;
  savedText: string;
  rawWidgetSourceText: string;
  statusWidgetTurn: ResolvedStatusWidgetTurn;
  streamCapture: ParsedStatusWidgetTurnValues | null;
  statusArtifactCapture: ParsedStatusWidgetTurnValues | null;
  charName: string;
  personaName: string;
  userMessage: string;
  userNote?: string;
  regenerateMessageId?: number;
};

export type ResolveStatusWidgetTurnValuesResult = {
  prose: string;
  values: ParsedStatusWidgetTurnValues | null;
  telemetry: StatusWidgetTurnTelemetry;
};

export async function resolveStatusWidgetTurnValues(
  input: ResolveStatusWidgetTurnValuesInput
): Promise<ResolveStatusWidgetTurnValuesResult> {
  const parserMode = resolveStatusWidgetParserMode(input.modelId);
  const splitWidgetValues = pickSplitFn(input.modelId);

  let prose = input.savedText;
  let valuesPayload: ParsedStatusWidgetTurnValues | null = sanitizeParsedStatusWidgetValues(
    input.streamCapture ?? input.statusArtifactCapture ?? null
  );
  if (!statusWidgetValuesHasContent(valuesPayload)) {
    valuesPayload = null;
  }

  const streamCaptureHit = statusWidgetValuesHasContent(
    sanitizeParsedStatusWidgetValues(input.streamCapture ?? null)
  );
  const streamArtifactHit =
    !streamCaptureHit &&
    statusWidgetValuesHasContent(
      sanitizeParsedStatusWidgetValues(input.statusArtifactCapture ?? null)
    );

  let splitSavedHit = false;
  let splitRawHit = false;
  let inferHit = false;
  let backfillAttempted = false;
  let backfillSuccess = false;
  let backfillSkippedReason: string | null = null;
  let jsonParseSuccess = false;
  let resolutionSource: StatusWidgetResolutionSource = streamCaptureHit
    ? "stream_capture"
    : streamArtifactHit
      ? "stream_capture"
      : "none";

  if (streamCaptureHit || streamArtifactHit) {
    jsonParseSuccess = true;
  }

  const widgetSplitSaved = splitWidgetValues(prose);
  prose = widgetSplitSaved.prose;
  if (hasSplitValues(widgetSplitSaved.values)) {
    valuesPayload = sanitizeParsedStatusWidgetValues(widgetSplitSaved.values);
    splitSavedHit = true;
    jsonParseSuccess = true;
    resolutionSource = "split_saved";
  }

  if (!statusWidgetValuesHasContent(valuesPayload)) {
    const fromRaw = splitWidgetValues(input.rawWidgetSourceText);
    if (hasSplitValues(fromRaw.values)) {
      valuesPayload = sanitizeParsedStatusWidgetValues(fromRaw.values);
      splitRawHit = true;
      jsonParseSuccess = true;
      resolutionSource = "split_raw";
    }
  }

  if (
    !statusWidgetValuesHasContent(valuesPayload) &&
    input.statusWidgetTurn.characterWidget
  ) {
    const inferred = inferWidgetValuesFromProse(
      input.rawWidgetSourceText,
      input.statusWidgetTurn.characterWidget
    );
    if (inferred) {
      inferHit = true;
      valuesPayload = sanitizeParsedStatusWidgetValues({
        character: inferred,
        user: valuesPayload?.user ?? null,
      });
      resolutionSource = "infer";
    }
  }

  const corruptBeforeBackfill = statusWidgetValuesAreCorrupt(valuesPayload);
  const backfillEligible =
    isDeepSeekV4ProModel(input.modelId) || isGemini25ProModel(input.modelId);

  if (!backfillEligible) {
    backfillSkippedReason = "model_not_eligible";
  } else if (
    statusWidgetValuesHasContent(valuesPayload) &&
    !corruptBeforeBackfill
  ) {
    backfillSkippedReason = "values_ok";
  } else if (
    !statusWidgetValuesHasContent(valuesPayload) &&
    !corruptBeforeBackfill
  ) {
    backfillSkippedReason = "values_empty";
  }

  if (
    backfillEligible &&
    (!statusWidgetValuesHasContent(valuesPayload) || corruptBeforeBackfill)
  ) {
    backfillAttempted = true;
    backfillSkippedReason = null;
    try {
      const { extractStatusWidgetValuesForTurn } = await import("./extract");
      const { loadPreviousStatusWidgetValues } = await import("./loadPrevious");
      const flashValues = await extractStatusWidgetValuesForTurn({
        charName: input.charName,
        personaName: input.personaName,
        userMessage: input.userMessage,
        assistantProse: prose,
        resolved: input.statusWidgetTurn,
        previousValues: loadPreviousStatusWidgetValues(
          input.chatId,
          input.regenerateMessageId
        ),
        userNote: input.userNote,
      });
      if (statusWidgetValuesHasContent(flashValues)) {
        backfillSuccess = true;
        valuesPayload = flashValues;
        resolutionSource = "backfill";
      }
    } catch (e) {
      console.warn("[status-widget] flash backfill failed", (e as Error).message);
    }
  }

  const finalHasContent = statusWidgetValuesHasContent(valuesPayload);

  const telemetry: StatusWidgetTurnTelemetry = {
    event: "status_widget_turn",
    chatId: input.chatId,
    modelId: input.modelId,
    modelFamily: resolveStatusWidgetModelFamily(input.modelId),
    parserMode,
    streamCaptureHit,
    splitSavedHit,
    splitRawHit,
    inferHit,
    backfillAttempted,
    backfillSuccess,
    backfillSkippedReason,
    jsonParseSuccess,
    resolutionSource: finalHasContent ? resolutionSource : "none",
    finalHasContent,
    finalCorruptBeforeBackfill: corruptBeforeBackfill,
    regenerate: input.regenerate === true,
  };

  return {
    prose,
    values: finalHasContent ? valuesPayload : null,
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
