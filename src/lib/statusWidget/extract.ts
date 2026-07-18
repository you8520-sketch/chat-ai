import {
  BACKGROUND_OPENROUTER_MODEL,
  callBackgroundMemory,
  type ChatMsg,
  type TokenUsage,
} from "@/lib/ai";
import { collectWidgetJsonKeys } from "./prompt";
import {
  buildCombinedDualWidgetExtractSystem,
  buildCombinedDualWidgetExtractUserBlock,
  buildWidgetExtractRepairSystem,
  buildWidgetExtractRepairUserBlock,
  buildWidgetExtractSystem,
  buildWidgetExtractUserBlock,
  dropRepairEchoFields,
  extractJsonObjectFromWidgetText,
  normalizeWidgetExtraction,
  parseCombinedDualWidgetExtractResponse,
  resolveRepairMaxTokens,
} from "./extractNormalize";
import {
  mergeStatusWidgetExtractUsages,
  type StatusWidgetExtractBillingMeta,
} from "./receiptUsage";
import { mergeExtractedFacts, sanitizeExtractedFacts } from "./extractedFacts";
import {
  logStatusWidgetLiveTrace,
  type StatusWidgetExtractStage,
  type StatusWidgetReasonCode,
} from "./diagnostics";
import { statusWidgetSourceValuesHaveContent } from "./displayPolicy";
import type {
  ExtractedStatusFact,
  ParsedStatusWidgetTurnValues,
  ResolvedStatusWidgetTurn,
  StatusWidget,
  StatusWidgetValues,
} from "./types";

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
  /**
   * API calls attributable to this source alone (repair-only after shared combined).
   * Shared combined initial is NOT counted here — see turn actualCallCount.
   */
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
  echoDroppedKeys: string[];
  repairMaxTokens: number | null;
  /** Filled by shared dual combined initial (billing counts that call once at turn level). */
  sharedCombinedInitial?: boolean;
};

export type StatusWidgetTurnExtractMeta = {
  character: StatusWidgetSourceExtractMeta | null;
  user: StatusWidgetSourceExtractMeta | null;
  /** Actual caller invocations this turn (1–3 on dual combined path; 1–4 on legacy sequential). */
  totalCallCount: number;
  actualCallCount: number;
  extractMode: "single" | "dual_combined";
  /** Actual background extract model (BACKGROUND_OPENROUTER_MODEL / primaryModelId). */
  billingModelId: string;
  /** Present when at least one extract API call was made (same lifetime as usage when tokens exist). */
  billing: StatusWidgetExtractBillingMeta | null;
  usedRepair: boolean;
  exhausted: boolean;
  mergedInputTokens: number;
  mergedOutputTokens: number;
};

const defaultExtractCaller: StatusWidgetExtractCaller = async (system, history, opts) =>
  callBackgroundMemory(system, history, undefined, opts.requestKind, {
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
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
  echoDroppedKeys: string[];
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

function shouldEmitExtractAttemptLog(opts: {
  stage: StatusWidgetExtractStage;
  succeeded: boolean;
  reasonCode: StatusWidgetReasonCode;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = opts.env ?? process.env;
  const verbose =
    env.STATUS_WIDGET_TRACE_ENABLED === "1" || env.STATUS_WIDGET_EXTRACT_METRICS === "1";
  if (opts.stage === "repair") return true;
  if (opts.reasonCode === "STATUS_WIDGET_EXTRACT_EXHAUSTED") return true;
  if (opts.stage === "initial" && !opts.succeeded) return true;
  if (opts.stage === "initial" && opts.succeeded) return verbose;
  return verbose;
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
  echoDroppedKeys?: string[];
  env?: NodeJS.ProcessEnv;
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

  if (
    !shouldEmitExtractAttemptLog({
      stage: event.stage,
      succeeded: event.succeeded,
      reasonCode: event.reasonCode,
      env: event.env,
    })
  ) {
    return;
  }

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
      echoDroppedKeys: event.echoDroppedKeys ?? [],
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
  applyEchoFilter: boolean;
  caller: StatusWidgetExtractCaller;
  trace?: { requestId?: string | null; chatId?: number | null; messageId?: number | null };
  env?: NodeJS.ProcessEnv;
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
        reasonCode: opts.stage === "initial" ? "V3_INITIAL_EMPTY" : "V3_REPAIR_FAILED",
        textLength,
        jsonFound: false,
        normalizedKeys: [],
        modelId: opts.modelId,
        stage: opts.stage,
        attemptIndex: opts.attemptIndex,
        latencyMs,
        echoDroppedKeys: [],
      };
      logExtractAttempt({
        ...outcome,
        trace: opts.trace,
        source: opts.source,
        succeeded: false,
        env: opts.env,
      });
      return outcome;
    }

    const parsed = extractJsonObjectFromWidgetText(text);
    if (!parsed) {
      const outcome: AttemptOutcome = {
        ok: false,
        values: null,
        facts: [],
        usage,
        reasonCode: opts.stage === "initial" ? "V3_PARSE_FAILED" : "V3_REPAIR_FAILED",
        textLength,
        jsonFound: false,
        normalizedKeys: [],
        modelId: opts.modelId,
        stage: opts.stage,
        attemptIndex: opts.attemptIndex,
        latencyMs,
        echoDroppedKeys: [],
      };
      logExtractAttempt({
        ...outcome,
        trace: opts.trace,
        source: opts.source,
        succeeded: false,
        env: opts.env,
      });
      return outcome;
    }

    let normalized = normalizeWidgetExtraction(parsed, opts.widget);
    let echoDroppedKeys: string[] = [];
    if (opts.applyEchoFilter) {
      const filtered = dropRepairEchoFields(normalized, opts.widget);
      normalized = filtered.values;
      echoDroppedKeys = filtered.droppedKeys;
    }
    const normalizedKeys = usableNormalizedKeys(normalized);
    const ok = normalizedKeys.length > 0;
    const values = ok ? normalized : null;
    const reasonCode: StatusWidgetReasonCode = ok
      ? opts.stage === "initial"
        ? "OK"
        : "V3_REPAIR_USED"
      : opts.stage === "initial"
        ? "V3_INITIAL_EMPTY"
        : "V3_REPAIR_FAILED";

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
      echoDroppedKeys,
    };
    logExtractAttempt({
      ...outcome,
      trace: opts.trace,
      source: opts.source,
      succeeded: ok,
      env: opts.env,
    });
    return outcome;
  } catch (e) {
    const latencyMs = Date.now() - started;
    console.error("[STATUS-WIDGET-ERROR] extract call failed", (e as Error).message);
    const reasonCode: StatusWidgetReasonCode =
      opts.stage === "initial" ? "V3_INITIAL_EMPTY" : "V3_REPAIR_FAILED";
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
      echoDroppedKeys: [],
    };
    logExtractAttempt({
      ...outcome,
      trace: opts.trace,
      source: opts.source,
      succeeded: false,
      env: opts.env,
    });
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
  env?: NodeJS.ProcessEnv;
  /** Skip initial; run existing same-model repair once (after dual combined miss). */
  repairOnly?: boolean;
  sharedCombinedInitial?: boolean;
}): Promise<{
  values: StatusWidgetValues | null;
  facts: ExtractedStatusFact[];
  usage: TokenUsage | null;
  meta: StatusWidgetSourceExtractMeta;
  /** Actual caller invocations performed in this function. */
  apiCalls: number;
}> {
  const keys = collectWidgetJsonKeys(opts.widget);
  if (keys.length === 0) {
    return {
      values: null,
      facts: [],
      usage: null,
      apiCalls: 0,
      meta: {
        source: opts.source,
        callCount: 0,
        stages: [],
        finalStage: null,
        finalReasonCode: "STATUS_WIDGET_NOT_CONFIGURED",
        models: [],
        attemptUsages: [],
        echoDroppedKeys: [],
        repairMaxTokens: null,
        sharedCombinedInitial: opts.sharedCombinedInitial,
      },
    };
  }

  const caller = opts.caller ?? defaultExtractCaller;
  const primaryModelId = opts.primaryModelId?.trim() || BACKGROUND_OPENROUTER_MODEL;
  const usages: TokenUsage[] = [];
  const stages: StatusWidgetExtractStage[] = [];
  const models: string[] = [];
  const attemptUsages: StatusWidgetSourceExtractMeta["attemptUsages"] = [];
  let echoDroppedKeys: string[] = [];
  const repairMaxTokens = resolveRepairMaxTokens(opts.widget, keys);
  let apiCalls = 0;

  if (!opts.repairOnly) {
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
      applyEchoFilter: false,
      caller,
      trace: opts.trace,
      env: opts.env,
    });
    apiCalls += 1;
    stages.push("initial");
    models.push(primaryModelId);
    pushUsage(usages, attemptUsages, initial);
    if (initial.ok) {
      return {
        values: initial.values,
        facts: initial.facts,
        usage: mergeStatusWidgetExtractUsages(usages),
        apiCalls,
        meta: {
          source: opts.source,
          callCount: 1,
          stages,
          finalStage: "initial",
          finalReasonCode: "OK",
          models,
          attemptUsages,
          echoDroppedKeys: [],
          repairMaxTokens,
        },
      };
    }
  } else {
    stages.push("initial");
    models.push(primaryModelId);
  }

  const repairSystem = buildWidgetExtractRepairSystem(keys, opts.source);
  const repairUser = buildWidgetExtractRepairUserBlock({
    keys,
    assistantProse: opts.assistantProse,
    previousValues: opts.previousValues,
    widget: opts.widget,
    source: opts.source,
    charName: opts.charName,
    personaName: opts.personaName,
    userMessage: opts.userMessage,
  });
  const repair = await runExtractAttempt({
    system: repairSystem,
    userBlock: repairUser,
    widget: opts.widget,
    source: opts.source,
    stage: "repair",
    attemptIndex: opts.repairOnly ? 2 : 2,
    modelId: primaryModelId,
    requestKind: "background-status-widget-extract-repair",
    maxTokens: repairMaxTokens,
    temperature: 0,
    applyEchoFilter: true,
    caller,
    trace: opts.trace,
    env: opts.env,
  });
  apiCalls += 1;
  stages.push("repair");
  models.push(primaryModelId);
  pushUsage(usages, attemptUsages, repair);
  echoDroppedKeys = repair.echoDroppedKeys;
  const sourceCallCount = opts.repairOnly ? 1 : 2;
  if (repair.ok) {
    return {
      values: repair.values,
      facts: repair.facts,
      usage: mergeStatusWidgetExtractUsages(usages),
      apiCalls,
      meta: {
        source: opts.source,
        callCount: sourceCallCount,
        stages,
        finalStage: "repair",
        finalReasonCode: "V3_REPAIR_USED",
        models,
        attemptUsages,
        echoDroppedKeys,
        repairMaxTokens,
        sharedCombinedInitial: opts.sharedCombinedInitial,
      },
    };
  }

  return {
    values: null,
    facts: [],
    usage: mergeStatusWidgetExtractUsages(usages),
    apiCalls,
    meta: {
      source: opts.source,
      callCount: sourceCallCount,
      stages,
      finalStage: "repair",
      finalReasonCode: "STATUS_WIDGET_EXTRACT_EXHAUSTED",
      models,
      attemptUsages,
      echoDroppedKeys,
      repairMaxTokens,
      sharedCombinedInitial: opts.sharedCombinedInitial,
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
  env?: NodeJS.ProcessEnv;
  /**
   * Main-parse seed. Sources that already have usable values are never re-extracted.
   * Missing sources are extracted (combined when both missing).
   */
  seedValues?: ParsedStatusWidgetTurnValues | null;
}): Promise<{
  values: ParsedStatusWidgetTurnValues;
  usage: TokenUsage | null;
  meta: StatusWidgetTurnExtractMeta;
}> {
  const out: ParsedStatusWidgetTurnValues = {};
  const turnUsages: TokenUsage[] = [];
  const factBatches: ExtractedStatusFact[][] = [];
  let characterMeta: StatusWidgetSourceExtractMeta | null = null;
  let userMeta: StatusWidgetSourceExtractMeta | null = null;
  let actualCallCount = 0;
  let extractMode: "single" | "dual_combined" = "single";
  const primaryModelId = opts.primaryModelId?.trim() || BACKGROUND_OPENROUTER_MODEL;

  const emptyMeta = (): StatusWidgetTurnExtractMeta => ({
    character: null,
    user: null,
    totalCallCount: 0,
    actualCallCount: 0,
    extractMode: "single",
    billingModelId: primaryModelId,
    billing: null,
    usedRepair: false,
    exhausted: false,
    mergedInputTokens: 0,
    mergedOutputTokens: 0,
  });

  // Route gates HTML/OOC/interrupted; active=false must not call extract either.
  if (!opts.resolved.active) {
    return { values: out, usage: null, meta: emptyMeta() };
  }

  const charWidget = opts.resolved.characterWidget;
  const userWidget = opts.resolved.userWidget;
  const seedCharOk =
    opts.resolved.needsCharacterValues &&
    statusWidgetSourceValuesHaveContent(opts.seedValues?.character);
  const seedUserOk =
    opts.resolved.needsUserValues && statusWidgetSourceValuesHaveContent(opts.seedValues?.user);

  if (seedCharOk) out.character = opts.seedValues!.character!;
  if (seedUserOk) out.user = opts.seedValues!.user!;
  if (opts.seedValues?.extracted_facts?.length) {
    factBatches.push(opts.seedValues.extracted_facts);
  }

  const needCharExtract =
    opts.resolved.needsCharacterValues && Boolean(charWidget) && !seedCharOk;
  const needUserExtract = opts.resolved.needsUserValues && Boolean(userWidget) && !seedUserOk;

  const caller = opts.caller ?? defaultExtractCaller;

  if (needCharExtract && needUserExtract && charWidget && userWidget) {
    extractMode = "dual_combined";
    const started = Date.now();
    const system = buildCombinedDualWidgetExtractSystem(charWidget, userWidget);
    const userBlock = buildCombinedDualWidgetExtractUserBlock({
      charName: opts.charName,
      characterIdentity: opts.characterIdentity,
      personaName: opts.personaName,
      userMessage: opts.userMessage,
      assistantProse: opts.assistantProse,
      previousAssistantProse: opts.previousAssistantProse,
      characterWidget: charWidget,
      userWidget,
      previousCharacterValues: opts.previousValues?.character ?? null,
      previousUserValues: opts.previousValues?.user ?? null,
    });

    let combinedText = "";
    let combinedUsage: TokenUsage | null = null;
    try {
      const res = await caller(system, [{ role: "user", content: userBlock }], {
        requestKind: "background-status-widget-extract-combined",
        modelId: primaryModelId,
      });
      combinedText = res.text ?? "";
      combinedUsage = res.usage ?? null;
    } catch (e) {
      console.error("[STATUS-WIDGET-ERROR] combined extract call failed", (e as Error).message);
    }
    actualCallCount += 1;
    if (combinedUsage) turnUsages.push(combinedUsage);

    const parsed = parseCombinedDualWidgetExtractResponse(combinedText, {
      characterWidget: charWidget,
      userWidget,
      applyEchoFilter: true,
    });
    const latencyMs = Date.now() - started;

    logStatusWidgetLiveTrace({
      ...opts.trace,
      phase: "v3_extract_result",
      extractStage: "initial",
      extractAttemptIndex: 1,
      extractModelId: primaryModelId,
      v3ExtractCalled: true,
      v3ExtractSucceeded: parsed.characterOk || parsed.userOk,
      v3ExtractReturnedTextLength: combinedText.length,
      v3ExtractJsonFound: parsed.jsonParseOk,
      normalizedKeys: [
        ...usableNormalizedKeys(parsed.character),
        ...usableNormalizedKeys(parsed.user),
      ],
      hasUsableValues: parsed.characterOk || parsed.userOk,
      inputTokens: combinedUsage?.inputTokens,
      outputTokens: combinedUsage?.outputTokens,
      latencyMs,
      reasonCode: parsed.characterOk && parsed.userOk ? "OK" : "V3_INITIAL_EMPTY",
    });
    console.info(
      "[StatusWidgetExtractAttempt]",
      JSON.stringify({
        mode: "dual_combined",
        requestedSources: ["character", "user"],
        successfulSources: [
          ...(parsed.characterOk ? (["character"] as const) : []),
          ...(parsed.userOk ? (["user"] as const) : []),
        ],
        failedSources: [
          ...(!parsed.characterOk ? (["character"] as const) : []),
          ...(!parsed.userOk ? (["user"] as const) : []),
        ],
        attemptIndex: 1,
        actualCallCount: 1,
        modelId: primaryModelId,
        inputTokens: combinedUsage?.inputTokens ?? null,
        outputTokens: combinedUsage?.outputTokens ?? null,
        latencyMs,
        reasonCode: parsed.characterOk && parsed.userOk ? "OK" : "V3_INITIAL_EMPTY",
        requestId: opts.trace?.requestId ?? null,
        chatId: opts.trace?.chatId ?? null,
        messageId: opts.trace?.messageId ?? null,
      })
    );

    if (parsed.extracted_facts.length > 0) {
      factBatches.push(parsed.extracted_facts);
    }

    if (parsed.characterOk) {
      out.character = parsed.character;
      characterMeta = {
        source: "character",
        // Shared combined initial is billed once at turn level — do not mirror tokens here.
        callCount: 0,
        stages: ["initial"],
        finalStage: "initial",
        finalReasonCode: "OK",
        models: [primaryModelId],
        attemptUsages: [],
        echoDroppedKeys: parsed.characterEchoDroppedKeys,
        repairMaxTokens: resolveRepairMaxTokens(charWidget, collectWidgetJsonKeys(charWidget)),
        sharedCombinedInitial: true,
      };
    } else {
      const repaired = await extractStatusWidgetValuesForWidget({
        charName: opts.charName,
        characterIdentity: opts.characterIdentity,
        personaName: opts.personaName,
        userPersona: opts.userPersona,
        userMessage: opts.userMessage,
        assistantProse: opts.assistantProse,
        widget: charWidget,
        source: "character",
        previousValues: opts.previousValues?.character ?? null,
        previousAssistantProse: opts.previousAssistantProse,
        userNote: opts.userNote,
        trace: opts.trace,
        caller,
        primaryModelId,
        env: opts.env,
        repairOnly: true,
        sharedCombinedInitial: true,
      });
      actualCallCount += repaired.apiCalls;
      out.character = repaired.values;
      if (repaired.facts.length > 0) factBatches.push(repaired.facts);
      if (repaired.usage) turnUsages.push(repaired.usage);
      characterMeta = repaired.meta;
    }

    if (parsed.userOk) {
      out.user = parsed.user;
      userMeta = {
        source: "user",
        // Shared combined initial is billed once at turn level — do not mirror tokens here.
        callCount: 0,
        stages: ["initial"],
        finalStage: "initial",
        finalReasonCode: "OK",
        models: [primaryModelId],
        attemptUsages: [],
        echoDroppedKeys: parsed.userEchoDroppedKeys,
        repairMaxTokens: resolveRepairMaxTokens(userWidget, collectWidgetJsonKeys(userWidget)),
        sharedCombinedInitial: true,
      };
    } else {
      const repaired = await extractStatusWidgetValuesForWidget({
        charName: opts.charName,
        characterIdentity: opts.characterIdentity,
        personaName: opts.personaName,
        userPersona: opts.userPersona,
        userMessage: opts.userMessage,
        assistantProse: opts.assistantProse,
        widget: userWidget,
        source: "user",
        previousValues: opts.previousValues?.user ?? null,
        previousAssistantProse: opts.previousAssistantProse,
        userNote: opts.userNote,
        trace: opts.trace,
        caller,
        primaryModelId,
        env: opts.env,
        repairOnly: true,
        sharedCombinedInitial: true,
      });
      actualCallCount += repaired.apiCalls;
      out.user = repaired.values;
      if (repaired.facts.length > 0) factBatches.push(repaired.facts);
      if (repaired.usage) turnUsages.push(repaired.usage);
      userMeta = repaired.meta;
    }
  } else {
    if (needCharExtract && charWidget) {
      const character = await extractStatusWidgetValuesForWidget({
        charName: opts.charName,
        characterIdentity: opts.characterIdentity,
        personaName: opts.personaName,
        userPersona: opts.userPersona,
        userMessage: opts.userMessage,
        assistantProse: opts.assistantProse,
        widget: charWidget,
        source: "character",
        previousValues: opts.previousValues?.character ?? null,
        previousAssistantProse: opts.previousAssistantProse,
        userNote: opts.userNote,
        trace: opts.trace,
        caller,
        primaryModelId,
        env: opts.env,
      });
      actualCallCount += character.apiCalls;
      out.character = character.values;
      if (character.facts.length > 0) factBatches.push(character.facts);
      if (character.usage) turnUsages.push(character.usage);
      characterMeta = character.meta;
    }

    if (needUserExtract && userWidget) {
      const user = await extractStatusWidgetValuesForWidget({
        charName: opts.charName,
        characterIdentity: opts.characterIdentity,
        personaName: opts.personaName,
        userPersona: opts.userPersona,
        userMessage: opts.userMessage,
        assistantProse: opts.assistantProse,
        widget: userWidget,
        source: "user",
        previousValues: opts.previousValues?.user ?? null,
        previousAssistantProse: opts.previousAssistantProse,
        userNote: opts.userNote,
        trace: opts.trace,
        caller,
        primaryModelId,
        env: opts.env,
      });
      actualCallCount += user.apiCalls;
      out.user = user.values;
      if (user.facts.length > 0) factBatches.push(user.facts);
      if (user.usage) turnUsages.push(user.usage);
      userMeta = user.meta;
    }
  }

  let mergedFacts: ExtractedStatusFact[] | undefined;
  for (const batch of factBatches) {
    mergedFacts = mergeExtractedFacts(mergedFacts, batch);
  }
  if (mergedFacts?.length) out.extracted_facts = mergedFacts;

  const usedRepair =
    characterMeta?.stages.includes("repair") === true ||
    userMeta?.stages.includes("repair") === true;
  const exhausted =
    characterMeta?.finalReasonCode === "STATUS_WIDGET_EXTRACT_EXHAUSTED" ||
    userMeta?.finalReasonCode === "STATUS_WIDGET_EXTRACT_EXHAUSTED";
  const mergedUsage = mergeStatusWidgetExtractUsages(turnUsages);
  const billingModelId = primaryModelId;
  const billing: StatusWidgetExtractBillingMeta | null =
    actualCallCount > 0 ? { modelId: billingModelId, callCount: actualCallCount } : null;

  return {
    values: out,
    usage: mergedUsage,
    meta: {
      character: characterMeta,
      user: userMeta,
      totalCallCount: actualCallCount,
      actualCallCount,
      extractMode,
      billingModelId,
      billing,
      usedRepair,
      exhausted,
      mergedInputTokens: mergedUsage?.inputTokens ?? 0,
      mergedOutputTokens: mergedUsage?.outputTokens ?? 0,
    },
  };
}
