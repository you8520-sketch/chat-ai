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
import {
  RP_QUALITY_PRECALL_FIXTURE_IDS,
  RP_QUALITY_PRECALL_TARGET_SELECTOR,
  validateLiveProof,
  type RpQualityPrecallLiveProofInput,
} from "@/lib/rpQualityPrecall";
import { buildContext } from "@/services/contextBuilder";
import type { ContextBuildInput } from "@/types";
import {
  BENCHMARK_CHAR_NAME,
  BENCHMARK_CHARACTER_ID,
  BENCHMARK_CHAT_ID,
  BENCHMARK_DEFAULT_TARGET_CHARS,
  BENCHMARK_USER_PERSONA,
  buildBenchmarkContextBase,
  getBenchmarkFixtureById,
} from "@/lib/scenePolicyBenchmarkDataset";
import type { ProbeJson } from "./compatibleSupplyProbe";

export const OPENSCALE_BASE_URL = "https://api.openscale.so/v1";
export const OPENSCALE_MODELS_URL = `${OPENSCALE_BASE_URL}/models`;
export const OPENSCALE_CHAT_ENDPOINT = `${OPENSCALE_BASE_URL}/chat/completions`;
export const OPENSCALE_OFFICIAL_MODEL_ID = "deepseek/deepseek-v4.1-flash";
export const OPENSCALE_KEY_ENV = "OPENSCALE_KEY";
export const OPENSCALE_RP_PILOT_OPT_IN = "OPENSCALE_RP_PILOT";
/** Wrong first-run fixture. Kept only as a non-comparable diagnostic label. */
export const OPENSCALE_B03A_DIAGNOSTIC_FIXTURE_ID = "B03a";
export const OPENSCALE_PILOT_SCREENING_BUDGET_USD = 0.02;
export const OPENSCALE_APPROVED_STYLE_EVAL_PERSONA_ID = 1;
export const OPENSCALE_APPROVED_STYLE_EVAL_PERSONA_GENDER = "male";
export const OPENSCALE_PHASE2_STYLE_EVAL_PR = 1318;
export const OPENSCALE_CURRENT_PRECALL_PR = 1430;

export const OPENSCALE_PHASE2_STYLE_EVAL_SCENE_IDS = [
  "Q1-quiet",
  "Q2-banter",
  "Q3-tension",
  "Q4-action",
  "Q5-emotional",
  "Q6-short",
  "Q7-auto",
  "Q8-regen",
  "Q9-memory",
] as const;
export type OpenScalePhase2StyleEvalSceneId =
  (typeof OPENSCALE_PHASE2_STYLE_EVAL_SCENE_IDS)[number];

export const OPENSCALE_PHASE2_STYLE_EVAL_TURN_KINDS = Object.freeze({
  "Q1-quiet": "interactive",
  "Q2-banter": "interactive",
  "Q3-tension": "interactive",
  "Q4-action": "interactive",
  "Q5-emotional": "interactive",
  "Q6-short": "interactive",
  "Q7-auto": "auto_progression",
  "Q8-regen": "regenerate",
  "Q9-memory": "memory",
} as const);

export type OpenScaleStyleEvalSceneFamily =
  | "phase2_q1_q9"
  | "rp_quality_precall_abc"
  | "scene_policy_benchmark";

export const OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY = Object.freeze({
  characterId: RP_QUALITY_PRECALL_TARGET_SELECTOR.characterId,
  characterName: RP_QUALITY_PRECALL_TARGET_SELECTOR.characterName,
  characterCardName: "조태형",
  personaId: OPENSCALE_APPROVED_STYLE_EVAL_PERSONA_ID,
  personaName: RP_QUALITY_PRECALL_TARGET_SELECTOR.personaName,
  personaGender: OPENSCALE_APPROVED_STYLE_EVAL_PERSONA_GENDER,
  authoringLevel: DEFAULT_USER_AUTHORING_LEVEL,
  originalSceneFamily: "phase2_q1_q9" as const,
  originalSceneIds: OPENSCALE_PHASE2_STYLE_EVAL_SCENE_IDS,
  originalFixtureJsonInThisTree: false,
  currentMainPrecallFamily: "rp_quality_precall_abc" as const,
  currentMainPrecallFixtureIds: RP_QUALITY_PRECALL_FIXTURE_IDS,
  rejectedFixtureIds: [OPENSCALE_B03A_DIAGNOSTIC_FIXTURE_ID],
  historicalHashesAreNotCurrentProof: true,
});

export const OPENSCALE_B03A_DIAGNOSTIC = Object.freeze({
  comparableToApprovedStyleEval: false,
  fixtureId: OPENSCALE_B03A_DIAGNOSTIC_FIXTURE_ID,
  characterId: BENCHMARK_CHARACTER_ID,
  characterName: BENCHMARK_CHAR_NAME,
  personaName: BENCHMARK_USER_PERSONA,
  outputChars: 945,
  providerInferencePosts: 1,
  executedSourceSha: "f7a72dd596b86a8dab674b71985d119a00da2582",
  evidenceCommit: "cebd58135b120d2d1799a3989835f77d604394f1",
  systemPromptSha256: "59a2216f1b9aaf912bdd0a4dbde2a9d9a6a69a23567845aab0c93ec40b091768",
  promptSha256: "3ec3f303aa31020395603001f2cac4bf3fdf83c46e556ae1d0b5925bbe8430af",
  note: "Wrong-fixture diagnostic. Not a style-eval baseline and not comparable to Q1-Q9 or A/B/C.",
});

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
  | "BLOCKED_OPT_IN"
  | "FIXTURE_PARITY_FAIL"
  | "FIXTURE_PARITY_PASS";

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

export type OpenScaleStyleEvalProposedFixture = {
  characterId?: number;
  characterName?: string;
  personaId?: number;
  personaName?: string;
  sceneId?: string;
  sceneFamily?: OpenScaleStyleEvalSceneFamily | string;
  promptFingerprint?: string;
  expectedPromptFingerprint?: string;
  liveProofInput?: RpQualityPrecallLiveProofInput;
  expectedDeploySha?: string;
  originalFixtureJsonRestored?: boolean;
  currentSettingsRestored?: boolean;
};

export type OpenScaleStyleEvalParityReason =
  | "characterId_mismatch"
  | "characterName_mismatch"
  | "personaId_missing"
  | "personaId_mismatch"
  | "personaName_mismatch"
  | "sceneId_missing"
  | "sceneId_rejected"
  | "sceneId_not_in_phase2_q1_q9"
  | "scene_family_missing"
  | "scene_family_not_approved"
  | "requested_family_is_not_original_style_eval"
  | "b03a_not_comparable"
  | "original_q1_q9_fixture_json_unrestored"
  | "current_settings_unrestored"
  | "live_proof_not_provided"
  | "live_proof_not_verified"
  | "prompt_fingerprint_missing"
  | "prompt_fingerprint_mismatch"
  | "replacement_data_forbidden";

export type OpenScaleStyleEvalParityResult = {
  status: "FIXTURE_PARITY_PASS" | "FIXTURE_PARITY_FAIL";
  reasons: OpenScaleStyleEvalParityReason[];
  liveProofStatus: ReturnType<typeof validateLiveProof>["status"];
  liveProofReasons: readonly string[];
  comparisons: {
    characterId: boolean;
    characterName: boolean;
    personaId: boolean;
    personaName: boolean;
    sceneFamily: boolean;
    sceneId: boolean;
    promptFingerprint: boolean;
    liveProof: boolean;
    originalFixtureJson: boolean;
    currentSettings: boolean;
  };
  required: typeof OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY;
  proposed: OpenScaleStyleEvalProposedFixture;
  diagnosticB03a: typeof OPENSCALE_B03A_DIAGNOSTIC;
};

export function defaultOpenScaleStyleEvalProposedFixture(): OpenScaleStyleEvalProposedFixture {
  return {
    characterId: OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.characterId,
    characterName: OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.characterName,
    personaId: OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.personaId,
    personaName: OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.personaName,
    sceneFamily: OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY.originalSceneFamily,
    originalFixtureJsonRestored: false,
    currentSettingsRestored: false,
  };
}

function isPhase2SceneId(value: string | undefined): value is OpenScalePhase2StyleEvalSceneId {
  return (
    typeof value === "string" &&
    (OPENSCALE_PHASE2_STYLE_EVAL_SCENE_IDS as readonly string[]).includes(value)
  );
}

export function evaluateOpenScaleStyleEvalFixtureParity(
  proposed: OpenScaleStyleEvalProposedFixture = defaultOpenScaleStyleEvalProposedFixture()
): OpenScaleStyleEvalParityResult {
  const required = OPENSCALE_APPROVED_STYLE_EVAL_IDENTITY;
  const reasons: OpenScaleStyleEvalParityReason[] = [];
  const characterIdMatch = proposed.characterId === required.characterId;
  const characterNameMatch = proposed.characterName === required.characterName;
  const personaIdPresent = proposed.personaId != null;
  const personaIdMatch = proposed.personaId === required.personaId;
  const personaNameMatch = proposed.personaName === required.personaName;
  const family = proposed.sceneFamily;
  const sceneId = proposed.sceneId?.trim() ?? "";
  const rejectedScene =
    sceneId === OPENSCALE_B03A_DIAGNOSTIC_FIXTURE_ID ||
    family === "scene_policy_benchmark" ||
    proposed.characterName === BENCHMARK_CHAR_NAME ||
    proposed.personaName === BENCHMARK_USER_PERSONA;

  if (!characterIdMatch) reasons.push("characterId_mismatch");
  if (!characterNameMatch) reasons.push("characterName_mismatch");
  if (!personaIdPresent) reasons.push("personaId_missing");
  else if (!personaIdMatch) reasons.push("personaId_mismatch");
  if (!personaNameMatch) reasons.push("personaName_mismatch");

  if (!family) reasons.push("scene_family_missing");
  else if (family === "scene_policy_benchmark" || rejectedScene) {
    reasons.push("b03a_not_comparable");
    if (sceneId === OPENSCALE_B03A_DIAGNOSTIC_FIXTURE_ID) reasons.push("sceneId_rejected");
  } else if (family === "rp_quality_precall_abc") {
    reasons.push("requested_family_is_not_original_style_eval");
  } else if (family !== "phase2_q1_q9") {
    reasons.push("scene_family_not_approved");
  }

  if (family === "phase2_q1_q9") {
    if (!sceneId) reasons.push("sceneId_missing");
    else if (!isPhase2SceneId(sceneId)) reasons.push("sceneId_not_in_phase2_q1_q9");
    if (proposed.originalFixtureJsonRestored !== true) {
      reasons.push("original_q1_q9_fixture_json_unrestored");
    }
  }

  if (proposed.currentSettingsRestored !== true) {
    reasons.push("current_settings_unrestored");
  }

  const liveProof = validateLiveProof(proposed.liveProofInput, {
    expectedDeploySha: proposed.expectedDeploySha,
  });
  if (liveProof.status === "NOT_PROVIDED") {
    reasons.push("live_proof_not_provided");
    reasons.push("live_proof_not_verified");
  } else if (liveProof.status !== "VERIFIED") {
    reasons.push("live_proof_not_verified");
  }

  const expectedFp = proposed.expectedPromptFingerprint?.trim() ?? "";
  const actualFp = proposed.promptFingerprint?.trim() ?? "";
  if (expectedFp) {
    if (!actualFp) reasons.push("prompt_fingerprint_missing");
    else if (actualFp !== expectedFp) reasons.push("prompt_fingerprint_mismatch");
  }

  if (
    proposed.originalFixtureJsonRestored !== true ||
    proposed.currentSettingsRestored !== true
  ) {
    reasons.push("replacement_data_forbidden");
  }

  const uniqueReasons = [...new Set(reasons)];
  const sceneFamilyMatch = family === required.originalSceneFamily;
  const sceneIdMatch = isPhase2SceneId(sceneId);
  const promptMatch = expectedFp ? actualFp === expectedFp : true;
  return {
    status: uniqueReasons.length === 0 ? "FIXTURE_PARITY_PASS" : "FIXTURE_PARITY_FAIL",
    reasons: uniqueReasons,
    liveProofStatus: liveProof.status,
    liveProofReasons: liveProof.status === "UNVERIFIED" ? liveProof.reasons : [],
    comparisons: {
      characterId: characterIdMatch,
      characterName: characterNameMatch,
      personaId: personaIdPresent && personaIdMatch,
      personaName: personaNameMatch,
      sceneFamily: sceneFamilyMatch,
      sceneId: sceneIdMatch,
      promptFingerprint: promptMatch,
      liveProof: liveProof.status === "VERIFIED",
      originalFixtureJson: proposed.originalFixtureJsonRestored === true,
      currentSettings: proposed.currentSettingsRestored === true,
    },
    required,
    proposed,
    diagnosticB03a: OPENSCALE_B03A_DIAGNOSTIC,
  };
}

/** Archived wrong-fixture assembly. Not the style-eval default. */
export function buildOpenScaleB03aDiagnosticAssembly() {
  const fixture = getBenchmarkFixtureById(OPENSCALE_B03A_DIAGNOSTIC_FIXTURE_ID);
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
    comparableToApprovedStyleEval: false as const,
  };
}

export function buildOpenScalePilotAssembly(): never {
  throw new Error(
    "FIXTURE_PARITY_FAIL: B03a/한서린/민 is not the approved style-eval fixture"
  );
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
  proposedFixture?: OpenScaleStyleEvalProposedFixture;
}): Promise<JsonObject> {
  const env = input?.env ?? process.env;
  const credentials = resolveOpenScalePilotKey(env);
  const parity = evaluateOpenScaleStyleEvalFixtureParity(
    input?.proposedFixture ?? defaultOpenScaleStyleEvalProposedFixture()
  );
  if (parity.status === "FIXTURE_PARITY_FAIL") {
    return {
      status: "FIXTURE_PARITY_FAIL",
      providerInferencePosts: 0,
      cheaperInferencePosts: 0,
      retry: 0,
      fallback: 0,
      productionRouteChanges: 0,
      stopReason: "FIXTURE_PARITY_FAIL",
      parity,
      diagnosticB03a: OPENSCALE_B03A_DIAGNOSTIC,
    };
  }
  return {
    status: "FIXTURE_PARITY_PASS",
    providerInferencePosts: 0,
    cheaperInferencePosts: 0,
    retry: 0,
    fallback: 0,
    productionRouteChanges: 0,
    stopReason: "parity_pass_inference_not_authorized_this_turn",
    parity,
    diagnosticB03a: OPENSCALE_B03A_DIAGNOSTIC,
    credentialPresent: credentials.ok,
  };
}
