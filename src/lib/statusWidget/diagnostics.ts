import { statusWidgetFieldLookupKeys } from "./fieldKeys";
import { normalizeParsedStatusWidgetValuesForTurn } from "./parseValues";
import { shouldShowStatusWidgetOnMessage, statusWidgetValuesHasContent } from "./displayPolicy";
import type {
  ParsedStatusWidgetTurnValues,
  ResolvedStatusWidgetTurn,
  StatusWidget,
  StatusWidgetValues,
} from "./types";

export type StatusWidgetReasonCode =
  | "OK"
  | "STATUS_WIDGET_NOT_CONFIGURED"
  | "STATUS_WIDGET_INACTIVE"
  | "NO_STATUS_BLOCK"
  | "V3_NOT_CALLED"
  | "V3_EMPTY_OUTPUT"
  | "V3_PARSE_FAILED"
  | "V3_INITIAL_EMPTY"
  | "V3_REPAIR_USED"
  | "V3_REPAIR_FAILED"
  | "V3_PREVIOUS_ECHO_REPAIR_USED"
  | "V3_PREVIOUS_ECHO_REPAIR_FAILED"
  | "FALLBACK_MODEL_USED"
  | "FALLBACK_MODEL_FAILED"
  | "STATUS_WIDGET_EXTRACT_EXHAUSTED"
  | "KEY_MAPPING_MISMATCH"
  | "MISSING_REQUIRED_KEYS"
  | "PLACEHOLDER_ONLY"
  | "SAVE_SKIPPED"
  | "FINALIZE_OVERWROTE_VALUES"
  | "FINALIZE_OVERWROTE_VALUES_PREVENTED"
  | "REGENERATION_SKIPPED_STATUS"
  | "HYDRATION_DROPPED_VALUES"
  | "RENDERER_KEY_MISMATCH"
  | "TEMPORAL_UNKNOWN_PREVIOUS"
  | "TEMPORAL_UNKNOWN_RAW"
  | "TEMPORAL_ANCHOR_FIELD_SKIPPED"
  | "TEMPORAL_REPAIR_USED"
  | "TEMPORAL_REPAIR_FAILED"
  | "UNKNOWN";

export type StatusWidgetDbValueShape =
  | "null"
  | "empty_object"
  | "placeholder_only"
  | "usable_values"
  | "key_mismatch"
  | "invalid_json";

export type StatusWidgetDiagnostic = {
  statusWidgetTurnActive: boolean;
  statusWidgetConfigured: boolean;
  expectedKeys: string[];
  actualKeys: string[];
  normalizedKeys: string[];
  missingKeys: string[];
  placeholderOnly: boolean;
  hasUsableValues: boolean;
  rendererWouldShow: boolean;
  rendererWouldShowEditPreview: boolean;
  dbValueShape: StatusWidgetDbValueShape;
  reasonCode: StatusWidgetReasonCode;
};

export type StatusWidgetLiveTracePhase =
  | "before_generation_finalize"
  | "status_extract_input"
  | "previous_temporal_anchor"
  | "v3_extract_start"
  | "v3_extract_result"
  | "status_parse_result"
  | "status_normalize_result"
  | "status_backfill_result"
  | "before_db_save"
  | "after_db_save"
  | "after_finalize"
  | "api_hydration"
  | "render_diagnostics";

export type StatusWidgetExtractStage =
  | "initial"
  | "repair"
  | "fallback"
  | "volatile_echo_repair";

export type StatusWidgetLiveTraceEvent = {
  requestId?: string | null;
  chatId?: number | null;
  messageId?: number | null;
  phase: StatusWidgetLiveTracePhase;
  statusWidgetTurnActive?: boolean;
  statusWidgetConfigured?: boolean;
  expectedKeys?: string[];
  v3ExtractCalled?: boolean;
  v3ExtractSucceeded?: boolean;
  v3ExtractReturnedTextLength?: number;
  v3ExtractJsonFound?: boolean;
  parsedKeys?: string[];
  normalizedKeys?: string[];
  missingKeys?: string[];
  hasUsableValues?: boolean;
  dbValueShape?: StatusWidgetDbValueShape;
  savedToDb?: boolean;
  overwrittenByEmpty?: boolean;
  reasonCode?: StatusWidgetReasonCode;
  contentLength?: number;
  contentHash?: string | null;
  statusValuesHash?: string | null;
  /** character | user source for per-widget extract attempts */
  extractSource?: "character" | "user";
  extractStage?: StatusWidgetExtractStage;
  extractModelId?: string;
  /** 1-based attempt index within a source (initial=1, repair=2, fallback=3) */
  extractAttemptIndex?: number;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
};

function hashString(text: string | null | undefined): string | null {
  if (text == null) return null;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function statusWidgetDiagnosticHash(text: string | null | undefined): string | null {
  return hashString(text);
}

function parseTraceList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

export function shouldTraceStatusWidget(input: {
  chatId?: number | null;
  requestId?: string | null;
  messageId?: number | null;
}): boolean {
  if (process.env.STATUS_WIDGET_TRACE_ENABLED !== "1") return false;
  const chatIds = parseTraceList(process.env.STATUS_WIDGET_TRACE_CHAT_IDS);
  const requestIds = parseTraceList(process.env.STATUS_WIDGET_TRACE_REQUEST_IDS);
  const messageIds = parseTraceList(process.env.STATUS_WIDGET_TRACE_MESSAGE_IDS);
  const chatAllowed =
    chatIds.size === 0 || (input.chatId != null && chatIds.has(String(input.chatId)));
  const requestAllowed =
    requestIds.size === 0 || (input.requestId != null && requestIds.has(input.requestId));
  const messageAllowed =
    messageIds.size === 0 || (input.messageId != null && messageIds.has(String(input.messageId)));
  return chatAllowed && requestAllowed && messageAllowed;
}

export function logStatusWidgetLiveTrace(event: StatusWidgetLiveTraceEvent): void {
  if (
    !shouldTraceStatusWidget({
      chatId: event.chatId,
      requestId: event.requestId,
      messageId: event.messageId,
    })
  ) {
    return;
  }
  console.info("[StatusWidgetLiveTrace]", JSON.stringify(event));
}

function isWidgetPlaceholderValue(value: string | null | undefined): boolean {
  const t = value?.trim() ?? "";
  return !t || t === "—" || t === "-" || t === "..." || t === "<scene value>" || /^[.·\s-]+$/.test(t);
}

function keysForWidget(widget: StatusWidget | null | undefined): string[] {
  return widget?.fields.map((field) => field.id).filter(Boolean) ?? [];
}

function hasAnyRawValue(values: ParsedStatusWidgetTurnValues | null | undefined): boolean {
  const check = (v?: StatusWidgetValues | null) =>
    Boolean(v && Object.values(v).some((x) => x?.trim()));
  return check(values?.character) || check(values?.user);
}

function valuesPlaceholderOnly(values: ParsedStatusWidgetTurnValues | null | undefined): boolean {
  if (!hasAnyRawValue(values)) return false;
  const all = [
    ...Object.values(values?.character ?? {}),
    ...Object.values(values?.user ?? {}),
  ];
  return all.length > 0 && all.every(isWidgetPlaceholderValue);
}

function rawKeys(values: ParsedStatusWidgetTurnValues | null | undefined): string[] {
  return [
    ...Object.keys(values?.character ?? {}),
    ...Object.keys(values?.user ?? {}),
  ];
}

function missingKeysForWidget(widget: StatusWidget | null | undefined, values: StatusWidgetValues): string[] {
  if (!widget) return [];
  return widget.fields
    .filter((field) => {
      for (const key of statusWidgetFieldLookupKeys(field, widget.htmlTemplate)) {
        const candidate = values[key];
        if (candidate != null && !isWidgetPlaceholderValue(candidate)) return false;
      }
      return true;
    })
    .map((field) => field.id);
}

export function diagnoseStatusWidgetValues(input: {
  resolved: ResolvedStatusWidgetTurn;
  statusWidgetTurnActive: boolean;
  values: ParsedStatusWidgetTurnValues | null | undefined;
  model?: string;
  isStreaming?: boolean;
  invalidJson?: boolean;
}): StatusWidgetDiagnostic {
  const { resolved } = input;
  const statusWidgetConfigured = Boolean(resolved.characterWidget || resolved.userWidget);
  const expectedKeys = [
    ...(resolved.needsCharacterValues ? keysForWidget(resolved.characterWidget) : []),
    ...(resolved.needsUserValues ? keysForWidget(resolved.userWidget) : []),
  ];
  const actualKeys = rawKeys(input.values);
  const normalized = normalizeParsedStatusWidgetValuesForTurn(input.values, {
    characterWidget: resolved.characterWidget,
    userWidget: resolved.userWidget,
  });
  const normalizedKeys = rawKeys(normalized);
  const missingKeys = [
    ...(resolved.needsCharacterValues
      ? missingKeysForWidget(resolved.characterWidget, normalized.character ?? {})
      : []),
    ...(resolved.needsUserValues
      ? missingKeysForWidget(resolved.userWidget, normalized.user ?? {})
      : []),
  ];
  const hasUsableValues = statusWidgetValuesHasContent(normalized);
  const placeholderOnly = valuesPlaceholderOnly(input.values) || valuesPlaceholderOnly(normalized);
  const rendererWouldShow = shouldShowStatusWidgetOnMessage({
    model: input.model,
    statusWidgetTurnActive: input.statusWidgetTurnActive,
    statusWidgetValues: normalized,
    isStreaming: input.isStreaming,
    displayHidden: resolved.displayMode === "hidden",
  });

  let dbValueShape: StatusWidgetDbValueShape;
  if (input.invalidJson) dbValueShape = "invalid_json";
  else if (!input.values) dbValueShape = "null";
  else if (actualKeys.length === 0) dbValueShape = "empty_object";
  else if (hasUsableValues) dbValueShape = missingKeys.length > 0 ? "key_mismatch" : "usable_values";
  else dbValueShape = "placeholder_only";

  let reasonCode: StatusWidgetReasonCode = "UNKNOWN";
  if (input.invalidJson) reasonCode = "V3_PARSE_FAILED";
  else if (!statusWidgetConfigured) reasonCode = "STATUS_WIDGET_NOT_CONFIGURED";
  else if (!resolved.active && !input.statusWidgetTurnActive) reasonCode = "STATUS_WIDGET_INACTIVE";
  else if (placeholderOnly) reasonCode = "PLACEHOLDER_ONLY";
  else if (missingKeys.length > 0) reasonCode = normalizedKeys.length > 0 ? "KEY_MAPPING_MISMATCH" : "MISSING_REQUIRED_KEYS";
  else if (hasUsableValues) reasonCode = "OK";
  else if (dbValueShape === "empty_object" || dbValueShape === "null") reasonCode = "MISSING_REQUIRED_KEYS";

  return {
    statusWidgetTurnActive: input.statusWidgetTurnActive,
    statusWidgetConfigured,
    expectedKeys,
    actualKeys,
    normalizedKeys,
    missingKeys,
    placeholderOnly,
    hasUsableValues,
    rendererWouldShow,
    rendererWouldShowEditPreview: rendererWouldShow,
    dbValueShape,
    reasonCode,
  };
}
