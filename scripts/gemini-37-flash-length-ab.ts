/**
 * Gemini 3.7 Flash — length-only A/B.
 * A = recorded vanilla baseline. B = same snapshot + one length sentence.
 * Exactly 2 generation calls. retry/continuation/recovery = 0.
 *
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-length-ab.ts
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
import { GEMINI37_FLASH_LENGTH_SENTENCE } from "../src/lib/gemini37FlashLengthAdapter";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { openRouterUsdCostFromRates } from "../src/lib/openRouterModelPricing";
import { getEffectiveKrwPerUsd } from "../src/lib/exchangeRate";
import type { ChatMsg } from "../src/lib/ai";

const MODEL = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const SALE_POINTS = 62;
const BASELINE_DIR = path.join(process.cwd(), "docs/audits/gemini-37-flash-baseline");
const OUT_DIR = path.join(process.cwd(), "docs/audits/gemini-37-flash-length-ab");
const ARTIFACT_DIR = path.join("/opt/cursor/artifacts", "gemini-37-flash-length-ab");

const T1_USER = "나는 렌이라고… 본 기억이 안 나는데… 나 알아?";
const T2_USER = "같이 갈래? *두리번*";

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

function countParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function isDialogueParagraph(p: string): boolean {
  return /["“”『』「」]/.test(p) || /^(?:[가-힣A-Za-z].{0,12})?[「『“"]/.test(p);
}

function visibleKoreanMetrics(text: string) {
  const visible = text.replace(/\r/g, "");
  const charsIncludingSpaces = [...visible].length;
  const charsExcludingSpaces = [...visible.replace(/\s/g, "")].length;
  const paragraphs = countParagraphs(visible);
  const dialogueParagraphs = paragraphs.filter(isDialogueParagraph);
  return {
    visibleCharsIncludingSpaces: charsIncludingSpaces,
    charsExcludingSpaces,
    paragraphCount: paragraphs.length,
    dialogueParagraphCount: dialogueParagraphs.length,
    dialogueParagraphRatio:
      paragraphs.length > 0
        ? Math.round((dialogueParagraphs.length / paragraphs.length) * 1000) / 1000
        : 0,
  };
}

function automaticFlags(text: string, finishReason: string | null) {
  const obviousRepetition = /(.{20,})\1\1/.test(text);
  const malformedMeta =
    /\[SYSTEM|as an AI|I am Gemini|language model|safety policy/i.test(text);
  const userAgency =
    /렌이 말했다|렌은 고개를 끄덕였다/.test(text) ||
    /렌은 .{0,20}(대답했다|승낙했다|거절했다|키스했다)/.test(text);
  const offSceneSummary =
    /다음 화|다음 장면에서는|이후의 이야기|요약하면|앞으로 .+게 될 것이다/.test(text);
  return {
    atLeast2800Chars: [...text].length >= 2800,
    atLeast3000Chars: [...text].length >= 3000,
    obviousRepetition,
    offSceneSummaryOrForeshadow: offSceneSummary,
    malformedOrMeta: malformedMeta,
    obviousUserAgencyViolation: userAgency,
    finishTruncation: finishReason === "length",
  };
}

function measureModelSpecificPromptChars(system: string) {
  const gemini31AgencyInjected = system.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE);
  const lengthSentencePresent = system.includes(GEMINI37_FLASH_LENGTH_SENTENCE);
  return {
    GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS: lengthSentencePresent
      ? [...GEMINI37_FLASH_LENGTH_SENTENCE].length
      : 0,
    lengthSentencePresent,
    gemini31AgencyInjected,
  };
}

function margin62P(costKrw: number | null) {
  if (costKrw == null) return { salePoints: SALE_POINTS, marginKrw: null, marginPct: null };
  const marginKrw = Math.round((SALE_POINTS - costKrw) * 1000) / 1000;
  const marginPct = Math.round((1 - costKrw / SALE_POINTS) * 1000) / 10;
  return { salePoints: SALE_POINTS, marginKrw, marginPct };
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
  if (!promptAudit.lengthSentencePresent) {
    throw new Error(`${label}: Gemini 3.7 length sentence missing from assembled prompt`);
  }
  if (promptAudit.gemini31AgencyInjected) {
    throw new Error(`${label}: Gemini 3.1 agency supplement leaked into 3.7 path`);
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
  const usd = openRouterUsdCostFromRates({
    modelId: MODEL,
    promptTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  });
  const krwPerUsd = getEffectiveKrwPerUsd();
  const estimatedKrw =
    usage.upstreamCostUsd != null
      ? usage.upstreamCostUsd * krwPerUsd
      : usd.usdCost * krwPerUsd;
  const costKrw = Math.round(estimatedKrw * 1000) / 1000;
  const metrics = {
    ...visibleKoreanMetrics(resp.text),
    apiInputTokens: usage.promptTokens,
    apiOutputTokens: usage.completionTokens,
    reasoningTokens: usage.reasoningTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    standardInputTokens: usage.standardInputTokens,
    latencyMs: resp.latencyMs,
    ttftMs: resp.ttftMs,
    finishReason: resp.finishReason,
    upstreamCostUsd: usage.upstreamCostUsd ?? null,
    estimatedKrwApiCost: costKrw,
    ...margin62P(costKrw),
    httpStatus: resp.httpStatus,
    requestedModel: MODEL,
    resolvedModel: resp.resolvedModel,
    reasoningEffort: requestBody.reasoning_effort ?? null,
    maxTokens: requestBody.max_tokens ?? null,
    ...automaticFlags(resp.text, resp.finishReason),
    promptAudit,
  };
  return { label, userLine, system, requestBody, resp, metrics };
}

function loadBaselineA() {
  const runtime = JSON.parse(
    fs.readFileSync(path.join(BASELINE_DIR, "RUNTIME.json"), "utf8")
  ) as {
    t1: { raw: string; metrics: Record<string, unknown> };
    t2: { raw: string; metrics: Record<string, unknown> };
  };
  return {
    t1Raw: runtime.t1.raw,
    t2Raw: runtime.t2.raw,
    t1: runtime.t1.metrics,
    t2: runtime.t2.metrics,
  };
}

function avg(a: number, b: number) {
  return Math.round(((a + b) / 2) * 1000) / 1000;
}

async function main() {
  const A = loadBaselineA();
  const greetingHistory: ChatMsg[] = [
    { role: "assistant", content: TERRA_PROMPT_CANARY_GREETING_NEUTRAL },
  ];
  const t1 = await runTurn("T1", greetingHistory, T1_USER);
  const t2History: ChatMsg[] = [
    ...greetingHistory,
    { role: "user", content: T1_USER },
    { role: "assistant", content: A.t1Raw },
  ];
  const t2 = await runTurn("T2", t2History, T2_USER);

  const aChars = avg(
    Number(A.t1.visibleCharsIncludingSpaces),
    Number(A.t2.visibleCharsIncludingSpaces)
  );
  const bChars = avg(
    t1.metrics.visibleCharsIncludingSpaces,
    t2.metrics.visibleCharsIncludingSpaces
  );
  const aCost = avg(Number(A.t1.upstreamCostUsd), Number(A.t2.upstreamCostUsd));
  const bCost = avg(Number(t1.metrics.upstreamCostUsd ?? 0), Number(t2.metrics.upstreamCostUsd ?? 0));
  const aKrw = avg(Number(A.t1.estimatedKrwApiCost), Number(A.t2.estimatedKrwApiCost));
  const bKrw = avg(t1.metrics.estimatedKrwApiCost, t2.metrics.estimatedKrwApiCost);
  const lengthPass =
    bChars >= 3000 &&
    t1.metrics.visibleCharsIncludingSpaces >= 2800 &&
    t2.metrics.visibleCharsIncludingSpaces >= 2800;
  const aMargin = margin62P(aKrw);
  const bMargin = margin62P(bKrw);

  const report = `# Gemini 3.7 Flash — length-only A/B

\`\`\`text
model = ${MODEL}
reasoning_effort = low
change = GEMINI_37_FLASH_LENGTH_SENTENCE only
GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS = ${t1.metrics.promptAudit.GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS}
T2_HISTORY = baseline A T1 RAW (same snapshot)
retry = 0
continuation = 0
recovery = 0
production billing = unchanged
\`\`\`

## A/B 표

| | A T1 | B T1 | A T2 | B T2 |
|---|---:|---:|---:|---:|
| visible chars incl. spaces | ${A.t1.visibleCharsIncludingSpaces} | ${t1.metrics.visibleCharsIncludingSpaces} | ${A.t2.visibleCharsIncludingSpaces} | ${t2.metrics.visibleCharsIncludingSpaces} |
| chars excl. spaces | ${A.t1.charsExcludingSpaces} | ${t1.metrics.charsExcludingSpaces} | ${A.t2.charsExcludingSpaces} | ${t2.metrics.charsExcludingSpaces} |
| paragraphs | ${A.t1.paragraphCount} | ${t1.metrics.paragraphCount} | ${A.t2.paragraphCount} | ${t2.metrics.paragraphCount} |
| dialogue paragraphs | ${A.t1.dialogueParagraphCount} | ${t1.metrics.dialogueParagraphCount} | ${A.t2.dialogueParagraphCount} | ${t2.metrics.dialogueParagraphCount} |
| apiInputTokens | ${A.t1.apiInputTokens} | ${t1.metrics.apiInputTokens} | ${A.t2.apiInputTokens} | ${t2.metrics.apiInputTokens} |
| apiOutputTokens | ${A.t1.apiOutputTokens} | ${t1.metrics.apiOutputTokens} | ${A.t2.apiOutputTokens} | ${t2.metrics.apiOutputTokens} |
| reasoningTokens | ${A.t1.reasoningTokens} | ${t1.metrics.reasoningTokens} | ${A.t2.reasoningTokens} | ${t2.metrics.reasoningTokens} |
| latency ms | ${A.t1.latencyMs} | ${t1.metrics.latencyMs} | ${A.t2.latencyMs} | ${t2.metrics.latencyMs} |
| TTFT ms | ${A.t1.ttftMs} | ${t1.metrics.ttftMs} | ${A.t2.ttftMs} | ${t2.metrics.ttftMs} |
| finish | ${A.t1.finishReason} | ${t1.metrics.finishReason} | ${A.t2.finishReason} | ${t2.metrics.finishReason} |
| upstreamCostUsd | ${A.t1.upstreamCostUsd} | ${t1.metrics.upstreamCostUsd} | ${A.t2.upstreamCostUsd} | ${t2.metrics.upstreamCostUsd} |
| KRW cost | ${A.t1.estimatedKrwApiCost} | ${t1.metrics.estimatedKrwApiCost} | ${A.t2.estimatedKrwApiCost} | ${t2.metrics.estimatedKrwApiCost} |
| 62P margin KRW | ${margin62P(Number(A.t1.estimatedKrwApiCost)).marginKrw} | ${t1.metrics.marginKrw} | ${margin62P(Number(A.t2.estimatedKrwApiCost)).marginKrw} | ${t2.metrics.marginKrw} |
| 62P margin % | ${margin62P(Number(A.t1.estimatedKrwApiCost)).marginPct} | ${t1.metrics.marginPct} | ${margin62P(Number(A.t2.estimatedKrwApiCost)).marginPct} | ${t2.metrics.marginPct} |

## 평균

| | A | B | Δ |
|---|---:|---:|---:|
| avg chars | ${aChars} | ${bChars} | ${Math.round((bChars - aChars) * 1000) / 1000} |
| avg USD | ${aCost} | ${bCost} | ${Math.round((bCost - aCost) * 1_000_000) / 1_000_000} |
| avg KRW | ${aKrw} | ${bKrw} | ${Math.round((bKrw - aKrw) * 1000) / 1000} |
| 62P avg margin KRW | ${aMargin.marginKrw} | ${bMargin.marginKrw} | ${aMargin.marginKrw != null && bMargin.marginKrw != null ? Math.round((bMargin.marginKrw - aMargin.marginKrw) * 1000) / 1000 : null} |
| 62P avg margin % | ${aMargin.marginPct} | ${bMargin.marginPct} | ${aMargin.marginPct != null && bMargin.marginPct != null ? Math.round((bMargin.marginPct - aMargin.marginPct) * 10) / 10 : null} |

\`\`\`text
LENGTH_AUTO = ${lengthPass ? "PASS" : "FAIL"}
B_avg >= 3000 = ${bChars >= 3000}
B_each >= 2800 = ${t1.metrics.atLeast2800Chars && t2.metrics.atLeast2800Chars}
HUMAN_REVIEW_NEEDED = true
ADOPT_LENGTH_SENTENCE = HUMAN_REVIEW_REQUIRED
\`\`\`

## B regression diagnostics (auto only)

| | B T1 | B T2 |
|---|---|---|
| obvious repetition | ${t1.metrics.obviousRepetition} | ${t2.metrics.obviousRepetition} |
| off-scene summary/foreshadow | ${t1.metrics.offSceneSummaryOrForeshadow} | ${t2.metrics.offSceneSummaryOrForeshadow} |
| obvious agency violation | ${t1.metrics.obviousUserAgencyViolation} | ${t2.metrics.obviousUserAgencyViolation} |
| malformed/meta | ${t1.metrics.malformedOrMeta} | ${t2.metrics.malformedOrMeta} |
| finish truncation | ${t1.metrics.finishTruncation} | ${t2.metrics.finishTruncation} |
| dialogue paragraphs vs A | ${t1.metrics.dialogueParagraphCount} / A ${A.t1.dialogueParagraphCount} | ${t2.metrics.dialogueParagraphCount} / A ${A.t2.dialogueParagraphCount} |

문체 경직 / 불필요한 대사 증가 / 장면 품질 = HUMAN_REVIEW_NEEDED

## A T1 RAW

${A.t1Raw}

## B T1 RAW

${t1.resp.text}

## A T2 RAW

${A.t2Raw}

## B T2 RAW

${t2.resp.text}
`;

  const payload = {
    model: MODEL,
    reasoningSetting: "low",
    change: "GEMINI37_FLASH_LENGTH_SENTENCE",
    GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS:
      t1.metrics.promptAudit.GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS,
    t2History: "baseline_A_t1_raw",
    API_CALLS: 2,
    retry: 0,
    continuation: 0,
    recovery: 0,
    LENGTH_AUTO: lengthPass ? "PASS" : "FAIL",
    HUMAN_REVIEW_NEEDED: true,
    averages: {
      aChars,
      bChars,
      aCostUsd: aCost,
      bCostUsd: bCost,
      aKrw,
      bKrw,
      aMargin62P: aMargin,
      bMargin62P: bMargin,
    },
    A: { t1: A.t1, t2: A.t2 },
    B: { t1: { raw: t1.resp.text, metrics: t1.metrics }, t2: { raw: t2.resp.text, metrics: t2.metrics } },
  };

  for (const dir of [OUT_DIR, ARTIFACT_DIR]) {
    save(dir, "AB_REPORT.md", report);
    save(dir, "RUNTIME.json", payload);
    save(dir, "a-t1-raw.txt", A.t1Raw);
    save(dir, "a-t2-raw.txt", A.t2Raw);
    save(dir, "b-t1-raw.txt", t1.resp.text);
    save(dir, "b-t2-raw.txt", t2.resp.text);
    save(dir, "b-t1-request.json", {
      reasoning_effort: t1.requestBody.reasoning_effort ?? null,
      max_tokens: t1.requestBody.max_tokens ?? null,
      model: t1.requestBody.model,
      systemChars: t1.system.length,
      promptAudit: t1.metrics.promptAudit,
    });
  }
  console.log(
    JSON.stringify(
      {
        out: path.join(OUT_DIR, "AB_REPORT.md"),
        LENGTH_AUTO: lengthPass ? "PASS" : "FAIL",
        aChars,
        bChars,
        aCost,
        bCost,
        t1B: t1.metrics.visibleCharsIncludingSpaces,
        t2B: t2.metrics.visibleCharsIncludingSpaces,
      },
      null,
      2
    )
  );
}

void main();
