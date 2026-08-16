/**
 * Gemini 3.7 Flash V2 — extend growing-history T21–T30 only.
 * Reuses recorded T1–T20 assistant RAW. Production buildContext path.
 * Price table is V2. No prompt / length / reasoning / cache / memory changes.
 *
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-growing-history-t30.ts
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
import { resolveGemini37FlashFinalUserCharge } from "../src/lib/points";
import type { ChatMsg } from "../src/lib/ai";

const MODEL = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const OUT_DIR = path.join(process.cwd(), "docs/audits/gemini-37-flash-pricing");
const ARTIFACT_DIR = path.join("/opt/cursor/artifacts", "gemini-37-flash-pricing-t30");

const USER_TURNS_T1_T20 = [
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
  "커피 얘기, 진짜야? 아니면 그냥 붙잡아 두는 거야.",
  "일단 네 옆에서 걸어갈게. 갑자기 멈추면 말해.",
] as const;

const USER_TURNS_T21_T30 = [
  "여기 공기 좀 무거운데. 너만 그래?",
  "*소매를 잡아* 이쪽으로 가도 돼?",
  "사람들 눈길, 신경 쓰여. 그냥 지나갈게.",
  "배고프면 말해. 난 아직 괜찮아.",
  "초커 소리 났어? 아니면 내 착각이야.",
  "렌이라고만 기억나. 그 이상은 아직.",
  "*멈춰 서서* 잠깐만. 숨 고를게.",
  "너 지금 괜찮다고 하는 표정 아닌데.",
  "이 건물, 출구가 어디야.",
  "일단 네 옆에서 따라갈게. 갑자기 빠지면 잡아.",
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
  cacheReadTokens: number;
  cacheWriteTokens: number;
  standardInputTokens: number;
  upstreamCostUsd: number | null;
  catalogCostUsd: number;
  catalogCostKrw: number;
  apiRawCostUsd: number;
  apiRawCostKrw: number;
  apiRawCostSource: string;
  mainUserCharge: number;
  computedUserCharge: number;
  finalUserCharge: number;
  realizedGrossMarginPct: number | null;
  catalogStressMarginPct: number | null;
  latencyMs: number;
  ttftMs: number | null;
  finishReason: string | null;
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
      (/Gemini 3\.7/.test(system) && /length adapter/i.test(system)),
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
      text: "",
      usageRaw: null,
    };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finishReason: string | null = null;
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
      if (ev.usage) usageRaw = ev.usage;
      const choice0 = Array.isArray(ev.choices) ? ev.choices[0] : null;
      const choice =
        choice0 && typeof choice0 === "object" ? (choice0 as Record<string, unknown>) : {};
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
    httpStatus: res.status,
    latencyMs: Date.now() - started,
    ttftMs,
    finishReason,
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
  const pricing = computeGemini37FlashUserChargeBreakdown({
    inputTokens: usage.promptTokens,
    billedOutputTokens,
  });
  const owner = resolveGemini37FlashFinalUserCharge({
    inputTokens: usage.promptTokens,
    billedOutputTokens,
    finishReason: resp.finishReason,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    savedText: resp.text,
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
  const finalUserCharge = owner.finalUserPoints;
  const realizedGrossMarginPct =
    finalUserCharge > 0 ? round1((1 - apiRawCostKrw / finalUserCharge) * 100) : null;
  const catalogStressMarginPct =
    finalUserCharge > 0 ? round1((1 - catalogCostKrw / finalUserCharge) * 100) : null;
  return {
    label,
    userLine,
    resp,
    promptAudit,
    row: {
      turn: label,
      visibleOutputChars: [...resp.text.replace(/\r/g, "")].length,
      apiInputTokens: usage.promptTokens,
      billedOutputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      standardInputTokens: usage.standardInputTokens,
      upstreamCostUsd: upstreamUsd,
      catalogCostUsd: round3(catalog),
      catalogCostKrw: round3(catalogCostKrw),
      apiRawCostUsd: round3(apiRawCostUsd),
      apiRawCostKrw: round3(apiRawCostKrw),
      apiRawCostSource:
        upstreamUsd != null && upstreamUsd > 0 ? "provider_reported" : "fallback_catalog",
      mainUserCharge: finalUserCharge,
      computedUserCharge: pricing.totalPoints,
      finalUserCharge,
      realizedGrossMarginPct,
      catalogStressMarginPct,
      latencyMs: resp.latencyMs,
      ttftMs: resp.ttftMs,
      finishReason: resp.finishReason,
      streamIncomplete,
      promptAudit,
    } satisfies TurnRow & { promptAudit: unknown },
  };
}

function loadRecordedT1T20(): { history: ChatMsg[]; shadowValid: TurnRow[] } {
  const shadow = JSON.parse(
    fs.readFileSync(path.join(OUT_DIR, "SHADOW_V2.json"), "utf8")
  ) as {
    rows: Array<{
      turn: string;
      input: number;
      billedOut: number;
      v2P: number;
      actualApiKrw: number;
      streamIncomplete: boolean;
    }>;
  };
  const history: ChatMsg[] = [
    { role: "assistant", content: TERRA_PROMPT_CANARY_GREETING_NEUTRAL },
  ];
  for (let i = 0; i < 20; i += 1) {
    const rawPath = path.join(OUT_DIR, `t${i + 1}-raw.txt`);
    const raw = fs.readFileSync(rawPath, "utf8");
    if (!raw.trim()) throw new Error(`Missing RAW for T${i + 1}`);
    history.push({ role: "user", content: USER_TURNS_T1_T20[i] });
    history.push({ role: "assistant", content: raw });
  }
  const shadowValid: TurnRow[] = shadow.rows
    .filter((r) => !r.streamIncomplete)
    .map((r) => ({
      turn: r.turn,
      visibleOutputChars: 0,
      apiInputTokens: r.input,
      billedOutputTokens: r.billedOut,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      standardInputTokens: r.input,
      upstreamCostUsd: null,
      catalogCostUsd: 0,
      catalogCostKrw: 0,
      apiRawCostUsd: 0,
      apiRawCostKrw: r.actualApiKrw,
      apiRawCostSource: "provider_reported",
      mainUserCharge: r.v2P,
      computedUserCharge: r.v2P,
      finalUserCharge: r.v2P,
      realizedGrossMarginPct:
        r.v2P > 0 ? round1((1 - r.actualApiKrw / r.v2P) * 100) : null,
      catalogStressMarginPct: null,
      latencyMs: 0,
      ttftMs: null,
      finishReason: "stop",
      streamIncomplete: false,
    }));
  return { history, shadowValid };
}

function rolling(rows: TurnRow[]) {
  const totalRevenuePoints = rows.reduce((s, r) => s + r.finalUserCharge, 0);
  const totalApiRawCostKrw = rows.reduce((s, r) => s + r.apiRawCostKrw, 0);
  return {
    turns: rows.length,
    totalRevenuePoints,
    totalApiRawCostKrw: round3(totalApiRawCostKrw),
    realizedGrossMarginPct:
      totalRevenuePoints > 0
        ? round1((1 - totalApiRawCostKrw / totalRevenuePoints) * 100)
        : null,
  };
}

function judge(margin: number | null, samples: number): string {
  if (samples < 20 || margin == null) return "INSUFFICIENT_SAMPLES";
  if (margin > 63) return "STILL_HIGH";
  if (margin >= 57) return "PASS";
  if (margin >= 53) return "ACCEPTABLE_LOW";
  if (margin >= 50) return "ACCEPTABLE_LOW";
  return "TOO_LOW";
}

function markdownTable(rows: TurnRow[]) {
  return [
    "| Turn | input | billedOut | actualKRW | V2 P | computedP | margin% | catalog-stress% | finish | cacheRead |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|---:|",
    ...rows.map(
      (r) =>
        `| ${r.turn}${r.streamIncomplete ? " INVALID" : ""} | ${r.apiInputTokens} | ${r.billedOutputTokens} | ${r.apiRawCostKrw} | ${r.finalUserCharge} | ${r.computedUserCharge} | ${r.realizedGrossMarginPct ?? "n/a"} | ${r.catalogStressMarginPct ?? "n/a"} | ${r.finishReason ?? "n/a"} | ${r.cacheReadTokens} |`
    ),
  ].join("\n");
}

async function main() {
  if (!process.env.CHEAPER_INFERENCE_API_KEY) {
    throw new Error("CHEAPER_INFERENCE_API_KEY is required");
  }
  const recorded = loadRecordedT1T20();
  const history = recorded.history;
  const live = [];
  for (let i = 0; i < USER_TURNS_T21_T30.length; i += 1) {
    const label = `T${i + 21}`;
    const userLine = USER_TURNS_T21_T30[i];
    const turn = await runTurn(label, history, userLine);
    live.push(turn);
    history.push({ role: "user", content: userLine });
    history.push({ role: "assistant", content: turn.resp.text });
    console.log(
      JSON.stringify({
        turn: label,
        input: turn.row.apiInputTokens,
        billedOut: turn.row.billedOutputTokens,
        actualKrw: turn.row.apiRawCostKrw,
        v2P: turn.row.finalUserCharge,
        margin: turn.row.realizedGrossMarginPct,
        finish: turn.row.finishReason,
        cacheRead: turn.row.cacheReadTokens,
        streamIncomplete: turn.row.streamIncomplete,
      })
    );
  }

  const liveRows = live.map((t) => t.row);
  const liveValid = liveRows.filter((r) => !r.streamIncomplete);
  const allValid = [...recorded.shadowValid, ...liveValid];
  const rollShadow = rolling(recorded.shadowValid);
  const rollLive = rolling(liveValid);
  const rollAll = rolling(allValid);
  const verdict = judge(rollAll.realizedGrossMarginPct, allValid.length);

  const payload = {
    model: MODEL,
    priceVersion: "V2",
    reasoningSetting: "low",
    retry: 0,
    continuation: 0,
    recovery: 0,
    GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS: 0,
    krwPerUsd: round3(getEffectiveKrwPerUsd()),
    rolling: {
      t1t20ValidShadow: rollShadow,
      t21t30Valid: rollLive,
      t1t30Valid: rollAll,
    },
    verdict,
    t21t30: liveRows,
  };

  const review = `# Gemini 3.7 Flash V2 growing-history T21–T30

\`\`\`text
model = ${MODEL}
price = V2
reasoning_effort = low
retry = 0
continuation = 0
recovery = 0
GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS = 0
\`\`\`

## E. T21–T30

${markdownTable(liveRows)}

## F. Final rolling (valid only)

| window | samples | revenue P | API raw KRW | realized margin% |
|---|---:|---:|---:|---:|
| T1–T20 shadow valid | ${rollShadow.turns} | ${rollShadow.totalRevenuePoints} | ${rollShadow.totalApiRawCostKrw} | ${rollShadow.realizedGrossMarginPct} |
| T21–T30 valid | ${rollLive.turns} | ${rollLive.totalRevenuePoints} | ${rollLive.totalApiRawCostKrw} | ${rollLive.realizedGrossMarginPct} |
| T1–T30 valid | ${rollAll.turns} | ${rollAll.totalRevenuePoints} | ${rollAll.totalApiRawCostKrw} | ${rollAll.realizedGrossMarginPct} |

\`\`\`text
valid samples = ${allValid.length}
realized margin = ${rollAll.realizedGrossMarginPct}%
JUDGEMENT = ${verdict}
price auto-change = forbidden
\`\`\`
`;

  for (const dir of [OUT_DIR, ARTIFACT_DIR]) {
    save(dir, "GROWING_HISTORY_T30.md", review);
    save(dir, "RUNTIME_T30.json", payload);
    for (const turn of live) {
      save(dir, `${turn.label.toLowerCase()}-raw.txt`, turn.resp.text);
    }
  }
  console.log(JSON.stringify({ rolling: payload.rolling, verdict }, null, 2));
}

void main();
