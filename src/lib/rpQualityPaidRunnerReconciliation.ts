/**
 * Exact-cost reconciliation for the paid runner. Reuses parseCompatibleUsage
 * token fields and the CheaperInference usage-request lookup owner.
 * OpenRouter generation metadata is corroboration only when a generation id is
 * present and distinct from the request id — stream usage.cost is never
 * labeled provider_exact by itself.
 */
import {
  CI_USAGE_REQUESTS_URL,
  buildUsageRequestLookupWindow,
  lookupCheaperInferenceUsageRequestById,
} from "@/lib/cheaperInferenceUsage";
import { OPENROUTER_BASE_URL, buildOpenRouterHeaders } from "@/lib/openRouterConfig";
import { parseCompatibleUsage } from "@/lib/openRouterUsage";
import { readCompatibleCompletionProviderRequestId } from "@/lib/openRouterCompletion";
import type {
  PaidRunnerSealedCall,
  PaidRunnerTransportResult,
  PaidRunnerUsageEvidence,
} from "@/lib/rpQualityPaidRunner";

export const PAID_RUNNER_OPENROUTER_GENERATION_URL = `${OPENROUTER_BASE_URL}/generation`;
export const PAID_RUNNER_RECONCILE_GET_MAX_ATTEMPTS = 2;
export const PAID_RUNNER_RECONCILE_GET_TIMEOUT_MS = 15_000;

export type PaidRunnerReconcileKeys = {
  openRouterKey: string;
  cheaperInferenceKey: string;
};

export type PaidRunnerReconcileInput = {
  call: PaidRunnerSealedCall;
  result: PaidRunnerTransportResult;
  elapsedMs: number;
  fetchImpl: typeof fetch;
  keys: PaidRunnerReconcileKeys;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPositiveUsd(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || !(n > 0)) return null;
  return n;
}

function readOpenRouterGenerationId(body: unknown): string | null {
  const record = asRecord(body);
  const id = record?.id;
  if (typeof id === "string" && id.trim() && !id.startsWith("chatcmpl-")) {
    return id.trim();
  }
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function cheaperInferenceBillingStatus(body: unknown): string | null {
  const envelope = asRecord(asRecord(body)?.cheaper_inference);
  const billing = asRecord(envelope?.billing);
  const status = billing?.status ?? envelope?.status;
  return typeof status === "string" ? status.trim().toLowerCase() : null;
}

function cheaperInferenceEnvelopeUsd(body: unknown): number | null {
  const envelope = asRecord(asRecord(body)?.cheaper_inference);
  if (!envelope) return null;
  const billing = asRecord(envelope.billing);
  return readPositiveUsd(
    billing?.billed_cost_usd ?? billing?.billedCostUsd ?? envelope.billed_cost_usd
  );
}

function cheaperInferenceEnvelopeSettled(status: string | null): boolean {
  return status === "settled" || status === "ok" || status === "success";
}

async function lookupOpenRouterGenerationCost(input: {
  generationId: string;
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<{ billedUsd: number; model: string | null } | null> {
  for (let attempt = 0; attempt < PAID_RUNNER_RECONCILE_GET_MAX_ATTEMPTS; attempt += 1) {
    try {
      const url = `${PAID_RUNNER_OPENROUTER_GENERATION_URL}?id=${encodeURIComponent(input.generationId)}`;
      const response = await input.fetchImpl(url, {
        method: "GET",
        headers: {
          ...buildOpenRouterHeaders(input.apiKey),
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(PAID_RUNNER_RECONCILE_GET_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const payload = asRecord(await response.json());
      const data = asRecord(payload?.data) ?? payload;
      if (!data) continue;
      const returnedId = typeof data.id === "string" ? data.id.trim() : "";
      if (returnedId && returnedId !== input.generationId) continue;
      const billedUsd = readPositiveUsd(data.total_cost ?? data.usage);
      if (billedUsd == null) return null;
      return {
        billedUsd,
        model: typeof data.model === "string" ? data.model : null,
      };
    } catch {
      /* GET only; never repeat the generation POST */
    }
  }
  return null;
}

async function lookupCheaperInferenceUsageCost(input: {
  requestId: string;
  apiKey: string;
  fetchImpl: typeof fetch;
  elapsedMs: number;
}): Promise<{ billedUsd: number; settled: boolean; model: string | null } | null> {
  if (!input.apiKey.trim() || !input.requestId.trim()) return null;
  const now = Date.now();
  const window = buildUsageRequestLookupWindow(now - Math.max(0, input.elapsedMs), now);
  const page = await lookupCheaperInferenceUsageRequestById({
    requestId: input.requestId,
    startAt: window.startAt,
    endAt: window.endAt,
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
    maxGets: PAID_RUNNER_RECONCILE_GET_MAX_ATTEMPTS,
    totalBudgetMs: PAID_RUNNER_RECONCILE_GET_TIMEOUT_MS,
    sleep: async () => undefined,
  });
  if (!page.ok) return null;
  const billedUsd = page.value.billedMicroUsd / 1_000_000;
  if (!(billedUsd > 0) || !page.value.settled) {
    return { billedUsd: billedUsd > 0 ? billedUsd : 0, settled: false, model: page.value.model };
  }
  return { billedUsd, settled: true, model: page.value.model };
}

export async function reconcilePaidRunnerSettlement(
  input: PaidRunnerReconcileInput
): Promise<PaidRunnerUsageEvidence> {
  const { call, result, elapsedMs } = input;
  const base: PaidRunnerUsageEvidence = {
    fixtureId: call.fixtureId,
    canonicalId: call.canonicalId,
    provider: call.provider,
    wireModel: call.wireModel,
    providerRequestId: null,
    httpResult: result.ok ? result.httpStatus : result.httpStatus,
    finishReason: result.ok ? result.finishReason : result.kind,
    promptTokens: null,
    completionTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    billedUsd: null,
    settlementSource: "unsettled",
    visibleChars: result.ok ? result.text.length : result.text.length || null,
    elapsedMs,
    finalWireFingerprint: call.finalWireFingerprint,
  };
  if (!result.ok) return base;
  if (result.httpStatus < 200 || result.httpStatus >= 300) {
    return { ...base, finishReason: "http", settlementSource: "unsettled" };
  }

  const headerBag = new Headers(result.headers);
  const requestId =
    result.requestId ||
    readCompatibleCompletionProviderRequestId({
      provider: call.provider,
      headers: headerBag,
      body: result.body,
    });
  const parsed = parseCompatibleUsage({
    usage: asRecord(result.body)?.usage,
    cheaperInference: asRecord(result.body)?.cheaper_inference ?? result.cheaperInference,
    headers: headerBag,
    transportProvider: call.provider,
  });
  const tokens = {
    promptTokens: result.usage.promptTokens || parsed.promptTokens || null,
    completionTokens: result.usage.completionTokens || parsed.completionTokens || null,
    cacheReadTokens: result.usage.cacheReadTokens || parsed.cacheReadTokens || null,
    cacheWriteTokens: result.usage.cacheWriteTokens || parsed.cacheWriteTokens || null,
    reasoningTokens: result.usage.reasoningTokens || parsed.reasoningTokens || null,
  };
  if (!requestId) {
    return { ...base, ...tokens, settlementSource: "missing" };
  }

  if (call.provider === "cheaperinference") {
    const status = cheaperInferenceBillingStatus(result.body);
    const envelopeUsd = cheaperInferenceEnvelopeUsd(result.body);
    if (status === "failed" || status === "error") {
      return { ...base, ...tokens, providerRequestId: requestId, settlementSource: "unsettled" };
    }
    if (cheaperInferenceEnvelopeSettled(status) && envelopeUsd != null && envelopeUsd > 0) {
      return {
        ...base,
        ...tokens,
        providerRequestId: requestId,
        billedUsd: envelopeUsd,
        settlementSource: "provider_exact",
        visibleChars: result.text.length,
      };
    }
    const lookedUp = await lookupCheaperInferenceUsageCost({
      requestId,
      apiKey: input.keys.cheaperInferenceKey,
      fetchImpl: input.fetchImpl,
      elapsedMs,
    });
    if (!lookedUp || !lookedUp.settled || !(lookedUp.billedUsd > 0)) {
      return { ...base, ...tokens, providerRequestId: requestId, settlementSource: "unsettled" };
    }
    if (lookedUp.model && lookedUp.model !== call.wireModel) {
      return { ...base, ...tokens, providerRequestId: requestId, finishReason: "wrong_provider_model" };
    }
    return {
      ...base,
      ...tokens,
      providerRequestId: requestId,
      billedUsd: lookedUp.billedUsd,
      settlementSource: "provider_exact",
      visibleChars: result.text.length,
    };
  }

  const generationId = result.generationId || readOpenRouterGenerationId(result.body);
  if (!generationId || generationId === requestId) {
    return { ...base, ...tokens, providerRequestId: requestId, settlementSource: "unsettled" };
  }
  const lookedUp = await lookupOpenRouterGenerationCost({
    generationId,
    apiKey: input.keys.openRouterKey,
    fetchImpl: input.fetchImpl,
  });
  if (!lookedUp || !(lookedUp.billedUsd > 0)) {
    return { ...base, ...tokens, providerRequestId: requestId, settlementSource: "unsettled" };
  }
  if (lookedUp.model && lookedUp.model !== call.wireModel) {
    return { ...base, ...tokens, providerRequestId: requestId, finishReason: "wrong_provider_model" };
  }
  return {
    ...base,
    ...tokens,
    providerRequestId: requestId,
    billedUsd: lookedUp.billedUsd,
    settlementSource: "provider_exact",
    visibleChars: result.text.length,
  };
}

export function paidRunnerReconciliationGetOwner(): {
  cheaperInference: string;
  openRouter: string;
} {
  return {
    cheaperInference: CI_USAGE_REQUESTS_URL,
    openRouter: PAID_RUNNER_OPENROUTER_GENERATION_URL,
  };
}
