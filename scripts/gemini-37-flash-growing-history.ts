/**
 * Gemini 3.7 Flash — production-path growing-history billing live test.
 * buildContext → assemblePrimaryRpRequest → Cheaper Inference.
 * No 3.7-specific prompt, no length adapter, retry/continuation/recovery = 0.
 *
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-growing-history.ts
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import fs from "node:fs";
import path from "node:path";
import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
} from "../src/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "../src/lib/chatModels";
import { GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE } from "../src/lib/gemini31UserAgencyAdapter";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { openRouterUsdCostFromRates } from "../src/lib/openRouterModelPricing";
import { getEffectiveKrwPerUsd } from "../src/lib/exchangeRate";
import {
  computeGemini37FlashUserChargeBreakdown,
  resolveGemini37FlashBilledOutputTokens,
} from "../src/lib/gemini37FlashPricing";
import { computeTurnBilling } from "../src/lib/points";
import type { ChatMsg } from "../src/lib/ai";

const MODEL = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const OUT_DIR = path.join(process.cwd(), "docs/audits/gemini-37-flash-pricing");
const ARTIFACT_DIR = path.join("/opt/cursor/artifacts", "gemini-37-flash-pricing");

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
] as const;

const JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

function save(dir: string, name: string, content: string | object) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, name),
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    "utf8"
  );
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function catalogUsd(opts: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number {
  return openRouterUsdCostFromRates({
    modelId: MODEL,
    promptTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
    cacheReadTokens: opts.cacheReadTokens,
    cacheWriteTokens: opts.cacheWriteTokens,
  }).usdCost;
}

function measureModelSpecificPromptChars(system: string) {
  return {
    GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS: 0,
    gemini31AgencyInjected: system.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE),
    gemini37NamedPromptPresent: /Gemini 3\.7|GEMINI 3\.7|3\.7 Flash RP adapter/i.test(system),
    gemini37LengthAdapterPresent: /길이 어댑터|length adapter|targetResponseChars/i.test(system) &&
      /Gemini 3\.7/.test(system),
  };
}

function buildTurnContext(history: ChatMsg[], currentUserMessage: string) {
  return buildContext({
    charName: "조태형",
    contentKind: "character",
    chunks: [
      {
        id: "c18-identity",
        characterId: "18",
        content: JO_TAEHYUNG_CARD,
        category: "identity",
        importance: "CRITICAL",
        tokenCount: 200,
        keywords: ["조태형", "센티넬"],
      },
      {
        id: "c18-world",
        characterId: "18",
        content: "에이지스 컨트롤 본부. 센티넬/가이드. 중앙 로비, 지원국, 동기화 챔버.",
        category: "world",
        importance: "CONTEXTUAL",
        tokenCount: 40,
        keywords: ["에이지스", "로비"],
      },
    ],
    userNickname: "렌",
    personaDisplayName: "렌",
    userPersona: "이름/호칭: 렌\n성별: 남성",
    userPersonaGender: "male",
    shortTermHistory: history,
    currentUserMessage,
    nsfw: false,
    gender: "male",
    provider: "cheaperinference",
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    completedTurns: history.filter((m) => m.role === "assistant").length,
    narrativePov: { mode: "third_person", povCharacterName: "조태형" },
  });
}

async function callOnce(requestBody: Record<string, unknown>) {
  const started = Date.now();
  let ttftMs: number | null = null;
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(),
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const httpStatus = res.status;
  if (!res.body) {
    return {
      httpStatus,
      latencyMs: Date.now() - started,
      ttftMs,
      finishReason: null,
      resolvedModel: null,
      text: "",
      usageRaw: null,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finishReason: string | null = null;
  let resolvedModel: string | null = null;
  let usageRaw: unknown = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (typeof ev.model === "string") resolvedModel = ev.model;
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
        if (ttftMs == null) ttftMs = Date.now() - started;
        text += piece;
      }
    }
  }
  return {
    httpStatus,
    latencyMs: Date.now() - started,
    ttftMs,
    finishReason,
    resolvedModel,
    text,
    usageRaw,
  };
}

async function runTurn(label: string, history: ChatMsg[], userLine: string) {
  const built = buildTurnContext(history, userLine);
  const system = built.systemPrompt ?? "";
  const promptAudit = measureModelSpecificPromptChars(system);
  const assembled = assemblePrimaryRpRequest({
    system,
    history: built.history,
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: true,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: built.openRouterSystemSplit,
      charName: "조태형",
    },
  });
  const requestBody = assembled.requestBody as Record<string, unknown>;
  const resp = await callOnce(requestBody);
  const usage = parseOpenRouterUsage(resp.usageRaw);
  const billedOutputTokens = resolveGemini37FlashBilledOutputTokens({
    completionTokens: usage.completionTokens,
    reasoningTokens: usage.reasoningTokens,
  });
  const contentTokens = Math.max(0, usage.completionTokens - (usage.reasoningTokens || 0));
  const pricing = computeGemini37FlashUserChargeBreakdown({
    inputTokens: usage.promptTokens,
    billedOutputTokens,
  });
  const billing = computeTurnBilling({
    provider: "cheaperinference",
    openRouterModelId: MODEL,
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    reasoningTokens: usage.reasoningTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    upstreamCostUsd: usage.upstreamCostUsd,
    apiPromptTokens: usage.promptTokens,
    apiCompletionTokens: usage.completionTokens,
  });
  const krwPerUsd = getEffectiveKrwPerUsd();
  const catalog = catalogUsd({
    inputTokens: usage.promptTokens,
    outputTokens: billedOutputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  });
  const upstreamUsd = usage.upstreamCostUsd ?? null;
  const apiRawCostUsd = upstreamUsd != null && upstreamUsd > 0 ? upstreamUsd : catalog;
  const apiRawCostKrw = apiRawCostUsd * krwPerUsd;
  const mainUserCharge = pricing.totalPoints;
  const widgetCharge = 0;
  const finalUserCharge = mainUserCharge + widgetCharge;
  const realizedGrossMarginPct =
    finalUserCharge > 0 ? round1((1 - apiRawCostKrw / finalUserCharge) * 100) : null;
  return {
    label,
    userLine,
    system,
    requestBody,
    resp,
    usage,
    promptAudit,
    row: {
      turn: label,
      visibleOutputChars: [...resp.text.replace(/\r/g, "")].length,
      apiInputTokens: usage.promptTokens,
      billedOutputTokens,
      contentTokens,
      reasoningTokens: usage.reasoningTokens || 0,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      standardInputTokens: usage.standardInputTokens,
      cacheHitPct:
        usage.promptTokens > 0
          ? round1((usage.cacheReadTokens / usage.promptTokens) * 100)
          : 0,
      upstreamCostUsd: upstreamUsd,
      apiRawCostUsd: round3(apiRawCostUsd),
      apiRawCostKrw: round3(apiRawCostKrw),
      apiRawCostSource:
        upstreamUsd != null && upstreamUsd > 0 ? "provider_reported" : "fallback_catalog",
      mainUserCharge,
      widgetCharge,
      widgetStatus: "NOT_INVOKED",
      finalUserCharge,
      realizedGrossMarginPct,
      latencyMs: resp.latencyMs,
      ttftMs: resp.ttftMs,
      finishReason: resp.finishReason,
      httpStatus: resp.httpStatus,
      reasoningEffort: requestBody.reasoning_effort ?? null,
      maxTokens: requestBody.max_tokens ?? null,
      billingMatchesHook: billing.total === mainUserCharge,
      promptAudit,
    },
  };
}

function competitorMarginTable(krwPerUsd: number) {
  const input = 22_947;
  const output = 3_897;
  const userPoints = 60;
  const rows = [0, 0.25, 0.5, 0.75].map((hit) => {
    const cacheRead = Math.round(input * hit);
    const usd = catalogUsd({
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
    });
    const krw = usd * krwPerUsd;
    return {
      cacheHit: `${Math.round(hit * 100)}%`,
      cacheReadTokens: cacheRead,
      standardInputTokens: input - cacheRead,
      catalogUsd: round3(usd),
      catalogKrw: round3(krw),
      userPoints,
      marginPct: round1((1 - krw / userPoints) * 100),
    };
  });
  return {
    fixture: { input, billedOutput: output, competitorPoints: 62, ourPoints: userPoints },
    krwPerUsd: round3(krwPerUsd),
    rows,
  };
}

function bandAverage(rows: Array<{ apiInputTokens: number; finalUserCharge: number; apiRawCostKrw: number }>) {
  const bands = [
    { label: "30K", min: 25_001, max: 35_000 },
    { label: "40K", min: 35_001, max: 45_000 },
    { label: "50K", min: 45_001, max: 55_000 },
    { label: "60K", min: 55_001, max: 65_000 },
    { label: "70K+", min: 65_001, max: Number.POSITIVE_INFINITY },
  ];
  return bands.map((band) => {
    const hits = rows.filter((r) => r.apiInputTokens >= band.min && r.apiInputTokens <= band.max);
    const n = hits.length;
    const avgUser =
      n > 0 ? round1(hits.reduce((s, r) => s + r.finalUserCharge, 0) / n) : null;
    const avgRaw =
      n > 0 ? round3(hits.reduce((s, r) => s + r.apiRawCostKrw, 0) / n) : null;
    return { band: band.label, turns: n, avgUserCharge: avgUser, avgApiRawCostKrw: avgRaw };
  });
}

async function main() {
  if (!process.env.CHEAPER_INFERENCE_API_KEY) {
    throw new Error("CHEAPER_INFERENCE_API_KEY is required");
  }

  const history: ChatMsg[] = [
    { role: "assistant", content: TERRA_PROMPT_CANARY_GREETING_NEUTRAL },
  ];
  const turns = [];
  for (let i = 0; i < USER_TURNS.length; i += 1) {
    const label = `T${i + 1}`;
    const userLine = USER_TURNS[i];
    const turn = await runTurn(label, history, userLine);
    turns.push(turn);
    history.push({ role: "user", content: userLine });
    history.push({ role: "assistant", content: turn.resp.text });
    console.log(
      JSON.stringify({
        turn: label,
        chars: turn.row.visibleOutputChars,
        input: turn.row.apiInputTokens,
        output: turn.row.billedOutputTokens,
        cacheRead: turn.row.cacheReadTokens,
        charge: turn.row.finalUserCharge,
        margin: turn.row.realizedGrossMarginPct,
        latencyMs: turn.row.latencyMs,
      })
    );
  }

  const rows = turns.map((t) => t.row);
  const krwPerUsd = getEffectiveKrwPerUsd();
  const totalRevenuePoints = rows.reduce((s, r) => s + r.finalUserCharge, 0);
  const totalApiRawCostKrw = rows.reduce((s, r) => s + r.apiRawCostKrw, 0);
  const rollingMarginPct =
    totalRevenuePoints > 0
      ? round1((1 - totalApiRawCostKrw / totalRevenuePoints) * 100)
      : null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const payload = {
    model: MODEL,
    reasoningSetting: "low",
    GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS: 0,
    retry: 0,
    continuation: 0,
    recovery: 0,
    widgetPolicy: "same as other general models; extract not invoked in this harness",
    krwPerUsd: round3(krwPerUsd),
    competitor: competitorMarginTable(krwPerUsd),
    inputGrowth: {
      t1: first.apiInputTokens,
      t10: last.apiInputTokens,
      delta: last.apiInputTokens - first.apiInputTokens,
    },
    cache: {
      t1CacheRead: first.cacheReadTokens,
      t10CacheRead: last.cacheReadTokens,
      t1HitPct: first.cacheHitPct,
      t10HitPct: last.cacheHitPct,
      cacheReadGrewWithInput: last.cacheReadTokens > first.cacheReadTokens,
    },
    rolling: {
      turns: rows.length,
      totalRevenuePoints,
      totalApiRawCostKrw: round3(totalApiRawCostKrw),
      realizedGrossMarginPct: rollingMarginPct,
    },
    bandAverages: bandAverage(rows),
    turns: rows,
  };

  const table = [
    "| Turn | chars | apiInput | billedOut | content | reasoning | cacheRead | cacheWrite | standardIn | upstreamUSD | rawKRW | mainP | widgetP | finalP | margin% | latency | TTFT | finish |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ...rows.map((r) =>
      `| ${r.turn} | ${r.visibleOutputChars} | ${r.apiInputTokens} | ${r.billedOutputTokens} | ${r.contentTokens} | ${r.reasoningTokens} | ${r.cacheReadTokens} | ${r.cacheWriteTokens} | ${r.standardInputTokens} | ${r.upstreamCostUsd ?? "n/a"} | ${r.apiRawCostKrw} | ${r.mainUserCharge} | ${r.widgetCharge} | ${r.finalUserCharge} | ${r.realizedGrossMarginPct ?? "n/a"} | ${r.latencyMs} | ${r.ttftMs ?? "n/a"} | ${r.finishReason ?? "n/a"} |`
    ),
  ].join("\n");

  const review = `# Gemini 3.7 Flash growing-history pricing live test

\`\`\`text
model = ${MODEL}
reasoning_effort = low
GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS = 0
retry = 0
continuation = 0
recovery = 0
widget = NOT_INVOKED
\`\`\`

## T1–T10

${table}

## Rolling last 10

- total revenue points: ${totalRevenuePoints}P
- total API raw cost: ${round3(totalApiRawCostKrw)} KRW
- realized gross margin: ${rollingMarginPct ?? "n/a"}%

## Cache

- T1 input ${first.apiInputTokens} / cacheRead ${first.cacheReadTokens} (${first.cacheHitPct}%)
- T10 input ${last.apiInputTokens} / cacheRead ${last.cacheReadTokens} (${last.cacheHitPct}%)
- cacheRead grew with input: ${last.cacheReadTokens > first.cacheReadTokens}

## Competitor fixture 22947 / 3897 → 60P vs 62P

${JSON.stringify(payload.competitor, null, 2)}
`;

  for (const dir of [OUT_DIR, ARTIFACT_DIR]) {
    save(dir, "GROWING_HISTORY.md", review);
    save(dir, "RUNTIME.json", payload);
    for (const turn of turns) {
      save(dir, `${turn.label.toLowerCase()}-raw.txt`, turn.resp.text);
    }
  }
  console.log(
    JSON.stringify(
      {
        out: path.join(OUT_DIR, "GROWING_HISTORY.md"),
        rolling: payload.rolling,
        inputGrowth: payload.inputGrowth,
        cache: payload.cache,
      },
      null,
      2
    )
  );
}

void main();
