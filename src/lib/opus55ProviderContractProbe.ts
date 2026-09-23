/**
 * Minimal Opus 5.5 CheaperInference contract probe — diagnostic only.
 * No DB, no user billing, no production policy mutation.
 */

import { CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL } from "@/lib/chatModels";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  applyCheaperInferenceModelReasoningPolicy,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import type { Opus55RuntimeContractProbeResult } from "@/lib/opus55PricingEvidence";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import { ANTHROPIC_EPHEMERAL_CACHE } from "@/lib/openRouterCache";

const STABLE_PREFIX =
  "Opus55 contract probe stable prefix. ".repeat(40).slice(0, 1_200);

function countCacheControlBlocks(messages: unknown[]): number {
  let n = 0;
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const content = (msg as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { cache_control?: { type?: string } }).cache_control?.type === "ephemeral"
      ) {
        n += 1;
      }
    }
  }
  return n;
}

function usageRecord(usage: unknown): Record<string, unknown> | null {
  if (!usage || typeof usage !== "object") return null;
  return usage as Record<string, unknown>;
}

function reasoningTokensFromUsage(usage: Record<string, unknown> | null): number | null {
  if (!usage) return null;
  const details = usage.completion_tokens_details;
  if (details && typeof details === "object") {
    const reasoning = (details as { reasoning_tokens?: unknown }).reasoning_tokens;
    if (typeof reasoning === "number" && Number.isFinite(reasoning)) return reasoning;
  }
  const top = usage.reasoning_tokens;
  if (typeof top === "number" && Number.isFinite(top)) return top;
  return null;
}

function cacheReadTokens(usage: Record<string, unknown> | null): number {
  if (!usage) return 0;
  const cached = usage.cached_tokens ?? usage.cache_read_input_tokens;
  return typeof cached === "number" && cached > 0 ? cached : 0;
}

function cacheWriteTokens(usage: Record<string, unknown> | null): number {
  if (!usage) return 0;
  const w = usage.cache_creation_input_tokens ?? usage.cache_write_input_tokens;
  return typeof w === "number" && w > 0 ? w : 0;
}

async function postChat(body: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  json: Record<string, unknown> | null;
  errorText: string | null;
}> {
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return {
    ok: res.ok,
    status: res.status,
    json,
    errorText: res.ok ? null : text.slice(0, 500),
  };
}

export async function runOpus55ProviderContractProbe(): Promise<Opus55RuntimeContractProbeResult> {
  try {
    resolveCheaperInferenceApiKey();
  } catch {
    return {
      status: "RUNTIME_PROOF_BLOCKED",
      attemptedAt: new Date().toISOString(),
      reasoning: {
        httpStatus: null,
        rejectedFields: null,
        responseReasoningTokens: null,
        notes: "CHEAPER_INFERENCE_API_KEY missing",
      },
      cache: {
        cacheTransportWorks: null,
        cacheHitWorks: null,
        cacheBillingSavingWorks: null,
        firstUsage: null,
        secondUsage: null,
        firstBilledUsd: null,
        secondBilledUsd: null,
        notes: "UNVERIFIED",
      },
      blockReason: "NO_CHEAPER_INFERENCE_KEY",
    };
  }

  const baseMessages = [
    {
      role: "system",
      content: [
        {
          type: "text",
          text: STABLE_PREFIX,
          cache_control: ANTHROPIC_EPHEMERAL_CACHE,
        },
      ],
    },
    { role: "user", content: "Reply with exactly: OK" },
  ];

  const requestBody = applyCheaperInferenceModelReasoningPolicy({
    model: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    messages: baseMessages,
    max_tokens: 8,
    stream: false,
  });

  const cacheBlocks = countCacheControlBlocks(
    Array.isArray(requestBody.messages) ? (requestBody.messages as unknown[]) : []
  );

  const first = await postChat(requestBody);
  if (!first.ok || !first.json) {
    return {
      status: "COMPLETED",
      attemptedAt: new Date().toISOString(),
      reasoning: {
        httpStatus: first.status,
        rejectedFields: first.errorText ? ["request_rejected"] : null,
        responseReasoningTokens: null,
        notes: first.errorText ?? "First request failed",
      },
      cache: {
        cacheTransportWorks: cacheBlocks > 0,
        cacheHitWorks: null,
        cacheBillingSavingWorks: null,
        firstUsage: null,
        secondUsage: null,
        firstBilledUsd: null,
        secondBilledUsd: null,
        notes: "Second request skipped after first failure",
      },
      blockReason: null,
    };
  }

  const firstUsageRaw = usageRecord(first.json.usage);
  const firstBreakdown = parseOpenRouterUsage(first.json);
  const firstBilled = firstBreakdown.cheaperInferenceBilledCostUsd ?? firstBreakdown.upstreamCostUsd;

  const secondMessages = [
    ...baseMessages,
    {
      role: "assistant",
      content: String(
        (first.json.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message
          ?.content ?? "OK"
      ).slice(0, 20),
    },
    { role: "user", content: "Again reply: OK" },
  ];

  const secondBody = applyCheaperInferenceModelReasoningPolicy({
    model: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    messages: secondMessages,
    max_tokens: 8,
    stream: false,
  });

  const second = await postChat(secondBody);
  const secondUsageRaw = second.ok && second.json ? usageRecord(second.json.usage) : null;
  const secondBreakdown =
    second.ok && second.json ? parseOpenRouterUsage(second.json) : null;
  const secondBilled =
    secondBreakdown?.cheaperInferenceBilledCostUsd ?? secondBreakdown?.upstreamCostUsd ?? null;

  const secondCacheRead = cacheReadTokens(secondUsageRaw);
  const firstCacheWrite = cacheWriteTokens(firstUsageRaw);

  const cacheHitWorks = secondCacheRead > 0;
  const cacheTransportWorks = cacheBlocks > 0;
  let cacheBillingSavingWorks: boolean | null = null;
  if (firstBilled != null && secondBilled != null && Number.isFinite(firstBilled) && Number.isFinite(secondBilled)) {
    cacheBillingSavingWorks = secondBilled < firstBilled;
  }

  let cacheNotes = "UNVERIFIED";
  if (cacheHitWorks && cacheBillingSavingWorks === false) {
    cacheNotes = "CACHE_HIT_WORKS; CACHE_BILLING_SAVING_NOT_PROVEN (CI catalog cache read = input rate)";
  } else if (cacheHitWorks && cacheBillingSavingWorks === true) {
    cacheNotes = "CACHE_HIT_WORKS; CACHE_BILLING_SAVING_WORKS";
  } else if (!cacheHitWorks && firstCacheWrite > 0) {
    cacheNotes = "CACHE_WRITE reported on first turn; second-turn read UNVERIFIED";
  }

  return {
    status: "COMPLETED",
    attemptedAt: new Date().toISOString(),
    reasoning: {
      httpStatus: first.status,
      rejectedFields: null,
      responseReasoningTokens: reasoningTokensFromUsage(firstUsageRaw),
      notes:
        first.status >= 200 && first.status < 300
          ? "Request accepted with thinking disabled / reasoning_effort low"
          : "Unexpected status",
    },
    cache: {
      cacheTransportWorks,
      cacheHitWorks: second.ok ? cacheHitWorks : null,
      cacheBillingSavingWorks,
      firstUsage: firstUsageRaw,
      secondUsage: secondUsageRaw,
      firstBilledUsd: firstBilled ?? null,
      secondBilledUsd: secondBilled,
      notes: cacheNotes,
    },
    blockReason: null,
  };
}
