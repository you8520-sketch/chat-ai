import { createHash } from "node:crypto";

import { estimateTokens } from "@/lib/tokenEstimate";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { flattenOpenRouterMessageContent } from "@/lib/openRouterClient";
import { CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL } from "@/lib/chatModels";
import { buildSceneDirective } from "@/lib/sceneDirective";
import { capabilitiesFromUserAuthoringLevel, DEFAULT_USER_AUTHORING_LEVEL } from "@/lib/userAuthoringPolicy";
import { COLLABORATIVE_INTERACTIVE_OWNER_TITLE } from "@/lib/noGodmodding";
import { parseReasoningTokens } from "@/lib/openRouterUsage";
import { isValidReportedTokenValue } from "@/lib/usageReportingEvidence";
import { buildContext } from "@/services/contextBuilder";
import type { ContextBuildInput } from "@/types";
import {
  BENCHMARK_CHAR_NAME,
  BENCHMARK_CHAT_ID,
  BENCHMARK_DEFAULT_TARGET_CHARS,
  BENCHMARK_USER_PERSONA,
  buildBenchmarkContextBase,
  getBenchmarkFixtureById,
} from "@/lib/scenePolicyBenchmarkDataset";
import { executeCompatibleSupplyProbe, type ProbeJson } from "./compatibleSupplyProbe";

export const OPENSCALE_BASE_URL = "https://api.openscale.so/v1";
export const OPENSCALE_MODELS_URL = `${OPENSCALE_BASE_URL}/models`;
export const OPENSCALE_CHAT_ENDPOINT = `${OPENSCALE_BASE_URL}/chat/completions`;
export const OPENSCALE_OFFICIAL_MODEL_ID = "deepseek/deepseek-v4.1-flash";
export const OPENSCALE_KEY_ENV = "OPENSCALE_KEY";
export const OPENSCALE_RP_PILOT_OPT_IN = "OPENSCALE_RP_PILOT";
export const OPENSCALE_PILOT_FIXTURE_ID = "B03a";
export const OPENSCALE_PILOT_SCREENING_BUDGET_USD = 0.02;

/** Catalog-observed OpenScale DeepSeek V4.1 Flash rates. Screening estimate only. */
export const OPENSCALE_CATALOG_RATES = Object.freeze({
  inputUsdPerMillion: 0.06,
  cachedInputUsdPerMillion: 0.003,
  outputUsdPerMillion: 0.24,
  source: "GET /v1/models input_modalities.pricing + output_modalities.pricing",
});

export type OpenScalePilotStatus =
  | "PREVALIDATION_ONLY"
  | "PREVALIDATION_FAILED"
  | "LIVE_COMPLETED"
  | "LIVE_FAILED"
  | "BLOCKED_CREDENTIAL"
  | "BLOCKED_OPT_IN";

type JsonObject = Record<string, unknown>;

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function redactSecretText(text: string, secrets: string[]): string {
  let next = text;
  for (const secret of secrets) {
    if (secret) next = next.split(secret).join("[REDACTED]");
  }
  return next.replace(/Bearer\s+[^\s"\\]+/gi, "Bearer [REDACTED]");
}

export function resolveOpenScalePilotKey(env: NodeJS.ProcessEnv = process.env): {
  ok: true;
  key: string;
} | {
  ok: false;
  status: "BLOCKED_CREDENTIAL";
  reason: "openscale_key_missing";
} {
  const key = env[OPENSCALE_KEY_ENV]?.trim();
  if (!key) {
    return { ok: false, status: "BLOCKED_CREDENTIAL", reason: "openscale_key_missing" };
  }
  return { ok: true, key };
}

export function resolveOpenScaleLiveOptIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[OPENSCALE_RP_PILOT_OPT_IN]?.trim() === "1";
}

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function readUsdPerToken(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function parseOpenScaleFlashCatalog(payload: unknown): {
  modelId: string | null;
  streaming: boolean | null;
  inputUsdPerMillion: number | null;
  cachedInputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  reasoningEffortValues: string[] | null;
  isReady: boolean | null;
  modelIds: string[];
} {
  const root = asRecord(payload);
  const data = Array.isArray(root?.data) ? root.data : [];
  const modelIds = data
    .map((row) => asRecord(row)?.id)
    .filter((id): id is string => typeof id === "string");
  const flash = data
    .map((row) => asRecord(row))
    .find((row) => row?.id === OPENSCALE_OFFICIAL_MODEL_ID);
  if (!flash) {
    return {
      modelId: null,
      streaming: null,
      inputUsdPerMillion: null,
      cachedInputUsdPerMillion: null,
      outputUsdPerMillion: null,
      reasoningEffortValues: null,
      isReady: null,
      modelIds,
    };
  }
  const inputs = Array.isArray(flash.input_modalities) ? flash.input_modalities : [];
  const outputs = Array.isArray(flash.output_modalities) ? flash.output_modalities : [];
  const textIn = inputs.map(asRecord).find((row) => row?.type === "text");
  const textOut = outputs.map(asRecord).find((row) => row?.type === "text");
  const inPricing = Array.isArray(textIn?.pricing) ? textIn.pricing.map(asRecord) : [];
  const outPricing = Array.isArray(textOut?.pricing) ? textOut.pricing.map(asRecord) : [];
  const prompt = inPricing.find((row) => row?.type === "prompt");
  const cached = inPricing.find((row) => row?.type === "cached_prompt");
  const completion = outPricing.find((row) => row?.type === "completion");
  const params = asRecord(textOut?.supported_parameters);
  const effort = asRecord(params?.reasoning_effort);
  const effortValues = Array.isArray(effort?.values)
    ? effort.values.filter((value): value is string => typeof value === "string")
    : null;
  const promptUsd = readUsdPerToken(prompt?.cost_usd);
  const cachedUsd = readUsdPerToken(cached?.cost_usd);
  const completionUsd = readUsdPerToken(completion?.cost_usd);
  return {
    modelId: typeof flash.id === "string" ? flash.id : null,
    streaming: textOut?.streaming === true,
    inputUsdPerMillion: promptUsd == null ? null : promptUsd * 1_000_000,
    cachedInputUsdPerMillion: cachedUsd == null ? null : cachedUsd * 1_000_000,
    outputUsdPerMillion: completionUsd == null ? null : completionUsd * 1_000_000,
    reasoningEffortValues: effortValues,
    isReady: flash.is_ready === true,
    modelIds,
  };
}

export function estimateOpenScaleUsd(input: {
  promptTokens: number;
  cachedTokens?: number;
  outputTokens: number;
  rates?: {
    inputUsdPerMillion: number;
    cachedInputUsdPerMillion: number;
    outputUsdPerMillion: number;
  };
}): number {
  const rates = input.rates ?? OPENSCALE_CATALOG_RATES;
  const cached = Math.max(0, Math.min(input.cachedTokens ?? 0, input.promptTokens));
  const standard = Math.max(0, input.promptTokens - cached);
  return (
    (standard * rates.inputUsdPerMillion +
      cached * rates.cachedInputUsdPerMillion +
      input.outputTokens * rates.outputUsdPerMillion) /
    1_000_000
  );
}

export function currentUserAuthoringForEval() {
  const level = DEFAULT_USER_AUTHORING_LEVEL;
  return {
    level,
    capabilities: capabilitiesFromUserAuthoringLevel(level),
    ownerTitle: COLLABORATIVE_INTERACTIVE_OWNER_TITLE,
    notes: [
      "하브 기본 interactive 권한은 NORMAL이다.",
      "대사와 중요한 외적 행동은 허용한다.",
      "유저 내면 POV와 비가역 운명은 허용하지 않는다.",
      "평가 시 출력의 유저 대사·행동 서술이 이 권한과 맞는지 확인한다.",
    ],
  };
}

export function buildOpenScalePilotAssembly() {
  const fixture = getBenchmarkFixtureById(OPENSCALE_PILOT_FIXTURE_ID);
  if (!fixture) throw new Error("missing_synthetic_fixture");
  const modelId = CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL;
  const contextBase = buildBenchmarkContextBase();
  const contextInput: ContextBuildInput = {
    ...contextBase,
    modelId,
    provider: "cheaperinference",
    targetResponseChars: BENCHMARK_DEFAULT_TARGET_CHARS,
    shortTermHistory: fixture.history,
    currentUserMessage: fixture.currentUserMessage,
    longTermMemory: fixture.memoryText ?? contextBase.longTermMemory,
    keywordLorebookBlock: fixture.lorebookText ?? "",
    triggeredScenarioEventsBlock: fixture.triggeredEventText ?? "",
  };
  const built = buildContext(contextInput);
  const currentTurn = fixture.currentTurn ?? fixture.history.length + 1;
  const canonicalSceneDirective = buildSceneDirective({
    mode: "interactive",
    recentMessages: fixture.history,
    currentUserMessage: fixture.currentUserMessage,
    memoryText: fixture.memoryText ?? "",
    relationshipMemoryText: fixture.relationshipMemoryText ?? "",
    lorebookText: fixture.lorebookText ?? "",
    triggeredEventText: fixture.triggeredEventText ?? "",
    currentTurn,
    primaryCharacterName: BENCHMARK_CHAR_NAME,
    chatId: BENCHMARK_CHAT_ID,
    progressionHistory: [],
  });
  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history,
    modelId,
    targetResponseChars: BENCHMARK_DEFAULT_TARGET_CHARS,
    stream: true,
    messageOpts: {
      transportProvider: "cheaperinference",
      charName: BENCHMARK_CHAR_NAME,
      personaName: BENCHMARK_USER_PERSONA,
      sceneServerControls: {
        mode: "interactive",
        contentKind: "character",
        primaryCharacterName: BENCHMARK_CHAR_NAME,
        currentUserMessage: fixture.currentUserMessage,
        recentMessages: fixture.history,
        memoryText: fixture.memoryText ?? "",
        relationshipMemoryText: fixture.relationshipMemoryText ?? "",
        lorebookText: fixture.lorebookText ?? "",
        triggeredEventText: fixture.triggeredEventText ?? "",
        canonicalSceneDirective,
        skipMotionCue: false,
        currentTurn,
        chatId: BENCHMARK_CHAT_ID,
      },
    },
  });
  const candidateBody = adaptOpenScalePilotBody(assembled.requestBody);
  const promptText = JSON.stringify(candidateBody.messages);
  return {
    fixtureId: fixture.id,
    fixtureLabel: fixture.label,
    characterName: BENCHMARK_CHAR_NAME,
    personaName: BENCHMARK_USER_PERSONA,
    currentUserMessage: fixture.currentUserMessage,
    history: fixture.history,
    productionLogicalModelId: modelId,
    productionRequestBody: assembled.requestBody,
    candidateBody,
    systemPrompt: built.systemPrompt,
    systemPromptSha256: sha256Text(built.systemPrompt),
    promptSha256: sha256Text(promptText),
    estimatedPromptTokens: estimateTokens(promptText),
    userAuthoring: currentUserAuthoringForEval(),
  };
}

export function adaptOpenScalePilotBody(productionBody: JsonObject): JsonObject {
  const messages = Array.isArray(productionBody.messages)
    ? productionBody.messages.map((message) => {
        const row = asRecord(message) ?? {};
        const role = row.role;
        const content = flattenOpenRouterMessageContent(
          (row.content as string | { type: "text"; text: string }[]) ?? ""
        );
        return { role, content };
      })
    : [];
  const body: JsonObject = {
    model: OPENSCALE_OFFICIAL_MODEL_ID,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (typeof productionBody.temperature === "number") {
    body.temperature = productionBody.temperature;
  }
  if (typeof productionBody.top_p === "number") {
    body.top_p = productionBody.top_p;
  }
  // Catalog documents reasoning_effort including "none". CI thinking object is not listed.
  body.reasoning_effort = "none";
  return body;
}

export function screeningEstimateFromAssembly(estimatedPromptTokens: number): {
  conservativeOutputTokens: number;
  estimatedUsd: number;
  underScreeningBudget: boolean;
  note: string;
} {
  const conservativeOutputTokens = 8_000;
  const estimatedUsd = estimateOpenScaleUsd({
    promptTokens: estimatedPromptTokens,
    outputTokens: conservativeOutputTokens,
  });
  return {
    conservativeOutputTokens,
    estimatedUsd,
    underScreeningBudget: estimatedUsd <= OPENSCALE_PILOT_SCREENING_BUDGET_USD,
    note: "Screening estimate only. Not an invoice cap or actual billed amount.",
  };
}

function usageNumber(value: unknown): number | null {
  return isValidReportedTokenValue(value) ? Number(value) : null;
}

export function extractOpenScaleUsage(usage: ProbeJson | null): {
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  providerReportedCostUsd: number | null;
  raw: ProbeJson | null;
} {
  if (!usage) {
    return {
      promptTokens: null,
      completionTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
      providerReportedCostUsd: null,
      raw: null,
    };
  }
  const details = asRecord(usage.prompt_tokens_details);
  const cached = usageNumber(
    details?.cached_tokens ??
      details?.cache_read_tokens ??
      usage.cached_tokens ??
      usage.cache_read_tokens
  );
  const cost = usageNumber(usage.cost) ?? (typeof usage.cost === "number" && Number.isFinite(usage.cost) ? usage.cost : null);
  return {
    promptTokens: usageNumber(usage.prompt_tokens ?? usage.input_tokens),
    completionTokens: usageNumber(usage.completion_tokens ?? usage.output_tokens),
    cachedTokens: cached,
    reasoningTokens: parseReasoningTokens(usage) || null,
    providerReportedCostUsd:
      typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null,
    raw: usage,
  };
}

export function extractReasoningEvidence(envelope: ProbeJson | undefined, usage: ProbeJson | null): JsonObject {
  const choice = Array.isArray(envelope?.choices) ? asRecord(envelope.choices[0]) : null;
  const delta = asRecord(choice?.delta);
  const message = asRecord(choice?.message);
  return {
    usageReasoningTokens: parseReasoningTokens(usage),
    usageCompletionDetails: asRecord(usage?.completion_tokens_details) ?? null,
    deltaReasoning: delta?.reasoning ?? null,
    deltaReasoningContent: delta?.reasoning_content ?? null,
    messageReasoning: message?.reasoning ?? null,
    messageReasoningContent: message?.reasoning_content ?? null,
    envelopeReasoning: envelope?.reasoning ?? null,
  };
}

export async function runOpenScaleModelsPrevalidation(input?: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{
  status: "PREVALIDATION_ONLY" | "PREVALIDATION_FAILED" | "BLOCKED_CREDENTIAL";
  httpStatus: number | null;
  catalog: ReturnType<typeof parseOpenScaleFlashCatalog> | null;
  stopReason: string | null;
  providerInferencePosts: 0;
}> {
  const credentials = resolveOpenScalePilotKey(input?.env);
  if (!credentials.ok) {
    return {
      status: "BLOCKED_CREDENTIAL",
      httpStatus: null,
      catalog: null,
      stopReason: credentials.reason,
      providerInferencePosts: 0,
    };
  }
  const response = await (input?.fetchImpl ?? fetch)(OPENSCALE_MODELS_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${credentials.key}`,
      Accept: "application/json",
    },
  });
  const httpStatus = response.status;
  if (httpStatus === 401 || httpStatus === 402 || httpStatus === 403) {
    return {
      status: "PREVALIDATION_FAILED",
      httpStatus,
      catalog: null,
      stopReason: `auth_or_billing_${httpStatus}`,
      providerInferencePosts: 0,
    };
  }
  if (!response.ok) {
    return {
      status: "PREVALIDATION_FAILED",
      httpStatus,
      catalog: null,
      stopReason: `models_http_${httpStatus}`,
      providerInferencePosts: 0,
    };
  }
  const payload = await response.json();
  const catalog = parseOpenScaleFlashCatalog(payload);
  if (catalog.modelId !== OPENSCALE_OFFICIAL_MODEL_ID) {
    return {
      status: "PREVALIDATION_FAILED",
      httpStatus,
      catalog,
      stopReason: "model_id_mismatch",
      providerInferencePosts: 0,
    };
  }
  if (
    catalog.inputUsdPerMillion == null ||
    catalog.outputUsdPerMillion == null ||
    catalog.cachedInputUsdPerMillion == null
  ) {
    return {
      status: "PREVALIDATION_FAILED",
      httpStatus,
      catalog,
      stopReason: "price_unconfirmed",
      providerInferencePosts: 0,
    };
  }
  return {
    status: "PREVALIDATION_ONLY",
    httpStatus,
    catalog,
    stopReason: null,
    providerInferencePosts: 0,
  };
}

export async function runOpenScaleRpPilot(input?: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  allowLivePost?: boolean;
}): Promise<JsonObject> {
  const env = input?.env ?? process.env;
  const credentials = resolveOpenScalePilotKey(env);
  const assembly = buildOpenScalePilotAssembly();
  const screening = screeningEstimateFromAssembly(assembly.estimatedPromptTokens);
  const productionControls = {
    model: assembly.productionRequestBody.model,
    temperature: assembly.productionRequestBody.temperature,
    top_p: assembly.productionRequestBody.top_p,
    max_tokens: assembly.productionRequestBody.max_tokens ?? null,
    thinking: assembly.productionRequestBody.thinking ?? null,
    reasoning_effort: assembly.productionRequestBody.reasoning_effort ?? null,
    stream: assembly.productionRequestBody.stream ?? null,
  };
  const candidateControls = {
    model: assembly.candidateBody.model,
    temperature: assembly.candidateBody.temperature,
    top_p: assembly.candidateBody.top_p,
    max_tokens: assembly.candidateBody.max_tokens ?? null,
    reasoning_effort: assembly.candidateBody.reasoning_effort ?? null,
    stream: assembly.candidateBody.stream ?? null,
  };

  if (!credentials.ok) {
    return {
      status: credentials.status,
      providerInferencePosts: 0,
      stopReason: credentials.reason,
      productionRouteChanges: 0,
      screening,
    };
  }

  const prevalidation = await runOpenScaleModelsPrevalidation({
    env,
    fetchImpl: input?.fetchImpl,
  });
  if (prevalidation.status !== "PREVALIDATION_ONLY") {
    return {
      ...prevalidation,
      productionRouteChanges: 0,
      screening,
      productionControls,
      candidateControls,
    };
  }

  const liveRequested = input?.allowLivePost === true || resolveOpenScaleLiveOptIn(env);
  if (!liveRequested) {
    return {
      status: "BLOCKED_OPT_IN",
      providerInferencePosts: 0,
      stopReason: "openscale_rp_pilot_opt_in_missing",
      catalog: prevalidation.catalog,
      productionRouteChanges: 0,
      screening,
      productionControls,
      candidateControls,
      fixtureId: assembly.fixtureId,
      estimatedPromptTokens: assembly.estimatedPromptTokens,
    };
  }

  if (!screening.underScreeningBudget) {
    return {
      status: "PREVALIDATION_FAILED",
      providerInferencePosts: 0,
      stopReason: "screening_estimate_above_budget",
      catalog: prevalidation.catalog,
      productionRouteChanges: 0,
      screening,
    };
  }

  const started = Date.now();
  const response = await executeCompatibleSupplyProbe({
    endpoint: OPENSCALE_CHAT_ENDPOINT,
    headers: {
      Authorization: `Bearer ${credentials.key}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: assembly.candidateBody,
    timeoutMs: input?.timeoutMs ?? 180_000,
    strict: true,
    fetchImpl: input?.fetchImpl,
  });
  const usage = extractOpenScaleUsage(response.usage);
  const outputTokens = usage.completionTokens;
  const tokensPerSecond =
    outputTokens != null && response.ttftSeconds != null
      ? outputTokens / Math.max(0.001, response.totalSeconds - response.ttftSeconds)
      : null;
  const estimatedActualUsd =
    usage.promptTokens != null && usage.completionTokens != null
      ? estimateOpenScaleUsd({
          promptTokens: usage.promptTokens,
          cachedTokens: usage.cachedTokens ?? 0,
          outputTokens: usage.completionTokens,
          rates: {
            inputUsdPerMillion: prevalidation.catalog?.inputUsdPerMillion ?? OPENSCALE_CATALOG_RATES.inputUsdPerMillion,
            cachedInputUsdPerMillion:
              prevalidation.catalog?.cachedInputUsdPerMillion ??
              OPENSCALE_CATALOG_RATES.cachedInputUsdPerMillion,
            outputUsdPerMillion:
              prevalidation.catalog?.outputUsdPerMillion ?? OPENSCALE_CATALOG_RATES.outputUsdPerMillion,
          },
        })
      : null;
  const rawOutput = redactSecretText(response.text, [credentials.key]);
  const error = response.error
    ? redactSecretText(response.error, [credentials.key])
    : null;
  const liveFailed =
    Boolean(error) ||
    response.httpStatus !== 200 ||
    !rawOutput.trim();

  return {
    status: liveFailed ? "LIVE_FAILED" : "LIVE_COMPLETED",
    providerInferencePosts: response.requestStarted ? 1 : 0,
    productionRouteChanges: 0,
    stopReason: liveFailed
      ? error ?? (rawOutput.trim() ? `http_${response.httpStatus}` : "empty_output")
      : null,
    catalog: prevalidation.catalog,
    screening,
    fixture: {
      id: assembly.fixtureId,
      label: assembly.fixtureLabel,
      characterName: assembly.characterName,
      personaName: assembly.personaName,
      currentUserMessage: assembly.currentUserMessage,
      history: assembly.history,
      systemPromptSha256: assembly.systemPromptSha256,
      promptSha256: assembly.promptSha256,
      estimatedPromptTokens: assembly.estimatedPromptTokens,
      userAuthoring: assembly.userAuthoring,
    },
    productionControls,
    candidateControls,
    httpStatus: response.httpStatus,
    requestedModelId: OPENSCALE_OFFICIAL_MODEL_ID,
    responseModelId: response.resolvedModel,
    finishReason: response.finishReason,
    sawDone: response.sawDone,
    rawOutput,
    outputChars: response.visibleChars,
    ttftSeconds: response.ttftSeconds,
    totalSeconds: response.totalSeconds,
    tokensPerSecond,
    usage,
    reasoningEvidence: extractReasoningEvidence(response.envelope, response.usage),
    estimatedActualUsd,
    providerReportedCostUsd: usage.providerReportedCostUsd,
    dashboardActualUsd: null,
    dashboardNote: "No public OpenScale balance/usage GET succeeded. Dashboard deduction is NOT_OBSERVED via API.",
    streamAnomalies: {
      empty: !rawOutput.trim(),
      timeout: error === "timeout",
      incomplete: error === "incomplete_stream",
      replacementChars: rawOutput.includes("\uFFFD"),
    },
    elapsedWallMs: Date.now() - started,
  };
}
