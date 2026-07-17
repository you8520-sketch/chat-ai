import {
  BACKGROUND_OPENROUTER_MODEL,
  callBackgroundMemory,
  type ChatMsg,
  type TokenUsage,
} from "@/lib/ai";
import { collectWidgetJsonKeys } from "./prompt";
import {
  buildWidgetExtractRepairSystem,
  buildWidgetExtractRepairUserBlock,
  buildWidgetExtractSystem,
  buildWidgetExtractUserBlock,
  extractJsonObjectFromWidgetText,
  normalizeWidgetExtraction,
} from "./extractNormalize";
import { mergeStatusWidgetExtractUsages } from "./receiptUsage";
import { mergeExtractedFacts, sanitizeExtractedFacts } from "./extractedFacts";
import {
  logStatusWidgetLiveTrace,
  type StatusWidgetExtractStage,
  type StatusWidgetReasonCode,
} from "./diagnostics";
import type {
  ExtractedStatusFact,
  ParsedStatusWidgetTurnValues,
  ResolvedStatusWidgetTurn,
  StatusWidget,
  StatusWidgetValues,
} from "./types";

const REPAIR_MAX_TOKENS = 256;

export type StatusWidgetExtractCaller = (
  system: string,
  history: ChatMsg[],
  opts: {
    requestKind: string;
    maxTokens?: number;
    temperature?: number;
    modelId: string;
  }
) => Promise<{ text: string; usage: TokenUsage }>;

export type StatusWidgetSourceExtractMeta = {
  source: "character" | "user";
  callCount: number;
  stages: StatusWidgetExtractStage[];
  finalStage: StatusWidgetExtractStage | null;
  finalReasonCode: StatusWidgetReasonCode;
  models: string[];
  attemptUsages: Array<{
    stage: StatusWidgetExtractStage;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
  }>;
};

export type StatusWidgetTurnExtractMeta = {
  character: StatusWidgetSourceExtractMeta | null;
  user: StatusWidgetSourceExtractMeta | null;
  totalCallCount: number;
  usedRepair: boolean;
  usedFallback: boolean;
  exhausted: boolean;
  mergedInputTokens: number;
  mergedOutputTokens: number;
};

/**
 * STATUS_WIDGET_FALLBACK_MODEL — explicit opt-in only:
 * - undefined / unset → OFF
 * - empty/whitespace → OFF
 * - non-empty model id → ON
 */
export function resolveStatusWidgetFallbackModel(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!Object.prototype.hasOwnProperty.call(env, "STATUS_WIDGET_FALLBACK_MODEL")) {
    return null;
  }
  const raw = env.STATUS_WIDGET_FALLBACK_MODEL;
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed ? trimmed : null;
}

/** Skip cross-model fallback when configured model equals the primary extract model. */
export function resolveEffectiveStatusWidgetFallbackModel(
  primaryModelId: string,
  fallbackModelId: string | null | undefined
): string | null {
  const fb = fallbackModelId?.trim() || null;
  if (!fb) return null;
  if (fb.toLowerCase() === primaryModelId.trim().toLowerCase()) return null;
  return fb;
}

const defaultExtractCaller: StatusWidgetExtractCaller = async (system, history, opts) =>
  callBackgroundMemory(system, history, undefined, opts.requestKind, {
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    modelId: opts.modelId,
  });

type AttemptOutcome = {
  ok: boolean;
  values: StatusWidgetValues | null;
  facts: ExtractedStatusFact[];
  usage: TokenUsage | null;
  reasonCode: StatusWidgetReasonCode;
  textLength: number;
  jsonFound: boolean;
  normalizedKeys: string[];
  modelId: string;
  stage: StatusWidgetExtractStage;
  attemptIndex: number;
  latencyMs: number;
};

function usableNormalizedKeys(values: StatusWidgetValues | null): string[] {
  if (!values) return [];
  return Object.entries(values)
    .filter(([, v]) => Boolean(v?.trim()))
    .map(([k]) => k);
}

function pushUsage(
  usages: TokenUsage[],
  attemptUsages: StatusWidgetSourceExtractMeta["attemptUsages"],
  outcome: AttemptOutcome
): void {
  if (outcome.usage) {
    usages.push(outcome.usage);
    attemptUsages.push({
      stage: outcome.stage,
      modelId: outcome.modelId,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
    });
  }
}

function logExtractAttempt(event: {
  trace?: { requestId?: string | null; chatId?: number | null; messageId?: number | null };
  source: "character" | "user";
  stage: StatusWidgetExtractStage;
  attemptIndex: number;
  modelId: string;
  textLength: number;
  jsonFound: boolean;
  normalizedKeys: string[];
  reasonCode: StatusWidgetReasonCode;
  usage: TokenUsage | null;
  latencyMs: number;
  succeeded: boolean;
}): void {
  logStatusWidgetLiveTrace({
    ...event.trace,
    phase: "v3_extract_result",
    extractSource: event.source,
    extractStage: event.stage,
    extractAttemptIndex: event.attemptIndex,
    extractModelId: event.modelId,
    v3ExtractCalled: true,
    v3ExtractSucceeded: event.succeeded,
    v3ExtractReturnedTextLength: event.textLength,
    v3ExtractJsonFound: event.jsonFound,
    normalizedKeys: event.normalizedKeys,
    hasUsableValues: event.normalizedKeys.length > 0,
    inputTokens: event.usage?.inputTokens,
    outputTokens: event.usage?.outputTokens,
    latencyMs: event.latencyMs,
    reasonCode: event.reasonCode,
  });

  // Always emit compact extract metrics (no prompt/RP prose).
  console.info(
    "[StatusWidgetExtractAttempt]",
    JSON.stringify({
      source: event.source,
      stage: event.stage,
      attemptIndex: event.attemptIndex,
      modelId: event.modelId,
      textLength: event.textLength,
      jsonFound: event.jsonFound,
      normalizedKeys: event.normalizedKeys,
      reasonCode: event.reasonCode,
      inputTokens: event.usage?.inputTokens ?? null,
      outputTokens: event.usage?.outputTokens ?? null,
      latencyMs: event.latencyMs,
      succeeded: event.succeeded,
      requestId: event.trace?.requestId ?? null,
      chatId: event.trace?.chatId ?? null,
      messageId: event.trace?.messageId ?? null,
    })
  );
}

async function runExtractAttempt(opts: {
  system: string;
  userBlock: string;
  widget: StatusWidget;
  source: "character" | "user";
  stage: StatusWidgetExtractStage;
  attemptIndex: number;
  modelId: string;
  requestKind: string;
  maxTokens?: number;
  temperature?: number;
  caller: StatusWidgetExtractCaller;
  trace?: { requestId?: string | null; chatId?: number | null; messageId?: number | null };
}): Promise<AttemptOutcome> {
  const started = Date.now();
  try {
    const { text, usage } = await opts.caller(opts.system, [{ role: "user", content: opts.userBlock }], {
      requestKind: opts.requestKind,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      modelId: opts.modelId,
    });
    const latencyMs = Date.now() - started;
    const textLength = text?.length ?? 0;
    if (!text?.trim()) {
      const outcome: AttemptOutcome = {
        ok: false,
        values: null,
        facts: [],
        usage,
        reasonCode:
          opts.stage === "initial"
            ? "V3_INITIAL_EMPTY"
            : opts.stage === "repair"
              ? "V3_REPAIR_FAILED"
              : "FALLBACK_MODEL_FAILED",
        textLength,
        jsonFound: false,
        normalizedKeys: [],
        modelId: opts.modelId,
        stage: opts.stage,
        attemptIndex: opts.attemptIndex,
        latencyMs,
      };
      logExtractAttempt({ ...outcome, trace: opts.trace, source: opts.source, succeeded: false });
      return outcome;
    }

    const parsed = extractJsonObjectFromWidgetText(text);
    if (!parsed) {
      const outcome: AttemptOutcome = {
        ok: false,
        values: null,
        facts: [],
        usage,
        reasonCode:
          opts.stage === "initial"
            ? "V3_PARSE_FAILED"
            : opts.stage === "repair"
              ? "V3_REPAIR_FAILED"
              : "FALLBACK_MODEL_FAILED",
        textLength,
        jsonFound: false,
        normalizedKeys: [],
        modelId: opts.modelId,
        stage: opts.stage,
        attemptIndex: opts.attemptIndex,
        latencyMs,
      };
      logExtractAttempt({ ...outcome, trace: opts.trace, source: opts.source, succeeded: false });
      return outcome;
    }

    const normalized = normalizeWidgetExtraction(parsed, opts.widget);
    const normalizedKeys = usableNormalizedKeys(normalized);
    const ok = normalizedKeys.length > 0;
    const values = ok ? normalized : null;
    const reasonCode: StatusWidgetReasonCode = ok
      ? opts.stage === "initial"
        ? "OK"
        : opts.stage === "repair"
          ? "V3_REPAIR_USED"
          : "FALLBACK_MODEL_USED"
      : opts.stage === "initial"
        ? "V3_INITIAL_EMPTY"
        : opts.stage === "repair"
          ? "V3_REPAIR_FAILED"
          : "FALLBACK_MODEL_FAILED";

    const outcome: AttemptOutcome = {
      ok,
      values,
      facts: ok ? sanitizeExtractedFacts(parsed.extracted_facts) : [],
      usage,
      reasonCode,
      textLength,
      jsonFound: true,
      normalizedKeys,
      modelId: opts.modelId,
      stage: opts.stage,
      attemptIndex: opts.attemptIndex,
      latencyMs,
    };
    logExtractAttempt({ ...outcome, trace: opts.trace, source: opts.source, succeeded: ok });
    return outcome;
  } catch (e) {
    const latencyMs = Date.now() - started;
    console.error("[STATUS-WIDGET-ERROR] extract call failed", (e as Error).message);
    const reasonCode: StatusWidgetReasonCode =
      opts.stage === "initial"
        ? "V3_INITIAL_EMPTY"
        : opts.stage === "repair"
          ? "V3_REPAIR_FAILED"
          : "FALLBACK_MODEL_FAILED";
    const outcome: AttemptOutcome = {
      ok: false,
      values: null,
      facts: [],
      usage: null,
      reasonCode,
      textLength: 0,
      jsonFound: false,
      normalizedKeys: [],
      modelId: opts.modelId,
      stage: opts.stage,
      attemptIndex: opts.attemptIndex,
      latencyMs,
    };
    logExtractAttempt({ ...outcome, trace: opts.trace, source: opts.source, succeeded: false });
    return outcome;
  }
}

async function extractStatusWidgetValuesForWidget(opts: {
  charName: string;
  characterIdentity?: string | null;
  personaName: string;
  userPersona?: string | null;
  userMessage: string;
  assistantProse: string;
  widget: StatusWidget;
  source: "character" | "user";
  previousValues?: StatusWidgetValues | null;
  previousAssistantProse?: string | null;
  userNote?: string;
  trace?: { requestId?: string | null; chatId?: number | null; messageId?: number | null };
  caller?: StatusWidgetExtractCaller;
  primaryModelId?: string;
  fallbackModelId?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<{
  values: StatusWidgetValues | null;
  facts: ExtractedStatusFact[];
  usage: TokenUsage | null;
  meta: StatusWidgetSourceExtractMeta;
}> {
  const keys = collectWidgetJsonKeys(opts.widget);
  if (keys.length === 0) {
    return {
      values: null,
      facts: [],
      usage: null,
      meta: {
        source: opts.source,
        callCount: 0,
        stages: [],
        finalStage: null,
        finalReasonCode: "STATUS_WIDGET_NOT_CONFIGURED",
        models: [],
        attemptUsages: [],
      },
    };
  }

  const caller = opts.caller ?? defaultExtractCaller;
  const primaryModelId = opts.primaryModelId?.trim() || BACKGROUND_OPENROUTER_MODEL;
  const configuredFallback =
    opts.fallbackModelId !== undefined
      ? opts.fallbackModelId?.trim() || null
      : resolveStatusWidgetFallbackModel(opts.env ?? process.env);
  const fallbackModelId = resolveEffectiveStatusWidgetFallbackModel(
    primaryModelId,
    configuredFallback
  );

  const usages: TokenUsage[] = [];
  const stages: StatusWidgetExtractStage[] = [];
  const models: string[] = [];
  const attemptUsages: StatusWidgetSourceExtractMeta["attemptUsages"] = [];

  const system = buildWidgetExtractSystem(opts.widget, keys, opts.source);
  const userBlock = buildWidgetExtractUserBlock(opts);

  const initial = await runExtractAttempt({
    system,
    userBlock,
    widget: opts.widget,
    source: opts.source,
    stage: "initial",
    attemptIndex: 1,
    modelId: primaryModelId,
    requestKind: "background-status-widget-extract",
    caller,
    trace: opts.trace,
  });
  stages.push("initial");
  models.push(primaryModelId);
  pushUsage(usages, attemptUsages, initial);
  if (initial.ok) {
    return {
      values: initial.values,
      facts: initial.facts,
      usage: mergeStatusWidgetExtractUsages(usages),
      meta: {
        source: opts.source,
        callCount: 1,
        stages,
        finalStage: "initial",
        finalReasonCode: "OK",
        models,
        attemptUsages,
      },
    };
  }

  // Same-model repair once — slim prompt + previous canonical anchor, temp 0.
  const repairSystem = buildWidgetExtractRepairSystem(keys);
  const repairUser = buildWidgetExtractRepairUserBlock({
    keys,
    assistantProse: opts.assistantProse,
    previousValues: opts.previousValues,
    widget: opts.widget,
  });
  const repair = await runExtractAttempt({
    system: repairSystem,
    userBlock: repairUser,
    widget: opts.widget,
    source: opts.source,
    stage: "repair",
    attemptIndex: 2,
    modelId: primaryModelId,
    requestKind: "background-status-widget-extract-repair",
    maxTokens: REPAIR_MAX_TOKENS,
    temperature: 0,
    caller,
    trace: opts.trace,
  });
  stages.push("repair");
  models.push(primaryModelId);
  pushUsage(usages, attemptUsages, repair);
  if (repair.ok) {
    return {
      values: repair.values,
      facts: repair.facts,
      usage: mergeStatusWidgetExtractUsages(usages),
      meta: {
        source: opts.source,
        callCount: 2,
        stages,
        finalStage: "repair",
        finalReasonCode: "V3_REPAIR_USED",
        models,
        attemptUsages,
      },
    };
  }

  if (fallbackModelId) {
    const fallback = await runExtractAttempt({
      system: repairSystem,
      userBlock: repairUser,
      widget: opts.widget,
      source: opts.source,
      stage: "fallback",
      attemptIndex: 3,
      modelId: fallbackModelId,
      requestKind: "background-status-widget-extract-fallback",
      maxTokens: REPAIR_MAX_TOKENS,
      temperature: 0,
      caller,
      trace: opts.trace,
    });
    stages.push("fallback");
    models.push(fallbackModelId);
    pushUsage(usages, attemptUsages, fallback);
    if (fallback.ok) {
      return {
        values: fallback.values,
        facts: fallback.facts,
        usage: mergeStatusWidgetExtractUsages(usages),
        meta: {
          source: opts.source,
          callCount: 3,
          stages,
          finalStage: "fallback",
          finalReasonCode: "FALLBACK_MODEL_USED",
          models,
          attemptUsages,
        },
      };
    }
    return {
      values: null,
      facts: [],
      usage: mergeStatusWidgetExtractUsages(usages),
      meta: {
        source: opts.source,
        callCount: 3,
        stages,
        finalStage: "fallback",
        finalReasonCode: "STATUS_WIDGET_EXTRACT_EXHAUSTED",
        models,
        attemptUsages,
      },
    };
  }

  // No distinct fallback model (unset, empty, or same as primary) → exhausted after repair.
  return {
    values: null,
    facts: [],
    usage: mergeStatusWidgetExtractUsages(usages),
    meta: {
      source: opts.source,
      callCount: 2,
      stages,
      finalStage: "repair",
      finalReasonCode: "STATUS_WIDGET_EXTRACT_EXHAUSTED",
      models,
      attemptUsages,
    },
  };
}

export async function extractStatusWidgetValuesForTurn(opts: {
  charName: string;
  characterIdentity?: string | null;
  personaName: string;
  userPersona?: string | null;
  userMessage: string;
  assistantProse: string;
  resolved: ResolvedStatusWidgetTurn;
  previousValues?: ParsedStatusWidgetTurnValues | null;
  previousAssistantProse?: string | null;
  userNote?: string;
  trace?: { requestId?: string | null; chatId?: number | null; messageId?: number | null };
  /** Test seam — defaults to callBackgroundMemory */
  caller?: StatusWidgetExtractCaller;
  primaryModelId?: string;
  fallbackModelId?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<{
  values: ParsedStatusWidgetTurnValues;
  usage: TokenUsage | null;
  meta: StatusWidgetTurnExtractMeta;
}> {
  const out: ParsedStatusWidgetTurnValues = {};
  const usages: TokenUsage[] = [];
  const factBatches: ExtractedStatusFact[][] = [];
  let characterMeta: StatusWidgetSourceExtractMeta | null = null;
  let userMeta: StatusWidgetSourceExtractMeta | null = null;

  // Per-source sequential extract: only retry the failing source.
  if (opts.resolved.needsCharacterValues && opts.resolved.characterWidget) {
    const character = await extractStatusWidgetValuesForWidget({
      charName: opts.charName,
      characterIdentity: opts.characterIdentity,
      personaName: opts.personaName,
      userPersona: opts.userPersona,
      userMessage: opts.userMessage,
      assistantProse: opts.assistantProse,
      widget: opts.resolved.characterWidget,
      source: "character",
      previousValues: opts.previousValues?.character ?? null,
      previousAssistantProse: opts.previousAssistantProse,
      userNote: opts.userNote,
      trace: opts.trace,
      caller: opts.caller,
      primaryModelId: opts.primaryModelId,
      fallbackModelId: opts.fallbackModelId,
      env: opts.env,
    });
    out.character = character.values;
    if (character.facts.length > 0) factBatches.push(character.facts);
    if (character.usage) usages.push(character.usage);
    characterMeta = character.meta;
  }

  if (opts.resolved.needsUserValues && opts.resolved.userWidget) {
    const user = await extractStatusWidgetValuesForWidget({
      charName: opts.charName,
      characterIdentity: opts.characterIdentity,
      personaName: opts.personaName,
      userPersona: opts.userPersona,
      userMessage: opts.userMessage,
      assistantProse: opts.assistantProse,
      widget: opts.resolved.userWidget,
      source: "user",
      previousValues: opts.previousValues?.user ?? null,
      previousAssistantProse: opts.previousAssistantProse,
      userNote: opts.userNote,
      trace: opts.trace,
      caller: opts.caller,
      primaryModelId: opts.primaryModelId,
      fallbackModelId: opts.fallbackModelId,
      env: opts.env,
    });
    out.user = user.values;
    if (user.facts.length > 0) factBatches.push(user.facts);
    if (user.usage) usages.push(user.usage);
    userMeta = user.meta;
  }

  // Final merge/dedupe once across sources.
  let mergedFacts: ExtractedStatusFact[] | undefined;
  for (const batch of factBatches) {
    mergedFacts = mergeExtractedFacts(mergedFacts, batch);
  }
  if (mergedFacts?.length) out.extracted_facts = mergedFacts;

  const totalCallCount = (characterMeta?.callCount ?? 0) + (userMeta?.callCount ?? 0);
  const usedRepair =
    characterMeta?.stages.includes("repair") === true || userMeta?.stages.includes("repair") === true;
  const usedFallback =
    characterMeta?.stages.includes("fallback") === true ||
    userMeta?.stages.includes("fallback") === true;
  const exhausted =
    characterMeta?.finalReasonCode === "STATUS_WIDGET_EXTRACT_EXHAUSTED" ||
    userMeta?.finalReasonCode === "STATUS_WIDGET_EXTRACT_EXHAUSTED";
  const mergedUsage = mergeStatusWidgetExtractUsages(usages);

  return {
    values: out,
    usage: mergedUsage,
    meta: {
      character: characterMeta,
      user: userMeta,
      totalCallCount,
      usedRepair,
      usedFallback,
      exhausted,
      mergedInputTokens: mergedUsage?.inputTokens ?? 0,
      mergedOutputTokens: mergedUsage?.outputTokens ?? 0,
    },
  };
}
