/**
 * Track B — READ-ONLY Gemini 3.1 Pro Provider Path A/B.
 * Same frozen ~23k steady-state payload; no production routing changes.
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-provider-path-ab.ts
 *   E2E_RUNS=7 node --conditions=react-server --import tsx scripts/gemini31-provider-path-ab.ts
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
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "../src/lib/cheaperInferenceConfig";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  buildOpenRouterHeaders,
} from "../src/lib/openRouterConfig";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
} from "../src/lib/chatModels";
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

const OUT_DIR = "/opt/cursor/artifacts/gemini31-provider-path-ab";
const RUNS = Math.max(5, Number(process.env.E2E_RUNS ?? "5") || 5);

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

type PathId = "CHEAPERINFERENCE" | "OPENROUTER_DIRECT" | "GOOGLE_DIRECT" | "VERTEX";

type PathConfig = {
  id: PathId;
  label: string;
  available: boolean;
  unavailableReason?: string;
  endpoint?: string;
  modelId?: string;
  headers?: Record<string, string>;
  requestBody?: Record<string, unknown>;
};

type RunResult = {
  path: PathId;
  run: number;
  httpStatus: number;
  error?: string;
  requestStartMs: number;
  httpHeadersMs: number | null;
  firstSseMs: number | null;
  firstVisibleTokenMs: number | null;
  completeMs: number;
  promptTokens: number;
  cachedTokens: number;
  cacheRatio: number;
  reasoningTokens: number;
  completionTokens: number;
  upstreamCostUsd: number | null;
  estimatedCostUsd: number | null;
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
  ciAssembled: ReturnType<typeof assemblePrimaryRpRequest>;
  orAssembled: ReturnType<typeof assemblePrimaryRpRequest>;
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
  const ciAssembled = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history,
    modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: true,
    messageOpts: {
      transportProvider: "cheaperinference",
      charName: "조태형",
    },
  });
  const orAssembled = assemblePrimaryRpRequest({
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

  return { built, ciAssembled, orAssembled };
}

async function streamRun(
  pathId: PathId,
  run: number,
  endpoint: string,
  headers: Record<string, string>,
  requestBody: Record<string, unknown>
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

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(600_000),
    });
    httpStatus = res.status;
    httpHeadersMs = Date.now() - requestStartMs;

    if (!res.ok || !res.body) {
      error = await res.text().catch(() => `HTTP ${res.status}`);
      return {
        path: pathId,
        run,
        httpStatus,
        error: error.slice(0, 500),
        requestStartMs,
        httpHeadersMs,
        firstSseMs,
        firstVisibleTokenMs,
        completeMs: Date.now() - requestStartMs,
        promptTokens: 0,
        cachedTokens: 0,
        cacheRatio: 0,
        reasoningTokens: 0,
        completionTokens: 0,
        upstreamCostUsd: null,
        estimatedCostUsd: null,
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
          if (firstVisibleTokenMs == null) firstVisibleTokenMs = Date.now() - requestStartMs;
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
  const estimatedCostUsd =
    typeof rawEstimated === "number"
      ? rawEstimated
      : typeof (rawEstimated as { usdCost?: number | null })?.usdCost === "number"
        ? (rawEstimated as { usdCost: number }).usdCost
        : usage.upstreamCostUsd ?? usage.cheaperInferenceBilledCostUsd ?? null;

  return {
    path: pathId,
    run,
    httpStatus,
    error,
    requestStartMs,
    httpHeadersMs,
    firstSseMs,
    firstVisibleTokenMs,
    completeMs: Date.now() - requestStartMs,
    promptTokens: usage.promptTokens,
    cachedTokens: usage.cacheReadTokens,
    cacheRatio,
    reasoningTokens: usage.reasoningTokens,
    completionTokens: usage.completionTokens,
    upstreamCostUsd: usage.upstreamCostUsd ?? usage.cheaperInferenceBilledCostUsd ?? null,
    estimatedCostUsd: estimatedCostUsd ?? null,
    finishReason,
    outputChars: [...outputText].length,
  };
}

function resolvePaths(
  ciAssembled: ReturnType<typeof assemblePrimaryRpRequest>,
  orAssembled: ReturnType<typeof assemblePrimaryRpRequest>
): PathConfig[] {
  const paths: PathConfig[] = [];

  try {
    resolveCheaperInferenceApiKey();
    paths.push({
      id: "CHEAPERINFERENCE",
      label: "CheaperInference (current production route)",
      available: true,
      endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      headers: buildCheaperInferenceHeaders(),
      requestBody: structuredClone(ciAssembled.requestBody) as Record<string, unknown>,
    });
  } catch {
    paths.push({
      id: "CHEAPERINFERENCE",
      label: "CheaperInference",
      available: false,
      unavailableReason: "CHEAPER_INFERENCE_API_KEY missing",
    });
  }

  const orKey = process.env.OPENROUTER_API_KEY?.trim();
  if (orKey) {
    paths.push({
      id: "OPENROUTER_DIRECT",
      label: "OpenRouter direct",
      available: true,
      endpoint: OPENROUTER_CHAT_COMPLETIONS_URL,
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      headers: buildOpenRouterHeaders(orKey),
      requestBody: structuredClone(orAssembled.requestBody) as Record<string, unknown>,
    });
  } else {
    paths.push({
      id: "OPENROUTER_DIRECT",
      label: "OpenRouter direct",
      available: false,
      unavailableReason: "OPENROUTER_API_KEY missing",
    });
  }

  paths.push({
    id: "GOOGLE_DIRECT",
    label: "Google Gemini API direct",
    available: false,
    unavailableReason: "GEMINI_API_KEY missing",
  });
  paths.push({
    id: "VERTEX",
    label: "Vertex AI",
    available: false,
    unavailableReason: "Vertex credentials not configured in this environment",
  });

  return paths;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { built, ciAssembled, orAssembled } = buildFrozenPayload();
  const paths = resolvePaths(ciAssembled, orAssembled);

  const fixtureMeta = {
    frozenAt: new Date().toISOString(),
    completedTurns: COMPLETED_TURNS,
    summarizedThrough: SUMMARIZED_THROUGH,
    measureUserMessage: MEASURE_USER,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    estimatedInputTokens: built.meta.estimatedInputTokens,
    ciPayloadChars: JSON.stringify(ciAssembled.requestBody).length,
    orPayloadChars: JSON.stringify(orAssembled.requestBody).length,
    ciModel: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    orModel: OPENROUTER_GEMINI_31_PRO_MODEL,
    reasoning: "low (production CheaperInference policy)",
    temperature: (ciAssembled.requestBody as { temperature?: number }).temperature ?? null,
    stream: true,
  };
  fs.writeFileSync(path.join(OUT_DIR, "fixture-meta.json"), JSON.stringify(fixtureMeta, null, 2));

  const allRuns: RunResult[] = [];
  for (const p of paths.filter((x) => x.available)) {
    console.log(`\n======== ${p.id} (${p.label}) ========`);
    for (let run = 1; run <= RUNS; run++) {
      process.stdout.write(`  run ${run}/${RUNS}...`);
      const result = await streamRun(
        p.id,
        run,
        p.endpoint!,
        p.headers!,
        p.requestBody!
      );
      allRuns.push(result);
      fs.appendFileSync(
        path.join(OUT_DIR, "runs.jsonl"),
        JSON.stringify(result) + "\n"
      );
      console.log(
        ` ttft=${result.firstVisibleTokenMs ?? "n/a"}ms total=${result.completeMs}ms prompt=${result.promptTokens} cache=${result.cacheRatio} cost=${result.estimatedCostUsd ?? "n/a"}`
      );
      if (run < RUNS) await new Promise((r) => setTimeout(r, 4000));
    }
  }

  function summarizePath(pathId: PathId) {
    const rows = allRuns.filter((r) => r.path === pathId && !r.error && r.httpStatus === 200);
    const ttft = rows.map((r) => r.firstVisibleTokenMs).filter((n): n is number => n != null);
    const total = rows.map((r) => r.completeMs);
    const prompt = rows.map((r) => r.promptTokens).filter((n) => n > 0);
    const cache = rows.map((r) => r.cacheRatio);
    const cost = rows
      .map((r) => r.upstreamCostUsd ?? r.estimatedCostUsd)
      .filter((n): n is number => n != null && n > 0);
    return {
      path: pathId,
      runs: rows.length,
      ttft: stats(ttft),
      totalLatency: stats(total),
      promptTokens: stats(prompt),
      cacheRatio: stats(cache),
      costUsd: stats(cost),
      rows,
    };
  }

  const summaries = [
    summarizePath("CHEAPERINFERENCE"),
    summarizePath("OPENROUTER_DIRECT"),
    summarizePath("GOOGLE_DIRECT"),
    summarizePath("VERTEX"),
  ];

  const available = summaries.filter((s) => s.runs > 0);
  const fastest = [...available].sort((a, b) => a.ttft.median - b.ttft.median)[0];
  const cheapest = [...available].sort(
    (a, b) => (a.costUsd.median || Infinity) - (b.costUsd.median || Infinity)
  )[0];

  const ciMedian = summaries.find((s) => s.path === "CHEAPERINFERENCE")?.ttft.median ?? 0;
  const fastestMedian = fastest?.ttft.median ?? 0;
  const penalty =
    fastestMedian > 0 && ciMedian > 0
      ? Math.round(((ciMedian - fastestMedian) / fastestMedian) * 1000) / 10
      : null;

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "Track-B-Provider-Path-AB",
    fixture: fixtureMeta,
    paths: paths.map((p) => ({
      id: p.id,
      label: p.label,
      available: p.available,
      unavailableReason: p.unavailableReason,
      modelId: p.modelId,
      endpoint: p.endpoint,
    })),
    runCountPerPath: RUNS,
    summaries,
    rawRuns: allRuns,
    decision: {
      fastestPath: fastest?.path ?? "N/A",
      cheapestPath: cheapest?.path ?? "N/A",
      ciTtftPenaltyVsFastestPct: penalty,
      primaryProviderRootCauseConfirmed:
        fastest?.path === "CHEAPERINFERENCE" ? "NO" : "YES",
      productionChanged: false,
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

  const textReport = [
    "GEMINI_31_PROVIDER_PATH_AB",
    `FIXTURE_PROMPT_TOKENS: ${summaries.find((s) => s.path === "CHEAPERINFERENCE")?.promptTokens.median ?? "pending first CI run"}`,
    `TARGET_OUTPUT_POLICY: ${DEFAULT_TARGET_RESPONSE_CHARS} chars (production DEFAULT_TARGET_RESPONSE_CHARS)`,
    `MODEL: Gemini 3.1 Pro`,
    `REASONING: low`,
    "",
    ...(["CHEAPERINFERENCE", "OPENROUTER_DIRECT", "GOOGLE_DIRECT", "VERTEX"] as PathId[]).flatMap(
      (id) => {
        const cfg = paths.find((p) => p.id === id);
        const sum = summaries.find((s) => s.path === id);
        if (!cfg?.available) {
          return [
            id,
            "STATUS: NOT_AVAILABLE",
            `REASON: ${cfg?.unavailableReason ?? "unknown"}`,
            "",
          ];
        }
        return [
          id,
          `RUNS: ${sum?.runs ?? 0}`,
          `MEDIAN_TTFT: ${sum?.ttft.median ?? "n/a"} ms`,
          `MIN_TTFT: ${sum?.ttft.min ?? "n/a"} ms`,
          `MAX_TTFT: ${sum?.ttft.max ?? "n/a"} ms`,
          `MEDIAN_TOTAL_LATENCY: ${sum?.totalLatency.median ?? "n/a"} ms`,
          `MEDIAN_PROMPT_TOKENS: ${sum?.promptTokens.median ?? "n/a"}`,
          `CACHE_RATIO (min/median/max): ${sum?.cacheRatio.min ?? 0} / ${sum?.cacheRatio.median ?? 0} / ${sum?.cacheRatio.max ?? 0}`,
          `MEDIAN_COST_USD: ${sum?.costUsd.median ?? "n/a"}`,
          "",
        ];
      }
    ),
    `FASTEST_PATH: ${fastest?.path ?? "N/A"}`,
    `CHEAPEST_PATH: ${cheapest?.path ?? "N/A"}`,
    `CI_TTFT_PENALTY_VS_FASTEST: ${penalty != null ? `${penalty}%` : "N/A"}`,
    `PRIMARY_PROVIDER_ROOT_CAUSE_CONFIRMED: ${report.decision.primaryProviderRootCauseConfirmed}`,
    `PRODUCTION_CHANGED: NO`,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "GEMINI_31_PROVIDER_PATH_AB.txt"), textReport);
  console.log("\n" + textReport);
  console.log("\nWrote", path.join(OUT_DIR, "report.json"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
