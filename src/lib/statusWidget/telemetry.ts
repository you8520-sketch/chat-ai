import fs from "node:fs";
import path from "node:path";
import {
  isGeminiProOpenRouterModel,
  isAnthropicModel,
  isQwenModel,
  isDeepSeekV4ProModel,
} from "@/lib/chatModels";
import type { ParsedStatusWidgetTurnValues, ResolvedStatusWidgetTurn } from "./types";
import {
  normalizeParsedStatusWidgetValuesForTurn,
  statusWidgetValuesAreCorrupt,
} from "./parseValues";
import { sanitizeExtractedFacts } from "./extractedFacts";
import { splitProseAndStatusWidgetValuesDeepSeek } from "./deepseekCapture";
import { statusWidgetValuesHasContent } from "./displayPolicy";
import type { TokenUsage } from "@/lib/ai";
import { fieldPlaceholderKey } from "./fieldKeys";
import {
  stripStatusWidgetFromAssistantProse,
  WIDGET_EXTRACT_NARRATIVE_CHAR_BUDGET,
} from "./proseStrip";
import {
  diagnoseStatusWidgetValues,
  logStatusWidgetLiveTrace,
  statusWidgetDiagnosticHash,
} from "./diagnostics";

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
  characterIdentity?: string | null;
  personaName: string;
  userPersona?: string | null;
  userMessage: string;
  userNote?: string;
  assistantMessageId?: number;
  regenerateMessageId?: number;
  requestId?: string | null;
};

export type ResolveStatusWidgetTurnValuesResult = {
  prose: string;
  values: ParsedStatusWidgetTurnValues | null;
  widgetExtractUsage: TokenUsage | null;
  telemetry: StatusWidgetTurnTelemetry;
};

function statusWidgetParsedKeys(values: ParsedStatusWidgetTurnValues | null | undefined): string[] {
  return [
    ...Object.keys(values?.character ?? {}),
    ...Object.keys(values?.user ?? {}),
  ].sort();
}

function expectedStatusWidgetKeys(resolved: ResolvedStatusWidgetTurn): string[] {
  const keys = new Set<string>();
  if (resolved.needsCharacterValues && resolved.characterWidget) {
    for (const field of resolved.characterWidget.fields) {
      const key = fieldPlaceholderKey(field);
      if (key) keys.add(key);
    }
  }
  if (resolved.needsUserValues && resolved.userWidget) {
    for (const field of resolved.userWidget.fields) {
      const key = fieldPlaceholderKey(field);
      if (key) keys.add(key);
    }
  }
  return [...keys].sort();
}

export function logStatusWidgetValuesMissingDev(input: {
  messageId?: number;
  expectedKeys: string[];
  parsedKeys: string[];
  rawStatusBlockPresent: boolean;
  parseError?: string | null;
}): void {
  if (process.env.NODE_ENV === "production") return;
  const missingKeys = input.expectedKeys.filter((key) => !input.parsedKeys.includes(key));
  if (missingKeys.length === 0) return;
  console.warn("[StatusWidgetValuesMissing]", {
    messageId: input.messageId ?? null,
    expectedKeys: input.expectedKeys,
    parsedKeys: input.parsedKeys,
    missingKeys,
    rawStatusBlockPresent: input.rawStatusBlockPresent,
    parseError: input.parseError ?? null,
  });
}

export type V3StatusExtractTrace = {
  message_id?: number | null;
  requiredKeys: string[];
  parsedKeys: string[];
  missingKeys: string[];
  extractedFactsRawCount: number;
  extractedFactsValidCount: number;
  v3Used: boolean;
  fallbackUsed: boolean;
  parseError?: string | null;
};

/** Dev-only V3 extract reliability log — never logs prose. */
export function logV3StatusExtractDev(trace: V3StatusExtractTrace): void {
  if (process.env.NODE_ENV === "production") return;
  console.info("[V3StatusExtract]", JSON.stringify(trace));
}

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

  let v3ExtractAttempted = false;
  let v3ExtractSuccess = false;
  let valuesPayload: ParsedStatusWidgetTurnValues | null = null;
  let widgetExtractUsage: TokenUsage | null = null;
  let resolutionSource: StatusWidgetResolutionSource = "none";
  let splitRawHit = false;
  let splitRawParseError: string | null = null;
  const messageId = input.regenerateMessageId ?? input.assistantMessageId ?? null;
  const traceBase = {
    requestId: input.requestId ?? null,
    chatId: input.chatId,
    messageId,
  };

  logStatusWidgetLiveTrace({
    ...traceBase,
    phase: "status_extract_input",
    statusWidgetTurnActive: input.statusWidgetTurn.active,
    statusWidgetConfigured: Boolean(
      input.statusWidgetTurn.characterWidget || input.statusWidgetTurn.userWidget
    ),
    expectedKeys: expectedStatusWidgetKeys(input.statusWidgetTurn),
    v3ExtractCalled: false,
    contentLength: prose.length,
    contentHash: statusWidgetDiagnosticHash(prose),
  });

  try {
    const splitRaw = splitProseAndStatusWidgetValuesDeepSeek(input.rawWidgetSourceText);
    const rawValues = normalizeParsedStatusWidgetValuesForTurn(splitRaw.values, {
      characterWidget: input.statusWidgetTurn.characterWidget,
      userWidget: input.statusWidgetTurn.userWidget,
    });
    if (statusWidgetValuesHasContent(rawValues)) {
      valuesPayload = rawValues;
      splitRawHit = true;
      resolutionSource = "split_raw";
    }
    const rawDiag = diagnoseStatusWidgetValues({
      resolved: input.statusWidgetTurn,
      statusWidgetTurnActive: input.statusWidgetTurn.active,
      values: rawValues,
      model: input.modelId,
    });
    logStatusWidgetLiveTrace({
      ...traceBase,
      phase: "status_parse_result",
      statusWidgetTurnActive: input.statusWidgetTurn.active,
      statusWidgetConfigured: rawDiag.statusWidgetConfigured,
      expectedKeys: rawDiag.expectedKeys,
      parsedKeys: rawDiag.actualKeys,
      normalizedKeys: rawDiag.normalizedKeys,
      missingKeys: rawDiag.missingKeys,
      hasUsableValues: rawDiag.hasUsableValues,
      dbValueShape: rawDiag.dbValueShape,
      reasonCode: rawDiag.reasonCode,
    });
  } catch (e) {
    splitRawParseError = (e as Error).message;
  }

  if (!statusWidgetValuesHasContent(valuesPayload)) {
    try {
      const { extractStatusWidgetValuesForTurn } = await import("./extract");
      v3ExtractAttempted = true;
      logStatusWidgetLiveTrace({
        ...traceBase,
        phase: "v3_extract_start",
        statusWidgetTurnActive: input.statusWidgetTurn.active,
        statusWidgetConfigured: Boolean(
          input.statusWidgetTurn.characterWidget || input.statusWidgetTurn.userWidget
        ),
        expectedKeys: expectedStatusWidgetKeys(input.statusWidgetTurn),
        v3ExtractCalled: true,
        contentLength: prose.length,
        contentHash: statusWidgetDiagnosticHash(prose),
      });
      // Canonical clock/state for the extract prompt only — never copy onto this
      // message when extract returns empty (snapshot fallback stays removed).
      const { loadPreviousStatusWidgetValues, loadPreviousAssistantProse } =
        await import("./loadPrevious");
      const previousValues = normalizeParsedStatusWidgetValuesForTurn(
        loadPreviousStatusWidgetValues(input.chatId, messageId ?? undefined),
        {
          characterWidget: input.statusWidgetTurn.characterWidget,
          userWidget: input.statusWidgetTurn.userWidget,
        }
      );
      const previousAssistantProse = loadPreviousAssistantProse(
        input.chatId,
        messageId ?? undefined
      );
      const v3Result = await extractStatusWidgetValuesForTurn({
        charName: input.charName,
        characterIdentity: input.characterIdentity,
        personaName: input.personaName,
        userMessage: input.userMessage,
        assistantProse: prose,
        resolved: input.statusWidgetTurn,
        previousValues,
        previousAssistantProse,
        userNote: input.userNote,
        trace: traceBase,
      });
      widgetExtractUsage = v3Result.usage;
      const normalizedExtractValues = normalizeParsedStatusWidgetValuesForTurn(v3Result.values, {
        characterWidget: input.statusWidgetTurn.characterWidget,
        userWidget: input.statusWidgetTurn.userWidget,
      });
      const v3Diag = diagnoseStatusWidgetValues({
        resolved: input.statusWidgetTurn,
        statusWidgetTurnActive: input.statusWidgetTurn.active,
        values: v3Result.values,
        model: input.modelId,
      });
      const normalizedDiag = diagnoseStatusWidgetValues({
        resolved: input.statusWidgetTurn,
        statusWidgetTurnActive: input.statusWidgetTurn.active,
        values: normalizedExtractValues,
        model: input.modelId,
      });
      logStatusWidgetLiveTrace({
        ...traceBase,
        phase: "status_normalize_result",
        statusWidgetTurnActive: input.statusWidgetTurn.active,
        statusWidgetConfigured: normalizedDiag.statusWidgetConfigured,
        expectedKeys: normalizedDiag.expectedKeys,
        parsedKeys: v3Diag.actualKeys,
        normalizedKeys: normalizedDiag.normalizedKeys,
        missingKeys: normalizedDiag.missingKeys,
        hasUsableValues: normalizedDiag.hasUsableValues,
        dbValueShape: normalizedDiag.dbValueShape,
        reasonCode: normalizedDiag.hasUsableValues
          ? "OK"
          : v3Diag.actualKeys.length > 0
            ? normalizedDiag.reasonCode
            : "V3_EMPTY_OUTPUT",
      });
      if (statusWidgetValuesHasContent(normalizedExtractValues)) {
        v3ExtractSuccess = true;
        valuesPayload = normalizedExtractValues;
        resolutionSource = "v3_extract";
      }
    } catch (e) {
      console.warn("[status-widget] V3 extract failed", (e as Error).message);
      logStatusWidgetLiveTrace({
        ...traceBase,
        phase: "v3_extract_result",
        v3ExtractCalled: true,
        v3ExtractSucceeded: false,
        v3ExtractJsonFound: false,
        reasonCode: "V3_EMPTY_OUTPUT",
      });
    }
  }

  const expectedKeys = expectedStatusWidgetKeys(input.statusWidgetTurn);
  const parsedKeys = statusWidgetParsedKeys(valuesPayload);
  const missingKeys = expectedKeys.filter((key) => !parsedKeys.includes(key));
  const extractedFactsRaw = valuesPayload?.extracted_facts ?? [];
  const extractedFactsValid = sanitizeExtractedFacts(extractedFactsRaw);

  const finalHasContent = statusWidgetValuesHasContent(valuesPayload);
  logStatusWidgetValuesMissingDev({
    messageId: input.regenerateMessageId ?? input.assistantMessageId,
    expectedKeys,
    parsedKeys: finalHasContent ? parsedKeys : [],
    rawStatusBlockPresent: /<<<STATUS_VALUES/i.test(input.rawWidgetSourceText),
    parseError:
      splitRawParseError ??
      (!finalHasContent && expectedKeys.length > 0 ? "empty_or_placeholder_status_values" : null),
  });
  logV3StatusExtractDev({
    message_id: input.regenerateMessageId ?? input.assistantMessageId ?? null,
    requiredKeys: expectedKeys,
    parsedKeys: finalHasContent ? parsedKeys : [],
    missingKeys: finalHasContent ? missingKeys : expectedKeys,
    extractedFactsRawCount: Array.isArray(extractedFactsRaw) ? extractedFactsRaw.length : 0,
    extractedFactsValidCount: extractedFactsValid.length,
    v3Used: resolutionSource === "v3_extract",
    fallbackUsed: resolutionSource === "split_raw",
    parseError: splitRawParseError,
  });
  const corruptBeforeExtract = statusWidgetValuesAreCorrupt(valuesPayload);

  const telemetry: StatusWidgetTurnTelemetry = {
    event: "status_widget_turn",
    chatId: input.chatId,
    modelId: input.modelId,
    modelFamily: resolveStatusWidgetModelFamily(input.modelId),
    parserMode,
    streamCaptureHit: false,
    splitSavedHit: strippedLeak,
    splitRawHit,
    inferHit: false,
    backfillAttempted: !splitRawHit && v3ExtractAttempted,
    backfillSuccess: v3ExtractSuccess,
    backfillSkippedReason: splitRawHit
      ? "raw_status_values_used"
      : v3ExtractSuccess
        ? null
        : "v3_extract_empty",
    jsonParseSuccess: strippedLeak || splitRawHit,
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
