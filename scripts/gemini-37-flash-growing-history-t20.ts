/**
 * Gemini 3.7 Flash — extend growing-history T11–T20 only.
 * Reuses recorded T1–T10 assistant RAW. Production buildContext path.
 * No price / cache / prompt / length / reasoning changes.
 *
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-growing-history-t20.ts
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
const ARTIFACT_DIR = path.join("/opt/cursor/artifacts", "gemini-37-flash-pricing-t20");

const USER_TURNS_T1_T10 = [
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

const USER_TURNS_T11_T20 = [
  "저쪽 복도 맞아? *걸음을 맞추며*",
  "사람들이 너 보면 슬쩍 피하던데. 왜 그래?",
  "이명, 지금은 좀 어때.",
  "목적지부터 말해줘. 어디까지 가는 거야.",
  "*초커를 흘깃* 저거 아프진 않아?",
  "렌인 건 알겠는데, 그 다음이 비어 있어.",
  "잠깐. 발소리 많아. 여기 서 있을까.",
  "너 혼자 이렇게 다녀도 괜찮아?",
  "커피 얘기, 진짜야? 아니면 그냥 붙잡아 두는 거야.",
  "일단 네 옆에서 걸어갈게. 갑자기 멈추면 말해.",
] as const;

const JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

type TurnRow = {
  turn: string;
  visibleOutputChars: number;
  apiInputTokens: number;
  billedOutputTokens: number;
  contentTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  standardInputTokens: number;
  cacheHitPct: number;
  upstreamCostUsd: number | null;
  catalogCostUsd: number;
  catalogCostKrw: number;
  apiRawCostUsd: number;
  apiRawCostKrw: number;
  apiRawCostSource: string;
  mainUserCharge: number;
  widgetCharge: number;
  widgetStatus: string;
  finalUserCharge: number;
  realizedGrossMarginPct: number | null;
  latencyMs: number;
  ttftMs: number | null;
  finishReason: string | null;
  httpStatus?: number;
  reasoningEffort?: unknown;
  maxTokens?: unknown;
  streamIncomplete?: boolean;
};

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
    gemini37LengthSentencePresent:
      system.includes("약 3,200~4,000자") ||
      /Gemini 3\.7/.test(system) && /length adapter/i.test(system),
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
  if (promptAudit.gemini31AgencyInjected) {
    throw new Error(`${label}: Gemini 3.1 agency supplement leaked`);
  }
  if (promptAudit.gemini37NamedPromptPresent || promptAudit.gemini37LengthSentencePresent) {
    throw new Error(`${label}: Gemini 3.7 dedicated prompt leaked`);
  }
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
  if (requestBody.reasoning_effort !== "low") {
    throw new Error(`${label}: reasoning_effort changed from low`);
  }
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
  const catalogCostKrw = catalog * krwPerUsd;
  const upstreamUsd = usage.upstreamCostUsd ?? null;
  const streamIncomplete =
    resp.finishReason == null || usage.promptTokens === 0 || usage.completionTokens === 0;
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
      catalogCostUsd: round3(catalog),
      catalogCostKrw: round3(catalogCostKrw),
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
      streamIncomplete,
      promptAudit,
    } satisfies TurnRow & { billingMatchesHook: boolean; promptAudit: unknown },
  };
}

function loadRecordedT1T10(): { rows: TurnRow[]; history: ChatMsg[] } {
  const runtime = JSON.parse(
    fs.readFileSync(path.join(OUT_DIR, "RUNTIME.json"), "utf8")
  ) as { turns: TurnRow[]; krwPerUsd: number };
  if (!Array.isArray(runtime.turns) || runtime.turns.length !== 10) {
    throw new Error("Expected recorded T1–T10 in RUNTIME.json");
  }
  const krwPerUsd = getEffectiveKrwPerUsd();
  const rows = runtime.turns.map((r) => {
    const catalog = catalogUsd({
      inputTokens: r.apiInputTokens,
      outputTokens: r.billedOutputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheWriteTokens: r.cacheWriteTokens,
    });
    return {
      ...r,
      catalogCostUsd: round3(catalog),
      catalogCostKrw: round3(catalog * krwPerUsd),
    };
  });
  const history: ChatMsg[] = [
    { role: "assistant", content: TERRA_PROMPT_CANARY_GREETING_NEUTRAL },
  ];
  for (let i = 0; i < 10; i += 1) {
    const rawPath = path.join(OUT_DIR, `t${i + 1}-raw.txt`);
    const raw = fs.readFileSync(rawPath, "utf8");
    if (!raw.trim()) throw new Error(`Missing RAW for T${i + 1}`);
    history.push({ role: "user", content: USER_TURNS_T1_T10[i] });
    history.push({ role: "assistant", content: raw });
  }
  return { rows, history };
}

function rolling(rows: TurnRow[]) {
  const totalRevenuePoints = rows.reduce((s, r) => s + r.finalUserCharge, 0);
  const totalApiRawCostKrw = rows.reduce((s, r) => s + r.apiRawCostKrw, 0);
  const realizedGrossMarginPct =
    totalRevenuePoints > 0
      ? round1((1 - totalApiRawCostKrw / totalRevenuePoints) * 100)
      : null;
  return {
    turns: rows.length,
    totalRevenuePoints,
    totalApiRawCostKrw: round3(totalApiRawCostKrw),
    realizedGrossMarginPct,
  };
}

function inputBands(rows: TurnRow[]) {
  const bands = [
    { label: "0~25K", min: 0, max: 25_000 },
    { label: "25~35K", min: 25_000, maxExclusive: false, max: 35_000, exclusiveMin: true },
    { label: "35~45K", min: 35_000, max: 45_000, exclusiveMin: true },
    { label: "45~55K", min: 45_000, max: 55_000, exclusiveMin: true },
    { label: "55~65K", min: 55_000, max: 65_000, exclusiveMin: true },
    { label: "65K+", min: 65_000, max: Number.POSITIVE_INFINITY, exclusiveMin: true },
  ] as const;
  return bands.map((band) => {
    const exclusiveMin = "exclusiveMin" in band && band.exclusiveMin;
    const hits = rows.filter((r) => {
      const x = r.apiInputTokens;
      const lower = exclusiveMin ? x > band.min : x >= band.min;
      const upper = x <= band.max;
      return lower && upper;
    });
    const n = hits.length;
    const avg = (pick: (r: TurnRow) => number) =>
      n > 0 ? round3(hits.reduce((s, r) => s + pick(r), 0) / n) : null;
    const margins = hits
      .map((r) => r.realizedGrossMarginPct)
      .filter((m): m is number => m != null);
    return {
      band: band.label,
      turns: n,
      avgInput: avg((r) => r.apiInputTokens),
      avgBilledOutput: avg((r) => r.billedOutputTokens),
      avgUserP: n > 0 ? round1(hits.reduce((s, r) => s + r.finalUserCharge, 0) / n) : null,
      avgActualApiKrw: avg((r) => r.apiRawCostKrw),
      realizedGrossMarginPct:
        n > 0
          ? round1(
              (1 -
                hits.reduce((s, r) => s + r.apiRawCostKrw, 0) /
                  hits.reduce((s, r) => s + r.finalUserCharge, 0)) *
                100
            )
          : null,
      minMargin: margins.length ? Math.min(...margins) : null,
      maxMargin: margins.length ? Math.max(...margins) : null,
    };
  });
}

function coldHighInput(rows: TurnRow[], minInput: number) {
  return rows
    .filter((r) => r.apiInputTokens >= minInput && r.cacheReadTokens === 0)
    .map((r) => ({
      turn: r.turn,
      apiInputTokens: r.apiInputTokens,
      billedOutputTokens: r.billedOutputTokens,
      userP: r.finalUserCharge,
      actualApiKrw: r.apiRawCostKrw,
      actualUpstreamUsd: r.upstreamCostUsd,
      catalogCostUsd: r.catalogCostUsd,
      catalogCostKrw: r.catalogCostKrw,
      actualMarginPct: r.realizedGrossMarginPct,
      catalogMarginPct:
        r.finalUserCharge > 0
          ? round1((1 - r.catalogCostKrw / r.finalUserCharge) * 100)
          : null,
    }));
}

function judge(margin: number | null): string {
  if (margin == null) return "NO_DATA";
  if (margin > 62) return "PRICE_HIGH_CANDIDATE";
  if (margin >= 55) return "PASS";
  if (margin >= 50) return "ACCEPTABLE_LOW";
  return "PRICE_TOO_LOW";
}

function markdownTable(rows: TurnRow[]) {
  return [
    "| Turn | chars | apiInput | billedOut | cacheRead | cacheWrite | standardIn | upstreamUSD | catalogUSD | rawKRW | mainP | widgetP | finalP | margin% | latency | TTFT | finish |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ...rows.map(
      (r) =>
        `| ${r.turn} | ${r.visibleOutputChars} | ${r.apiInputTokens} | ${r.billedOutputTokens} | ${r.cacheReadTokens} | ${r.cacheWriteTokens} | ${r.standardInputTokens} | ${r.upstreamCostUsd ?? "n/a"} | ${r.catalogCostUsd} | ${r.apiRawCostKrw} | ${r.mainUserCharge} | ${r.widgetCharge} | ${r.finalUserCharge} | ${r.realizedGrossMarginPct ?? "n/a"} | ${r.latencyMs} | ${r.ttftMs ?? "n/a"} | ${r.finishReason ?? "n/a"} |`
    ),
  ].join("\n");
}

async function main() {
  if (!process.env.CHEAPER_INFERENCE_API_KEY) {
    throw new Error("CHEAPER_INFERENCE_API_KEY is required");
  }

  const recorded = loadRecordedT1T10();
  const history = recorded.history;
  const t11t20 = [];
  for (let i = 0; i < USER_TURNS_T11_T20.length; i += 1) {
    const label = `T${i + 11}`;
    const userLine = USER_TURNS_T11_T20[i];
    const turn = await runTurn(label, history, userLine);
    t11t20.push(turn);
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
        finish: turn.row.finishReason,
        streamIncomplete: turn.row.streamIncomplete,
        latencyMs: turn.row.latencyMs,
      })
    );
  }

  const t1t10 = recorded.rows;
  const t11t20Rows = t11t20.map((t) => t.row);
  const all = [...t1t10, ...t11t20Rows];
  const roll10 = rolling(t1t10);
  const roll11_20 = rolling(t11t20Rows);
  const roll20 = rolling(all);
  const bands = inputBands(all);
  const verdict = judge(roll20.realizedGrossMarginPct);
  const firstCollapseBand =
    verdict === "PRICE_TOO_LOW"
      ? bands.find((b) => b.turns > 0 && (b.realizedGrossMarginPct ?? 100) < 50)?.band ??
        "none_in_band_table"
      : null;

  const payload = {
    model: MODEL,
    reasoningSetting: "low",
    GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS: 0,
    retry: 0,
    continuation: 0,
    recovery: 0,
    priceTableUnchanged: true,
    krwPerUsd: round3(getEffectiveKrwPerUsd()),
    inputGrowth: all.map((r) => ({
      turn: r.turn,
      apiInputTokens: r.apiInputTokens,
      cacheReadTokens: r.cacheReadTokens,
    })),
    cache: {
      anyCacheRead: all.some((r) => r.cacheReadTokens > 0),
      anyCacheWrite: all.some((r) => r.cacheWriteTokens > 0),
      t1: t1t10[0].cacheReadTokens,
      t10: t1t10[9].cacheReadTokens,
      t11: t11t20Rows[0]?.cacheReadTokens ?? null,
      t20: t11t20Rows[9]?.cacheReadTokens ?? null,
    },
    rolling: {
      t1t10: roll10,
      t11t20: roll11_20,
      t1t20: roll20,
    },
    bands,
    coldHighInput: {
      "50K+": coldHighInput(all, 50_000),
      "60K+": coldHighInput(all, 60_000),
      "70K+": coldHighInput(all, 70_000),
    },
    verdict,
    firstCollapseBand,
    t11t20: t11t20Rows,
    t1t20: all,
  };

  const coldBlock = (min: number) => {
    const rows = coldHighInput(all, min);
    if (rows.length === 0) return `_no turns with input >= ${min} and cacheRead=0_`;
    return [
      "| Turn | input | billedOut | userP | actualKRW | actualUSD | catalogUSD | catalogKRW | actualMargin% | catalogMargin% |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
      ...rows.map(
        (r) =>
          `| ${r.turn} | ${r.apiInputTokens} | ${r.billedOutputTokens} | ${r.userP} | ${r.actualApiKrw} | ${r.actualUpstreamUsd ?? "n/a"} | ${r.catalogCostUsd} | ${r.catalogCostKrw} | ${r.actualMarginPct ?? "n/a"} | ${r.catalogMarginPct ?? "n/a"} |`
      ),
    ].join("\n");
  };

  const review = `# Gemini 3.7 Flash growing-history T1–T20

\`\`\`text
model = ${MODEL}
reasoning_effort = low
GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS = 0
retry = 0
continuation = 0
recovery = 0
price table = UNCHANGED
T1–T10 = recorded actual assistant history
T11–T20 = live continuation
widget = NOT_INVOKED
\`\`\`

## A. T11–T20

${markdownTable(t11t20Rows)}

## B. T1–T20 input growth

${all.map((r) => `- ${r.turn}: ${r.apiInputTokens}`).join("\n")}

T1 ${t1t10[0].apiInputTokens} → T10 ${t1t10[9].apiInputTokens} → T20 ${t11t20Rows[9]?.apiInputTokens ?? "n/a"}

## C. Cache

- any cacheRead > 0: ${payload.cache.anyCacheRead}
- any cacheWrite > 0: ${payload.cache.anyCacheWrite}
- T1/T10/T11/T20 cacheRead: ${payload.cache.t1} / ${payload.cache.t10} / ${payload.cache.t11} / ${payload.cache.t20}

## D. Input-band margins (T1–T20)

| band | turns | avg input | avg billed out | avg user P | avg actual KRW | realized margin% | min% | max% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${bands
  .map(
    (b) =>
      `| ${b.band} | ${b.turns} | ${b.avgInput ?? "—"} | ${b.avgBilledOutput ?? "—"} | ${b.avgUserP ?? "—"} | ${b.avgActualApiKrw ?? "—"} | ${b.realizedGrossMarginPct ?? "—"} | ${b.minMargin ?? "—"} | ${b.maxMargin ?? "—"} |`
  )
  .join("\n")}

## E. Rolling margins

| window | revenue P | API raw KRW | gross margin% |
|---|---:|---:|---:|
| T1–T10 | ${roll10.totalRevenuePoints} | ${roll10.totalApiRawCostKrw} | ${roll10.realizedGrossMarginPct} |
| T11–T20 | ${roll11_20.totalRevenuePoints} | ${roll11_20.totalApiRawCostKrw} | ${roll11_20.realizedGrossMarginPct} |
| T1–T20 | ${roll20.totalRevenuePoints} | ${roll20.totalApiRawCostKrw} | ${roll20.realizedGrossMarginPct} |

## F. 50K+ cold margins (cacheRead=0)

### 50K+
${coldBlock(50_000)}

### 60K+
${coldBlock(60_000)}

### 70K+
${coldBlock(70_000)}

## G. Verdict

\`\`\`text
T1–T20 realized gross margin = ${roll20.realizedGrossMarginPct}%
JUDGEMENT = ${verdict}
first band <50% = ${firstCollapseBand ?? "n/a"}
price auto-change = forbidden
\`\`\`
`;

  for (const dir of [OUT_DIR, ARTIFACT_DIR]) {
    save(dir, "GROWING_HISTORY_T20.md", review);
    save(dir, "RUNTIME_T20.json", payload);
    for (const turn of t11t20) {
      save(dir, `${turn.label.toLowerCase()}-raw.txt`, turn.resp.text);
    }
  }
  console.log(
    JSON.stringify(
      {
        out: path.join(OUT_DIR, "GROWING_HISTORY_T20.md"),
        rolling: payload.rolling,
        verdict,
        lastInput: t11t20Rows[t11t20Rows.length - 1]?.apiInputTokens ?? null,
        maxInput: Math.max(...all.map((r) => r.apiInputTokens)),
      },
      null,
      2
    )
  );
}

void main();
