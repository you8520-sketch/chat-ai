import { createHash } from "node:crypto";
import { MAIN_RP_USER_SELECTABLE_OPTIONS, type SelectedAI } from "@/lib/chatModels";
import { estimateTokens } from "@/lib/ai";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { resolveOpenRouterModelId } from "@/lib/openRouterConfig";
import { isValidReportedTokenValue } from "@/lib/usageReportingEvidence";
import { resolvePublishedPricingExact } from "@/lib/publishedModelPricing";
import { resolveRegenerateGenerationOverrides } from "@/lib/openRouterClient";
import { buildCheaperInferenceChatCompletionsUrl, buildCheaperInferenceHeaders } from "@/lib/cheaperInferenceConfig";
import { parseCompatibleUsage, parseOpenRouterUsage } from "@/lib/openRouterUsage";
import { buildContext } from "@/services/contextBuilder";
import { executeCompatibleSupplyProbe, type ProbeJson } from "./compatibleSupplyProbe";
import { buildDeterministicSupplyProbeTurns, buildSupplyLiveRequestHeaders } from "./mainRpSupplyLiveQualification";
import { CANONICAL_RP_QUALIFICATION_SOURCE, buildCanonicalRpQualificationContextInput } from "./rpModelQualificationFixture";
import { buildActiveRpModelQualificationPacket } from "./rpModelQualificationPacket";

// User-supplied documentation claim, not an independently verified API contract.
export const FLUENCE_CHAT_ENDPOINT = "https://api.fluence.cloud/v1/chat/completions";
export const FLUENCE_BENCHMARK_KEY = "FLUENCE_BENCHMARK_API_KEY";
export type QualificationStatus = "PROVIDER_QUALIFICATION_READY" | "BLOCKED_WAITLIST_CREDENTIAL" | "QUALIFICATION_FAILED" | "ROOT_CAUSE_UNCONFIRMED";
export type ProbeOperation = "generation" | "regeneration" | "continuation" | "long_context";
export type RateEvidence = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number | null;
};

/** Operator-captured evidence. Never infer a Fluence model alias from a CI/OR slug. */
export type FluenceOffer = {
  logicalModelId: SelectedAI;
  wireModelId: string;
  offerId: string;
  upstreamProvider: string;
  observedAt: string;
  expiresAt: string;
  evidenceSource: string;
  identityEvidence: string;
  controlParityEvidence: string;
  supportedRequestKeys: string[];
  structuredCacheControlSupported: boolean;
  maxContextTokens: number;
  // Null means unconfirmed. ZDR does not grant adult-content permission.
  zdr: { available: boolean | null; request: ProbeJson; evidence: string | null };
  contentPermissionEvidence: string | null;
  routing: { request: ProbeJson; evidence: string };
  currentOffer: RateEvidence;
  referenceCeiling: { rates: RateEvidence; source: string; observedAt: string } | null;
  longContext: { thresholdTokens: number; rates: RateEvidence; source: string } | null;
  // Only an explicitly documented, USD-denominated field is actual billed cost.
  billedCost: { jsonPointer: string; currency: "USD"; evidence: string } | null;
};

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const finiteRate = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;

export function validateFluenceOffer(offer: FluenceOffer, nowMs = Date.now()): void {
  if (!MAIN_RP_USER_SELECTABLE_OPTIONS.some(o => o.id === offer.logicalModelId)) throw new Error("unknown_logical_model");
  for (const value of [offer.wireModelId, offer.offerId, offer.upstreamProvider, offer.evidenceSource, offer.identityEvidence, offer.controlParityEvidence, offer.routing?.evidence]) {
    if (typeof value !== "string" || !value.trim()) throw new Error("missing_contract_evidence");
  }
  const observed = Date.parse(offer.observedAt), expires = Date.parse(offer.expiresAt);
  if (!Number.isFinite(observed) || !Number.isFinite(expires) || observed > nowMs || expires <= nowMs || expires <= observed) throw new Error("stale_or_invalid_offer");
  if (!Array.isArray(offer.supportedRequestKeys) || !Number.isInteger(offer.maxContextTokens) || offer.maxContextTokens <= 0) throw new Error("invalid_capabilities");
  if (!offer.currentOffer) throw new Error("missing_current_offer_price");
  for (const r of [offer.currentOffer, offer.referenceCeiling?.rates, offer.longContext?.rates].filter(Boolean)) {
    if (!r || !finiteRate(r.inputUsdPerMillion) || !finiteRate(r.outputUsdPerMillion) || (r.cacheReadUsdPerMillion !== null && !finiteRate(r.cacheReadUsdPerMillion))) throw new Error("invalid_price");
  }
  if (offer.longContext && (!Number.isInteger(offer.longContext.thresholdTokens) || offer.longContext.thresholdTokens <= 0 || !offer.longContext.source)) throw new Error("invalid_context_price");
  if (offer.billedCost && (offer.billedCost.currency !== "USD" || !offer.billedCost.jsonPointer.startsWith("/") || !offer.billedCost.evidence)) throw new Error("unverified_billed_cost_field");
}

/** Adapt only the transport envelope; preserve canonical prompt and model controls. */
export function adaptFluenceQualificationBody(current: ProbeJson, offer: FluenceOffer): ProbeJson {
  validateFluenceOffer(offer);
  const body = structuredClone(current);
  delete body.provider;
  delete body.service_tier;
  delete body.session_id;
  body.model = offer.wireModelId;
  body.stream = true;
  body.stream_options = { include_usage: true };
  for (const additions of [offer.routing.request, offer.zdr.request]) {
    if (!additions || typeof additions !== "object" || Array.isArray(additions)) throw new Error("invalid_request_envelope");
    for (const [key, value] of Object.entries(additions)) {
      if (["model", "messages", "stream", "stream_options", "session_id", "service_tier", "temperature", "top_p", "max_tokens", "max_completion_tokens", "thinking", "reasoning", "reasoning_effort", "include_reasoning", "output_config", "seed", "frequency_penalty", "presence_penalty", "repetition_penalty", "stop"].includes(key)) throw new Error("canonical_control_override");
      if (key in body) {
        if (JSON.stringify(body[key]) === JSON.stringify(value)) continue;
        throw new Error("canonical_control_override");
      }
      body[key] = structuredClone(value);
    }
  }
  if (offer.zdr.available !== true || !offer.zdr.evidence || !Object.keys(offer.zdr.request).length) throw new Error("zdr_unconfirmed");
  if (!Object.keys(offer.routing.request).length) throw new Error("upstream_pin_unconfirmed");
  const unsupported = Object.keys(body).filter(key => !offer.supportedRequestKeys.includes(key));
  if (unsupported.length) throw new Error(`unsupported_canonical_controls:${unsupported.sort().join(",")}`);
  if (!offer.structuredCacheControlSupported && JSON.stringify(body.messages).includes('"cache_control"')) throw new Error("cache_control_parity_unconfirmed");
  if (hash(body.messages) !== hash(current.messages)) throw new Error("prompt_parity_failed");
  return body;
}

export function buildFluenceComparisonRequests(offer: FluenceOffer, operation: ProbeOperation = "generation") {
  validateFluenceOffer(offer);
  if (!["generation", "regeneration", "continuation", "long_context"].includes(operation)) throw new Error("unsupported_operation");
  const option = MAIN_RP_USER_SELECTABLE_OPTIONS.find(o => o.id === offer.logicalModelId)!;
  return buildDeterministicSupplyProbeTurns().map((turn, index) => {
    // /api/chat maps CI transport to the OpenRouter-compatible context provider;
    // do not confuse prompt identity with procurement/transport identity.
    const context = buildCanonicalRpQualificationContextInput({ modelId: option.id, provider: "openrouter", caseData: turn });
    context.regenerate = operation === "regeneration";
    context.isContinue = operation === "continuation";
    // Reuse frozen dialogue rather than inventing a second RP fixture/prompt.
    if (operation === "long_context") context.shortTermHistory = Array.from({ length: 24 }, () => turn.history).flat();
    const built = buildContext(context);
    const sessionId = `fluence-qualification-${option.id}-${operation}`;
    const wire = assemblePrimaryRpRequest({
      system: built.systemPrompt, history: built.history ?? [],
      modelId: option.provider === "openrouter" ? resolveOpenRouterModelId(option.id) : option.id,
      targetResponseChars: turn.targetResponseChars, stream: true,
      messageOpts: { transportProvider: option.provider, sessionId,
        charName: CANONICAL_RP_QUALIFICATION_SOURCE.characterName,
        personaName: CANONICAL_RP_QUALIFICATION_SOURCE.personaName,
        generationOverrides: operation === "regeneration"
          ? resolveRegenerateGenerationOverrides(option.id, turn.targetResponseChars) : undefined,
        sceneServerControls: {
          mode: context.isContinue ? "auto_progression" : "interactive", contentKind: "character", party: false,
          primaryCharacterName: CANONICAL_RP_QUALIFICATION_SOURCE.characterName,
          currentUserMessage: turn.currentUserMessage, recentMessages: context.shortTermHistory,
          adultModeEnabled: false, skipMotionCue: context.isContinue,
        },
      },
    });
    const currentBody: ProbeJson = { ...wire.requestBody, stream_options: { include_usage: true } };
    const candidateBody = adaptFluenceQualificationBody(currentBody, offer);
    const estimatedPromptTokens = estimateTokens(JSON.stringify(currentBody.messages));
    if (estimatedPromptTokens + Number(currentBody.max_tokens ?? 0) > offer.maxContextTokens) throw new Error("offer_context_limit");
    return {
      turn: (index + 1) as 1 | 2, operation, logicalModelId: option.id,
      currentProvider: option.provider, currentBody, candidateBody, sessionId,
      currentEndpoint: option.provider === "openrouter" ? wire.transport.endpoint
        : buildCheaperInferenceChatCompletionsUrl({ promptCacheSession: sessionId }),
      targetResponseChars: turn.targetResponseChars, estimatedPromptTokens,
      promptSha256: hash(currentBody.messages), systemPromptSha256: hash(built.systemPrompt),
    };
  });
}

export function resolveFluenceBenchmarkCredentials(env: NodeJS.ProcessEnv, modelId: SelectedAI) {
  const option = MAIN_RP_USER_SELECTABLE_OPTIONS.find(o => o.id === modelId);
  const currentKeyName = option?.provider === "openrouter" ? "OPENROUTER_SUPPLY_BENCHMARK_API_KEY" : "CHEAPER_INFERENCE_BENCHMARK_API_KEY";
  // Production keys are never considered, even if non-empty.
  if (!env[FLUENCE_BENCHMARK_KEY]?.trim() || !env[currentKeyName]?.trim()) {
    return { ok: false as const, status: "BLOCKED_WAITLIST_CREDENTIAL" as const, reason: "dedicated_benchmark_credential_missing", providerCalls: 0 as const };
  }
  if (env.REGULAR_TEST_REAL_PROVIDER_CALLS !== "1" || env.FLUENCE_PROVIDER_QUALIFICATION !== "1") {
    return { ok: false as const, status: "ROOT_CAUSE_UNCONFIRMED" as const, reason: "live_opt_in_missing", providerCalls: 0 as const };
  }
  return { ok: true as const, fluenceKey: env[FLUENCE_BENCHMARK_KEY]!.trim(), currentKey: env[currentKeyName]!.trim(), currentKeyName };
}

function reportedUsd(envelope: ProbeJson | undefined, field: FluenceOffer["billedCost"]): number | null {
  if (!envelope || !field) return null;
  let value: unknown = envelope;
  for (const key of field.jsonPointer.slice(1).split("/").map(k => k.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    value = value && typeof value === "object" ? (value as ProbeJson)[key] : undefined;
  }
  return finiteRate(value) ? value as number : null;
}

export function buildFluencePreparation() {
  return {
    version: 1, status: "BLOCKED_WAITLIST_CREDENTIAL" as QualificationStatus,
    productionRouteChanges: 0, providerCalls: 0, runtimeObservations: "NOT_RUN",
    endpointClaim: { url: FLUENCE_CHAT_ENDPOINT, source: "user_supplied_documentation", independentlyVerified: false },
    packet: buildActiveRpModelQualificationPacket(),
    offer: null, actualBilledUsd: null, priceStability7d: "NOT_OBSERVED", priceStability30d: "NOT_OBSERVED",
    adultQualification: { status: "NOT_RUN", policyConfirmed: false, fixtureOwner: "scripts/lib/proseDietFixtures.ts#PROSE_DIET_ADULT_FIXTURE", productionActivation: false },
    requiredEvidence: ["exact model/offer/upstream mapping", "request controls and cache parity", "ZDR request syntax", "context pricing", "USD billed field semantics", "adult content permission and separate raw refusal/allow evidence"],
    liveOperations: ["generation", "regeneration", "continuation", "long_context"],
    notes: ["No RP quality score; raw outputs require GPT/user review.", "Transport observations are not production qualification or permission.", "No automatic routing, retry, failover, point repricing, production ledger writes, or Railway changes."],
  };
}

export async function runFluenceComparison(input: {
  offer: FluenceOffer; operation?: ProbeOperation; env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number;
  maxEstimatedUsd?: number;
}) {
  const credentials = resolveFluenceBenchmarkCredentials(input.env ?? process.env, input.offer.logicalModelId);
  if (!credentials.ok) return { ...credentials, productionRouteChanges: 0, results: [] };
  const requests = buildFluenceComparisonRequests(input.offer, input.operation);
  const budget = input.maxEstimatedUsd ?? 5;
  if (!Number.isFinite(budget) || budget <= 0 || budget > 5) throw new Error("invalid_benchmark_budget");
  const reference = resolvePublishedPricingExact(input.offer.logicalModelId)!.pricing;
  const estimatedPairUsd = requests.reduce((sum, request) => {
    // Conservative preflight, NOT an invoice or hard provider spending cap.
    const output = request.targetResponseChars * 4;
    const candidateRates = input.offer.longContext && request.estimatedPromptTokens >= input.offer.longContext.thresholdTokens
      ? input.offer.longContext.rates : input.offer.currentOffer;
    return sum + (request.estimatedPromptTokens * (candidateRates.inputUsdPerMillion + reference.billingReferenceInputUsdPerMillion)
      + output * (candidateRates.outputUsdPerMillion + reference.billingReferenceOutputUsdPerMillion)) / 1_000_000;
  }, 0);
  if (estimatedPairUsd > budget) throw new Error("benchmark_estimate_exceeds_budget");
  const results = [];
  // Exactly two frozen requests per side; no retries, generated-output feedback, or failover.
  for (const request of requests) {
    for (const side of ["current", "fluence"] as const) {
      const isFluence = side === "fluence";
      const currentHeaders = request.currentProvider === "openrouter"
        ? buildSupplyLiveRequestHeaders(credentials.currentKey)
        : { ...buildCheaperInferenceHeaders(credentials.currentKey), Accept: "text/event-stream" };
      const response = await executeCompatibleSupplyProbe({
        endpoint: isFluence ? FLUENCE_CHAT_ENDPOINT : request.currentEndpoint,
        headers: isFluence ? { Authorization: `Bearer ${credentials.fluenceKey}`, "Content-Type": "application/json", Accept: "text/event-stream" } : currentHeaders,
        body: isFluence ? request.candidateBody : request.currentBody,
        timeoutMs: input.timeoutMs ?? 90_000, signal: input.signal, strict: true, fetchImpl: input.fetchImpl,
      });
      // Shared token parser only. Fluence cost semantics are never inferred from CI/OR fields.
      const usage = isFluence ? parseOpenRouterUsage(response.usage)
        : parseCompatibleUsage({ usage: response.usage, headers: response.responseHeaders, cheaperInference: response.envelope?.cheaper_inference, transportProvider: request.currentProvider });
      const promptReported = isValidReportedTokenValue(response.usage?.prompt_tokens ?? response.usage?.input_tokens);
      const outputReported = isValidReportedTokenValue(response.usage?.completion_tokens ?? response.usage?.output_tokens);
      const tokensPerSecond = outputReported && response.ttftSeconds !== null
        ? usage.completionTokens / Math.max(0.001, response.totalSeconds - response.ttftSeconds) : null;
      const rawOutput = response.text.replaceAll(credentials.fluenceKey, "[REDACTED]").replaceAll(credentials.currentKey, "[REDACTED]");
      const responseModelMatches = response.resolvedModel === (isFluence ? input.offer.wireModelId : request.currentBody.model);
      results.push({
        side, turn: request.turn, operation: request.operation, logicalModelId: request.logicalModelId,
        transportProvider: isFluence ? "fluence" : request.currentProvider,
        offerId: isFluence ? input.offer.offerId : null,
        requestedUpstream: isFluence ? input.offer.upstreamProvider : null,
        reportedUpstream: response.envelope?.provider ?? null,
        responseModel: response.resolvedModel, responseModelMatches,
        responseId: response.generationId, requestId: response.responseHeaders?.get("x-request-id") ?? null,
        httpStatus: response.httpStatus, requestStarted: response.requestStarted, finishReason: response.finishReason, sawDone: response.sawDone,
        error: response.error?.replaceAll(credentials.fluenceKey, "[REDACTED]").replaceAll(credentials.currentKey, "[REDACTED]") ?? null,
        rawOutput, outputChars: response.visibleChars,
        ttftSeconds: response.ttftSeconds, totalSeconds: response.totalSeconds, tokensPerSecond,
        promptTokens: promptReported ? usage.promptTokens : null,
        outputTokens: outputReported ? usage.completionTokens : null,
        reasoningTokens: usage.reportingEvidence.reasoning === "reported_valid" ? usage.reasoningTokens : null,
        actualBilledUsd: isFluence ? reportedUsd(response.envelope, input.offer.billedCost)
          : usage.cheaperInferenceBilledCostUsd ?? null,
        unclassifiedReportedCost: response.usage?.cost ?? null,
        rawUsage: response.usage,
        usageReportingEvidence: usage.reportingEvidence, promptSha256: request.promptSha256,
        targetResponseChars: request.targetResponseChars, estimatedPromptTokens: request.estimatedPromptTokens,
      });
      // Fail closed and preserve partial evidence. Never spend another call after a failure.
      if (response.error || !responseModelMatches) return { status: "QUALIFICATION_FAILED" as QualificationStatus, providerCalls: results.filter(r => r.requestStarted).length, productionRouteChanges: 0, estimatedPairUsd, results };
    }
  }
  return {
    // Four transport successes do not prove adult policy, stability or human RP review.
    status: "ROOT_CAUSE_UNCONFIRMED" as QualificationStatus,
    transportStatus: "PAIR_COMPLETE", providerCalls: results.length, productionRouteChanges: 0, estimatedPairUsd,
    offer: input.offer, errorRate: results.filter(r => r.error).length / results.length,
    priceStability7d: "NOT_OBSERVED", priceStability30d: "NOT_OBSERVED",
    adultQualification: "NOT_RUN", humanRpReview: "PENDING", results,
  };
}

/** Observational preparation only; no canonical pricing or ledger mutation. */
export function summarizeFluencePriceHistory(samples: FluenceOffer[], days: 7 | 30, nowMs = Date.now()) {
  const recent = samples.filter(s => Date.parse(s.observedAt) <= nowMs && Date.parse(s.observedAt) >= nowMs - days * 86400_000);
  const identities = new Set(recent.map(s => `${s.logicalModelId}/${s.wireModelId}/${s.upstreamProvider}/${s.offerId}`));
  if (identities.size > 1) throw new Error("mixed_offer_history");
  const observedDays = new Set(recent.map(s => s.observedAt.slice(0, 10))).size;
  return {
    days, samples: recent.length, observedDays,
    status: observedDays >= days ? "WINDOW_OBSERVED" : "INSUFFICIENT_HISTORY",
    minInputUsdPerMillion: recent.length ? Math.min(...recent.map(s => s.currentOffer.inputUsdPerMillion)) : null,
    maxInputUsdPerMillion: recent.length ? Math.max(...recent.map(s => s.currentOffer.inputUsdPerMillion)) : null,
    minOutputUsdPerMillion: recent.length ? Math.min(...recent.map(s => s.currentOffer.outputUsdPerMillion)) : null,
    maxOutputUsdPerMillion: recent.length ? Math.max(...recent.map(s => s.currentOffer.outputUsdPerMillion)) : null,
  };
}
