/**
 * Track B.1 — READ-ONLY OpenRouter provider routing TTFT audit.
 * Same frozen ~22k steady-state payload; no production routing changes.
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-openrouter-provider-routing-audit.ts
 *   E2E_RUNS=5 VARIANTS=A,B,C,D node --conditions=react-server --import tsx scripts/gemini31-openrouter-provider-routing-audit.ts
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  buildOpenRouterHeaders,
} from "../src/lib/openRouterConfig";
import { OPENROUTER_GEMINI_31_PRO_MODEL } from "../src/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";
import { HISTORY_TOKEN_BUDGET } from "../src/lib/contextTrack";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveProviderRawPoolExchangeCount,
  resolveProviderRawTrimFloorExchanges,
} from "../src/lib/hybridMemory";
import { trimProviderHistoryToBudget } from "../src/lib/providerHistoryPolicy";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { openRouterUsdCostFromRates } from "../src/lib/openRouterModelPricing";
import type { ChatMsg } from "../src/lib/ai";

loadEnvLocal();

const OUT_DIR = "/opt/cursor/artifacts/gemini31-openrouter-provider-routing-audit";
const TRACK_B_RUNS_PATH = "/opt/cursor/artifacts/gemini31-provider-path-ab/runs.jsonl";
const RUNS = Math.max(5, Number(process.env.E2E_RUNS ?? "5") || 5);

/** Confirmed via GET https://openrouter.ai/api/v1/providers (2026-08-29) */
const PROVIDER_SLUG_VERTEX = "google-vertex";
const PROVIDER_SLUG_AI_STUDIO = "google-ai-studio";

const MEASURE_USER =
  "일단 네 옆에서 걸어갈게. 갑자기 멈추면 말해.";

const USER_TURNS = [
  "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
  "같이 갈래? *두리번*",
  "어디로 가? 안내해줘.",
  "*따라가며* 여기 처음이야.",
  "그 초커... 왜 차고 있어?",
  "귀 괜찮아? 방금 또 찡그린 것 같은데.",
  "잠깐 여기 서서 숨 좀 고를까.",
  "너는 여기서 오래 일했어?",
  "...나, 여기 오기 전에 뭐 하고 있었는지 전혀 기억이 안 나.",
  "일단 네 말대로 가볼게. 옆에 있어줄래?",
  "저쪽 복도 맞아? *걸음을 맞추며*",
  "사람들이 너 보면 슬쩍 피하던데. 왜 그래?",
  "이명, 지금은 좀 어때.",
  "목적지부터 말해줘. 어디까지 가는 거야.",
  "*초커를 흘깃* 저거 아프진 않아?",
  "렌인 건 알겠는데, 그 다음이 비어 있어.",
  "잠깐. 발소리 많아. 여기 서 있을까.",
  "너 혼자 이렇게 다녀도 괜찮아?",
] as const;

const JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

const JO_WORLD = `에이지스 컨트롤 본부. 센티넬/가이드. 중앙 로비, 지원국, 동기화 챔버, 환풍구, 지하 완충 덱.`;

const MOCK_SUMMARY =
  "짧지만 중요한 사건 하나만 기록함. 이후 전개에 영향을 주는 약속과 관계 변화만 남김. " +
  "추가 장식 없이 사실만 압축. 반복 묘사는 생략. 핵심만 유지.";

const SUMMARIZED_THROUGH = 15;
const COMPLETED_TURNS = USER_TURNS.length;
const LONG_TERM_MEMORY = [MOCK_SUMMARY, MOCK_SUMMARY, MOCK_SUMMARY].join("\n\n");

type VariantId =
  | "DEFAULT"
  | "LATENCY_SORT"
  | "GOOGLE_VERTEX_PIN"
  | "GOOGLE_AI_STUDIO_PIN"
  | "VERTEX_PREFERRED_FALLBACK";

type VariantConfig = {
  id: VariantId;
  label: string;
  requestedProviderPolicy: Record<string, unknown> | null;
  policyDescription: string;
};

type RunResult = {
  variant: VariantId;
  run: number;
  cachePhase: "cold" | "warm";
  requestId: string | null;
  generationId: string | null;
  requestedProviderPolicy: Record<string, unknown> | null;
  actualUpstreamProvider: string | null;
  httpStatus: number;
  error?: string;
  fallbackOccurred: boolean | null;
  requestStartMs: number;
  httpHeadersMs: number | null;
  firstSseMs: number | null;
  firstVisibleTokenMs: number | null;
  totalLatencyMs: number;
  promptTokens: number;
  cachedTokens: number;
  cacheRatio: number;
  reasoningTokens: number;
  completionTokens: number;
  costUsd: number | null;
  finishReason: string | null;
  outputChars: number;
};

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function stats(nums: number[]) {
  if (!nums.length) return { min: 0, median: 0, max: 0 };
  return { min: Math.min(...nums), median: median(nums), max: Math.max(...nums) };
}

function loadAssistantRaw(turn: number): string {
  const p = path.join(
    process.cwd(),
    `docs/audits/gemini-37-flash-pricing/t${turn}-raw.txt`
  );
  return fs.readFileSync(p, "utf8").trim();
}

function buildFrozenPayload(): {
  built: ReturnType<typeof buildContext>;
  baseRequestBody: Record<string, unknown>;
} {
  const rows: { role: "user" | "assistant"; content: string; model?: string }[] = [
    { role: "assistant", content: TERRA_PROMPT_CANARY_GREETING_NEUTRAL, model: "greeting" },
  ];
  for (let i = 0; i < USER_TURNS.length; i++) {
    rows.push({ role: "user", content: USER_TURNS[i]! });
    rows.push({ role: "assistant", content: loadAssistantRaw(i + 1) });
  }
  const allTurns = messagesToTurns(rows);
  const pool = resolveProviderRawPoolExchangeCount({
    memoryFeatureEnabled: true,
    completedTurns: COMPLETED_TURNS,
    summarizedTurnCount: SUMMARIZED_THROUGH,
  });
  const trimFloor = resolveProviderRawTrimFloorExchanges();
  const rawFull = rawRecentTurnsToHistory(allTurns, pool, {
    memoryFeatureEnabled: true,
    summarizedTurnCount: SUMMARIZED_THROUGH,
  });
  const shortTermHistory: ChatMsg[] = trimProviderHistoryToBudget(
    rawFull,
    HISTORY_TOKEN_BUDGET,
    { minRealPlayableExchanges: trimFloor, protectOpening: false }
  );

  const built = buildContext({
    charName: "조태형",
    systemPrompt: JO_TAEHYUNG_CARD,
    world: JO_WORLD,
    exampleDialog: "유저: …무서워.\n조태형: …괜찮아.",
    chunks: [
      {
        id: "e2e-identity",
        characterId: "e2e",
        content: JO_TAEHYUNG_CARD,
        category: "identity",
        importance: "CRITICAL",
        tokenCount: 200,
        keywords: ["조태형"],
      },
      {
        id: "e2e-world",
        characterId: "e2e",
        content: JO_WORLD,
        category: "world",
        importance: "CONTEXTUAL",
        tokenCount: 40,
        keywords: ["에이지스"],
      },
    ],
    userNickname: "렌",
    personaDisplayName: "렌",
    userPersona: "이름/호칭: 렌\n성별: 남성",
    userPersonaGender: "male",
    gender: "male",
    shortTermHistory,
    currentUserMessage: MEASURE_USER,
    nsfw: true,
    provider: "openrouter",
    modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    completedTurns: COMPLETED_TURNS,
    completedTurnsForMemoryCoverage: COMPLETED_TURNS,
    summarizedTurnCount: SUMMARIZED_THROUGH,
    longTermMemory: LONG_TERM_MEMORY,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    historyMinTurnFloor: trimFloor,
    providerHistoryMinRealPlayableExchanges: trimFloor,
    providerHistoryAbsoluteTurnFloor: trimFloor,
    providerHistoryProtectOpening: false,
    suppressMemoryCoverageDegradedLog: true,
  });

  const history = built.history ?? [];
  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history,
    modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: true,
    messageOpts: {
      transportProvider: "openrouter",
      charName: "조태형",
    },
  });

  return {
    built,
    baseRequestBody: structuredClone(assembled.requestBody) as Record<string, unknown>,
  };
}

function resolveVariants(includeE: boolean): VariantConfig[] {
  const variants: VariantConfig[] = [
    {
      id: "DEFAULT",
      label: "OpenRouter default routing",
      requestedProviderPolicy: null,
      policyDescription: "current/default (no provider field)",
    },
    {
      id: "LATENCY_SORT",
      label: "OpenRouter provider.sort=latency",
      requestedProviderPolicy: { sort: "latency" },
      policyDescription: 'provider: { sort: "latency" }',
    },
    {
      id: "GOOGLE_VERTEX_PIN",
      label: "Google Vertex pinned (no fallback)",
      requestedProviderPolicy: {
        only: [PROVIDER_SLUG_VERTEX],
        allow_fallbacks: false,
      },
      policyDescription: `provider: { only: ["${PROVIDER_SLUG_VERTEX}"], allow_fallbacks: false }`,
    },
    {
      id: "GOOGLE_AI_STUDIO_PIN",
      label: "Google AI Studio pinned (no fallback)",
      requestedProviderPolicy: {
        only: [PROVIDER_SLUG_AI_STUDIO],
        allow_fallbacks: false,
      },
      policyDescription: `provider: { only: ["${PROVIDER_SLUG_AI_STUDIO}"], allow_fallbacks: false }`,
    },
  ];
  if (includeE) {
    variants.push({
      id: "VERTEX_PREFERRED_FALLBACK",
      label: "Vertex preferred + AI Studio fallback",
      requestedProviderPolicy: {
        order: [PROVIDER_SLUG_VERTEX, PROVIDER_SLUG_AI_STUDIO],
        allow_fallbacks: true,
      },
      policyDescription: `provider: { order: ["${PROVIDER_SLUG_VERTEX}", "${PROVIDER_SLUG_AI_STUDIO}"], allow_fallbacks: true }`,
    });
  }
  return variants;
}

function applyProviderPolicy(
  baseBody: Record<string, unknown>,
  policy: Record<string, unknown> | null
): Record<string, unknown> {
  const body = structuredClone(baseBody) as Record<string, unknown>;
  if (policy) {
    body.provider = policy;
  } else {
    delete body.provider;
  }
  return body;
}

function normalizeUpstreamProvider(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  return t;
}

function mapProviderDisplayToSlug(display: string | null): string | null {
  if (!display) return null;
  const d = display.toLowerCase();
  if (d.includes("ai studio")) return PROVIDER_SLUG_AI_STUDIO;
  if (d === "google" || d.includes("vertex")) return PROVIDER_SLUG_VERTEX;
  return display;
}

async function streamRun(
  variant: VariantId,
  run: number,
  headers: Record<string, string>,
  requestBody: Record<string, unknown>,
  requestedProviderPolicy: Record<string, unknown> | null
): Promise<RunResult> {
  const requestStartMs = Date.now();
  let httpHeadersMs: number | null = null;
  let firstSseMs: number | null = null;
  let firstVisibleTokenMs: number | null = null;
  let outputText = "";
  let finishReason: string | null = null;
  let usageRaw: unknown = null;
  let httpStatus = 0;
  let error: string | undefined;
  let requestId: string | null = null;
  let generationId: string | null = null;
  let actualUpstreamProvider: string | null = null;
  let fallbackOccurred: boolean | null = null;

  try {
    const res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(600_000),
    });
    httpStatus = res.status;
    httpHeadersMs = Date.now() - requestStartMs;
    requestId =
      res.headers.get("x-request-id") ??
      res.headers.get("x-openrouter-request-id") ??
      null;
    generationId = res.headers.get("x-generation-id");

    if (!res.ok || !res.body) {
      error = await res.text().catch(() => `HTTP ${res.status}`);
      return {
        variant,
        run,
        cachePhase: run === 1 ? "cold" : "warm",
        requestId,
        generationId,
        requestedProviderPolicy,
        actualUpstreamProvider: null,
        httpStatus,
        error: error.slice(0, 500),
        fallbackOccurred: null,
        requestStartMs,
        httpHeadersMs,
        firstSseMs,
        firstVisibleTokenMs,
        totalLatencyMs: Date.now() - requestStartMs,
        promptTokens: 0,
        cachedTokens: 0,
        cacheRatio: 0,
        reasoningTokens: 0,
        completionTokens: 0,
        costUsd: null,
        finishReason: null,
        outputChars: 0,
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (firstSseMs == null) firstSseMs = Date.now() - requestStartMs;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (typeof ev.provider === "string" && ev.provider) {
          actualUpstreamProvider = normalizeUpstreamProvider(ev.provider);
        }
        if (ev.usage) usageRaw = ev.usage;
        const choice0 = Array.isArray(ev.choices) ? ev.choices[0] : null;
        const choice =
          choice0 && typeof choice0 === "object"
            ? (choice0 as Record<string, unknown>)
            : {};
        if (typeof choice.finish_reason === "string" && choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
        const delta = (choice.delta ?? {}) as Record<string, unknown>;
        const piece = typeof delta.content === "string" ? delta.content : "";
        if (piece) {
          if (firstVisibleTokenMs == null) {
            firstVisibleTokenMs = Date.now() - requestStartMs;
          }
          outputText += piece;
        }
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const usage = parseOpenRouterUsage(usageRaw, new Headers());
  const cacheRatio =
    usage.promptTokens > 0
      ? Math.round((usage.cacheReadTokens / usage.promptTokens) * 1000) / 1000
      : 0;
  const rawEstimated = openRouterUsdCostFromRates({
    modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    cacheReadTokens: usage.cacheReadTokens,
  });
  const costUsd =
    usage.upstreamCostUsd ??
    usage.cheaperInferenceBilledCostUsd ??
    (typeof rawEstimated === "number"
      ? rawEstimated
      : typeof (rawEstimated as { usdCost?: number | null })?.usdCost === "number"
        ? (rawEstimated as { usdCost: number }).usdCost
        : null);

  if (requestedProviderPolicy?.only && actualUpstreamProvider) {
    const pinned = requestedProviderPolicy.only as string[];
    const actualSlug = mapProviderDisplayToSlug(actualUpstreamProvider);
    if (pinned.length === 1 && actualSlug && actualSlug !== pinned[0]) {
      fallbackOccurred = true;
    } else if (pinned.length === 1 && actualSlug === pinned[0]) {
      fallbackOccurred = false;
    }
  }

  return {
    variant,
    run,
    cachePhase: run === 1 ? "cold" : "warm",
    requestId,
    generationId,
    requestedProviderPolicy,
    actualUpstreamProvider,
    httpStatus,
    error,
    fallbackOccurred,
    requestStartMs,
    httpHeadersMs,
    firstSseMs,
    firstVisibleTokenMs,
    totalLatencyMs: Date.now() - requestStartMs,
    promptTokens: usage.promptTokens,
    cachedTokens: usage.cacheReadTokens,
    cacheRatio,
    reasoningTokens: usage.reasoningTokens,
    completionTokens: usage.completionTokens,
    costUsd,
    finishReason,
    outputChars: [...outputText].length,
  };
}

type HistoricalRecovery = {
  run: number;
  upstreamProvider: "UNKNOWN";
  model: string;
  ttftMs: number | null;
  cachedTokens: number;
  costUsd: number | null;
  note: string;
};

function recoverHistoricalTrackB(): HistoricalRecovery[] {
  if (!fs.existsSync(TRACK_B_RUNS_PATH)) return [];
  const lines = fs.readFileSync(TRACK_B_RUNS_PATH, "utf8").trim().split("\n");
  const out: HistoricalRecovery[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Record<string, unknown>;
    if (row.path !== "OPENROUTER_DIRECT") continue;
    out.push({
      run: Number(row.run),
      upstreamProvider: "UNKNOWN",
      model: OPENROUTER_GEMINI_31_PRO_MODEL,
      ttftMs:
        typeof row.firstVisibleTokenMs === "number"
          ? row.firstVisibleTokenMs
          : null,
      cachedTokens: Number(row.cachedTokens ?? 0),
      costUsd:
        typeof row.upstreamCostUsd === "number"
          ? row.upstreamCostUsd
          : typeof row.estimatedCostUsd === "number"
            ? row.estimatedCostUsd
            : null,
      note: "Track B runs.jsonl lacks upstream provider metadata",
    });
  }
  return out;
}

type VariantSummary = {
  variant: VariantId;
  runs: number;
  ttft: ReturnType<typeof stats>;
  ttftWarm: ReturnType<typeof stats>;
  totalLatency: ReturnType<typeof stats>;
  promptTokens: ReturnType<typeof stats>;
  cacheRatio: ReturnType<typeof stats>;
  cacheRatioWarm: ReturnType<typeof stats>;
  costUsd: ReturnType<typeof stats>;
  actualProviders: string[];
  providerConfirmedRuns: number;
  rows: RunResult[];
};

function summarizeVariant(variant: VariantId, rows: RunResult[]): VariantSummary {
  const ok = rows.filter((r) => r.variant === variant && !r.error && r.httpStatus === 200);
  const ttftAll = ok.map((r) => r.firstVisibleTokenMs).filter((n): n is number => n != null);
  const ttftWarm = ok
    .filter((r) => r.cachePhase === "warm")
    .map((r) => r.firstVisibleTokenMs)
    .filter((n): n is number => n != null);
  const total = ok.map((r) => r.totalLatencyMs);
  const prompt = ok.map((r) => r.promptTokens).filter((n) => n > 0);
  const cacheAll = ok.map((r) => r.cacheRatio);
  const cacheWarm = ok
    .filter((r) => r.cachePhase === "warm")
    .map((r) => r.cacheRatio);
  const cost = ok.map((r) => r.costUsd).filter((n): n is number => n != null && n > 0);
  const providers = [
    ...new Set(
      ok
        .map((r) => r.actualUpstreamProvider)
        .filter((p): p is string => Boolean(p))
    ),
  ];
  return {
    variant,
    runs: ok.length,
    ttft: stats(ttftAll),
    ttftWarm: stats(ttftWarm),
    totalLatency: stats(total),
    promptTokens: stats(prompt),
    cacheRatio: stats(cacheAll),
    cacheRatioWarm: stats(cacheWarm),
    costUsd: stats(cost),
    actualProviders: providers,
    providerConfirmedRuns: ok.filter((r) => r.actualUpstreamProvider).length,
    rows: ok,
  };
}

function classifyRootCause(summaries: VariantSummary[]): {
  sub10: boolean;
  sub5: boolean;
  rootCause: string;
  nextRecommendation: string;
} {
  const def = summaries.find((s) => s.variant === "DEFAULT");
  const lat = summaries.find((s) => s.variant === "LATENCY_SORT");
  const vtx = summaries.find((s) => s.variant === "GOOGLE_VERTEX_PIN");
  const ais = summaries.find((s) => s.variant === "GOOGLE_AI_STUDIO_PIN");

  const vtxMedian = vtx?.ttft.median ?? Infinity;
  const defMedian = def?.ttft.median ?? 0;
  const latMedian = lat?.ttft.median ?? Infinity;
  const aisMedian = ais?.ttft.median ?? Infinity;

  const sub10 = [defMedian, latMedian, vtxMedian, aisMedian].some(
    (v) => v > 0 && v < 10_000
  );
  const sub5 = [defMedian, latMedian, vtxMedian, aisMedian].some(
    (v) => v > 0 && v < 5_000
  );

  let rootCause = "INCONCLUSIVE";
  let nextRecommendation = "OTHER";

  if (vtxMedian <= 8_000 && aisMedian >= 15_000) {
    rootCause = "OPENROUTER PROVIDER ROUTING — 3~4 SECOND CLASS TTFT REPRODUCED";
    nextRecommendation = "OR_VERTEX_HYBRID";
  } else if (vtxMedian >= 8_000 && vtxMedian <= 15_000) {
    rootCause =
      "PROVIDER ROUTING SIGNIFICANT + LONG-CONTEXT PREFILL LIKELY — GOOGLE NATIVE AB NEXT";
    nextRecommendation = "GOOGLE_NATIVE_AB";
  } else if (vtxMedian >= 20_000 && aisMedian >= 20_000) {
    rootCause = "OPENROUTER ROUTING ALONE INSUFFICIENT — DIRECT VERTEX / GEMINI DEV API BASELINE NEEDED";
    nextRecommendation = "GOOGLE_NATIVE_AB";
  } else if (latMedian < defMedian * 0.6 && latMedian <= vtxMedian * 1.2) {
    rootCause = "LATENCY SORT SUFFICIENT — HARD PIN MAY NOT BE REQUIRED";
    nextRecommendation = "OR_LATENCY_ROUTING";
  } else if (vtxMedian < defMedian * 0.7) {
    rootCause = "OPENROUTER PROVIDER ROUTING — VERTEX FASTER THAN DEFAULT";
    nextRecommendation = "OR_VERTEX_HYBRID";
  }

  return { sub10, sub5, rootCause, nextRecommendation };
}

async function fetchProviderSlugs(): Promise<Record<string, string>> {
  const res = await fetch("https://openrouter.ai/api/v1/providers");
  const json = (await res.json()) as { data?: { slug: string; name: string }[] };
  const out: Record<string, string> = {};
  for (const p of json.data ?? []) {
    if (p.slug === PROVIDER_SLUG_VERTEX || p.slug === PROVIDER_SLUG_AI_STUDIO) {
      out[p.slug] = p.name;
    }
  }
  return out;
}

async function main() {
  const orKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!orKey) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const providerSlugs = await fetchProviderSlugs();
  fs.writeFileSync(
    path.join(OUT_DIR, "provider-slugs.json"),
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        source: "GET https://openrouter.ai/api/v1/providers",
        slugs: providerSlugs,
        usedInAudit: {
          vertex: PROVIDER_SLUG_VERTEX,
          aiStudio: PROVIDER_SLUG_AI_STUDIO,
        },
      },
      null,
      2
    )
  );

  const historical = recoverHistoricalTrackB();
  fs.writeFileSync(
    path.join(OUT_DIR, "historical-track-b-recovery.json"),
    JSON.stringify(historical, null, 2)
  );

  const variantFilter = (process.env.VARIANTS ?? "A,B,C,D")
    .split(",")
    .map((v) => v.trim().toUpperCase());
  const includeE = variantFilter.includes("E") || process.env.INCLUDE_VARIANT_E === "1";
  let variants = resolveVariants(includeE);
  const letterMap: Record<string, VariantId> = {
    A: "DEFAULT",
    B: "LATENCY_SORT",
    C: "GOOGLE_VERTEX_PIN",
    D: "GOOGLE_AI_STUDIO_PIN",
    E: "VERTEX_PREFERRED_FALLBACK",
  };
  if (!variantFilter.includes("ALL")) {
    const allowed = new Set(
      variantFilter.map((l) => letterMap[l]).filter(Boolean)
    );
    variants = variants.filter((v) => allowed.has(v.id));
  }

  const { built, baseRequestBody } = buildFrozenPayload();
  const headers = buildOpenRouterHeaders(orKey);

  const fixtureMeta = {
    frozenAt: new Date().toISOString(),
    completedTurns: COMPLETED_TURNS,
    summarizedThrough: SUMMARIZED_THROUGH,
    measureUserMessage: MEASURE_USER,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    estimatedInputTokens: built.meta.estimatedInputTokens,
    payloadChars: JSON.stringify(baseRequestBody).length,
    model: OPENROUTER_GEMINI_31_PRO_MODEL,
    reasoning: "low (production policy via assemblePrimaryRpRequest)",
    temperature: (baseRequestBody as { temperature?: number }).temperature ?? null,
    stream: true,
    providerSlugs,
  };
  fs.writeFileSync(path.join(OUT_DIR, "fixture-meta.json"), JSON.stringify(fixtureMeta, null, 2));

  const runsPath = path.join(OUT_DIR, "runs.jsonl");
  if (fs.existsSync(runsPath)) fs.unlinkSync(runsPath);

  const allRuns: RunResult[] = [];
  for (const v of variants) {
    console.log(`\n======== ${v.id} (${v.label}) ========`);
    console.log(`  policy: ${v.policyDescription}`);
    for (let run = 1; run <= RUNS; run++) {
      process.stdout.write(`  run ${run}/${RUNS} (${run === 1 ? "cold" : "warm"})...`);
      const body = applyProviderPolicy(baseRequestBody, v.requestedProviderPolicy);
      const result = await streamRun(v.id, run, headers, body, v.requestedProviderPolicy);
      allRuns.push(result);
      fs.appendFileSync(runsPath, JSON.stringify(result) + "\n");
      console.log(
        ` ttft=${result.firstVisibleTokenMs ?? "n/a"}ms provider=${result.actualUpstreamProvider ?? "UNKNOWN"} cache=${result.cacheRatio} cost=${result.costUsd ?? "n/a"}`
      );
      if (run < RUNS) await new Promise((r) => setTimeout(r, 4000));
    }
  }

  const summaries = variants.map((v) => summarizeVariant(v.id, allRuns));
  const fastest = [...summaries].sort((a, b) => a.ttft.median - b.ttft.median)[0];
  const mostStable = [...summaries].sort((a, b) => a.ttft.max - b.ttft.max)[0];
  const cheapest = [...summaries].sort(
    (a, b) => (a.costUsd.median || Infinity) - (b.costUsd.median || Infinity)
  )[0];
  const classification = classifyRootCause(summaries);

  const defSum = summaries.find((s) => s.variant === "DEFAULT");
  const vtxSum = summaries.find((s) => s.variant === "GOOGLE_VERTEX_PIN");
  const ciMedianTtft = 38_100;
  const vertexVsDefault =
    defSum && vtxSum && vtxSum.ttft.median > 0
      ? Math.round(defSum.ttft.median - vtxSum.ttft.median)
      : null;
  const vertexVsCi =
    vtxSum && vtxSum.ttft.median > 0
      ? Math.round(ciMedianTtft - vtxSum.ttft.median)
      : null;

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "Track-B.1-OpenRouter-Provider-Routing-Audit",
    fixture: fixtureMeta,
    providerSlugs,
    historicalTrackBRecovery: historical,
    variants: variants.map((v) => ({
      id: v.id,
      label: v.label,
      policyDescription: v.policyDescription,
    })),
    runCountPerVariant: RUNS,
    summaries,
    rawRuns: allRuns,
    decision: {
      fastestRoute: fastest?.variant ?? "N/A",
      mostStableRoute: mostStable?.variant ?? "N/A",
      cheapestRoute: cheapest?.variant ?? "N/A",
      vertexVsDefaultTtftDeltaMs: vertexVsDefault,
      vertexVsCiTtftDeltaMs: vertexVsCi,
      sub10SecondTtftReproduced: classification.sub10,
      sub5SecondTtftReproduced: classification.sub5,
      rootCauseClassification: classification.rootCause,
      nextRecommendation: classification.nextRecommendation,
      productionChanged: false,
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

  function variantBlock(id: VariantId, label: string): string[] {
    const sum = summaries.find((s) => s.variant === id);
    if (!sum) return [label, "STATUS: NOT_RUN", ""];
    return [
      label,
      `RUNS: ${sum.runs}`,
      `MEDIAN_TTFT: ${sum.ttft.median} ms`,
      `MIN: ${sum.ttft.min} ms`,
      `MAX: ${sum.ttft.max} ms`,
      `MEDIAN_TTFT_WARM (run 2+): ${sum.ttftWarm.median} ms`,
      `CACHE_RATIO (all min/med/max): ${sum.cacheRatio.min} / ${sum.cacheRatio.median} / ${sum.cacheRatio.max}`,
      `CACHE_RATIO_WARM (run 2+ med): ${sum.cacheRatioWarm.median}`,
      `ACTUAL_PROVIDERS: ${sum.actualProviders.join(", ") || "UNKNOWN"}`,
      `PROVIDER_CONFIRMED_RUNS: ${sum.providerConfirmedRuns}/${sum.runs}`,
      `MEDIAN_COST: ${sum.costUsd.median || "n/a"}`,
      "",
    ];
  }

  const textReport = [
    "GEMINI31_OPENROUTER_PROVIDER_ROUTING_AUDIT",
    `FIXTURE_PROMPT_TOKENS: ${defSum?.promptTokens.median ?? fixtureMeta.estimatedInputTokens}`,
    `MODEL: ${OPENROUTER_GEMINI_31_PRO_MODEL}`,
    `REASONING: LOW`,
    `TARGET_OUTPUT_CHANGED: NO`,
    "",
    "HISTORICAL_TRACK_B_OPENROUTER_DIRECT (upstream recovery):",
    ...historical.map(
      (h) =>
        `  RUN ${h.run}: UPSTREAM=${h.upstreamProvider} TTFT=${h.ttftMs}ms CACHE=${h.cachedTokens} COST=${h.costUsd}`
    ),
    "",
    ...variantBlock("DEFAULT", "DEFAULT"),
    ...variantBlock("LATENCY_SORT", "LATENCY_SORT"),
    ...variantBlock("GOOGLE_VERTEX_PIN", "GOOGLE_VERTEX_PIN"),
    ...variantBlock("GOOGLE_AI_STUDIO_PIN", "GOOGLE_AI_STUDIO_PIN"),
    ...(summaries.some((s) => s.variant === "VERTEX_PREFERRED_FALLBACK")
      ? variantBlock("VERTEX_PREFERRED_FALLBACK", "VERTEX_PREFERRED_FALLBACK")
      : []),
    `FASTEST_ROUTE: ${fastest?.variant ?? "N/A"}`,
    `MOST_STABLE_ROUTE: ${mostStable?.variant ?? "N/A"}`,
    `CHEAPEST_ROUTE: ${cheapest?.variant ?? "N/A"}`,
    `VERTEX_VS_DEFAULT_TTFT_DELTA: ${vertexVsDefault != null ? `${vertexVsDefault} ms` : "N/A"}`,
    `VERTEX_VS_CI_TTFT_DELTA: ${vertexVsCi != null ? `${vertexVsCi} ms` : "N/A"}`,
    `SUB_10_SECOND_TTFT_REPRODUCED: ${classification.sub10 ? "YES" : "NO"}`,
    `SUB_5_SECOND_TTFT_REPRODUCED: ${classification.sub5 ? "YES" : "NO"}`,
    `ROOT_CAUSE_CLASSIFICATION: ${classification.rootCause}`,
    `NEXT_RECOMMENDATION: ${classification.nextRecommendation}`,
    `PRODUCTION_CHANGED: NO`,
    "",
    "RAW RUN TABLE:",
    "VARIANT|RUN|PHASE|REQUEST_ID|POLICY|UPSTREAM|PROMPT|CACHED|CACHE_RATIO|REASONING|COMPLETION|HTTP_HDR_MS|FIRST_SSE_MS|TTFT_MS|TOTAL_MS|COST|ERROR|FALLBACK",
    ...allRuns.map((r) =>
      [
        r.variant,
        r.run,
        r.cachePhase,
        r.requestId ?? "",
        r.requestedProviderPolicy ? JSON.stringify(r.requestedProviderPolicy) : "default",
        r.actualUpstreamProvider ?? "UNKNOWN",
        r.promptTokens,
        r.cachedTokens,
        r.cacheRatio,
        r.reasoningTokens,
        r.completionTokens,
        r.httpHeadersMs ?? "",
        r.firstSseMs ?? "",
        r.firstVisibleTokenMs ?? "",
        r.totalLatencyMs,
        r.costUsd ?? "",
        r.error ?? "",
        r.fallbackOccurred ?? "",
      ].join("|")
    ),
  ].join("\n");

  fs.writeFileSync(
    path.join(OUT_DIR, "GEMINI31_OPENROUTER_PROVIDER_ROUTING_AUDIT.txt"),
    textReport
  );

  const mdReport = [
    "# Gemini 3.1 Pro — OpenRouter Provider Routing Audit (Track B.1)",
    "",
    "## Comparison table",
    "",
    "| Route | Median TTFT | Min | Max | Warm cache (run 2+ med) | Median cost | Actual providers |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...summaries.map(
      (s) =>
        `| ${s.variant} | ${s.ttft.median} | ${s.ttft.min} | ${s.ttft.max} | ${s.cacheRatioWarm.median} | ${s.costUsd.median || "n/a"} | ${s.actualProviders.join(", ") || "UNKNOWN"} |`
    ),
    "",
    "## Historical Track B recovery",
    "",
    "Prior OpenRouter direct runs (Track B) did **not** record upstream provider metadata → all **UNKNOWN**.",
    "",
    "```",
    textReport,
    "```",
    "",
    "**STOP** — No production provider migration PR.",
  ].join("\n");

  fs.writeFileSync(
    path.join(OUT_DIR, "GEMINI31_OPENROUTER_PROVIDER_ROUTING_AUDIT.md"),
    mdReport
  );

  console.log("\n" + textReport);
  console.log("\nWrote", path.join(OUT_DIR, "report.json"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
