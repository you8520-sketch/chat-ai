/**
 * Gemini 3.7 Flash — length placement-only A/B/C.
 * A = recorded vanilla baseline.
 * B = recorded system/model-specific length sentence.
 * C = SAME sentence, user-turn terminal only. Exactly 2 generation calls.
 *
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-length-placement.ts
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
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { openRouterUsdCostFromRates } from "../src/lib/openRouterModelPricing";
import { getEffectiveKrwPerUsd } from "../src/lib/exchangeRate";
import type { ChatMsg } from "../src/lib/ai";

const MODEL = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const SALE_POINTS = 62;
const BASELINE_DIR = path.join(process.cwd(), "docs/audits/gemini-37-flash-baseline");
const AB_DIR = path.join(process.cwd(), "docs/audits/gemini-37-flash-length-ab");
const OUT_DIR = path.join(process.cwd(), "docs/audits/gemini-37-flash-length-placement");
const ARTIFACT_DIR = path.join("/opt/cursor/artifacts", "gemini-37-flash-length-placement");

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

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function flattenMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
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

function detectSpeechActError(text: string, turn: "T1" | "T2") {
  if (turn !== "T2") {
    return { speechActInterpretationError: false, speechActEvidence: [] as string[] };
  }
  const evidence: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/렌(?:은|이).{0,40}제안.{0,16}(?:받아들|승낙|응했)/, "렌이 제안을 수락한 것으로 서술"],
    [/(?:덤덤한 어조로|넙죽|순순히).{0,16}제안.{0,12}(?:받아들|승낙)/, "제안을 넙죽/순순히 받아들"],
    [/제안을\s*넙죽\s*받아들/, "제안을 넙죽 받아들"],
    [/덥석\s*같이\s*가자고/, "덥석 같이 가자고 (user-as-acceptor framing)"],
  ];
  for (const [re, label] of checks) {
    if (re.test(text)) evidence.push(label);
  }
  return {
    speechActInterpretationError: evidence.length > 0,
    speechActEvidence: evidence,
  };
}

function automaticFlags(text: string, finishReason: string | null, turn: "T1" | "T2") {
  const obviousRepetition = /(.{20,})\1\1/.test(text);
  const malformedMeta =
    /\[SYSTEM|as an AI|I am Gemini|language model|safety policy/i.test(text);
  const userAgency =
    /렌이 말했다|렌은 고개를 끄덕였다/.test(text) ||
    /렌은 .{0,20}(대답했다|승낙했다|거절했다|키스했다)/.test(text);
  const offSceneSummary =
    /다음 화|다음 장면에서는|이후의 이야기|요약하면|앞으로 .+게 될 것이다/.test(text);
  const questionMarks = (text.match(/\?/g) ?? []).length;
  const speechAct = detectSpeechActError(text, turn);
  return {
    atLeast2800Chars: [...text].length >= 2800,
    atLeast3000Chars: [...text].length >= 3000,
    obviousRepetition,
    offSceneSummaryOrForeshadow: offSceneSummary,
    malformedOrMeta: malformedMeta,
    obviousUserAgencyViolation: userAgency,
    finishTruncation: finishReason === "length",
    questionMarkCount: questionMarks,
    ...speechAct,
  };
}

function auditPlacement(system: string, lastUser: string, assembledAll: string) {
  const systemCount = countOccurrences(system, GEMINI37_FLASH_LENGTH_SENTENCE);
  const lastUserCount = countOccurrences(lastUser, GEMINI37_FLASH_LENGTH_SENTENCE);
  const assembledCount = countOccurrences(assembledAll, GEMINI37_FLASH_LENGTH_SENTENCE);
  const commonOwnerPresent = lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE);
  const terminalLast = lastUser.trimEnd().endsWith(GEMINI37_FLASH_LENGTH_SENTENCE);
  const commonBeforeTerminal =
    commonOwnerPresent &&
    lastUser.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE) <
      lastUser.indexOf(GEMINI37_FLASH_LENGTH_SENTENCE);
  return {
    systemHasLengthSentence: systemCount > 0,
    systemCount,
    lastUserCount,
    assembledCount,
    commonOwnerPresent,
    terminalLast,
    commonBeforeTerminal,
    gemini31AgencyInjected: system.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE),
    placementOk:
      systemCount === 0 &&
      lastUserCount === 1 &&
      assembledCount === 1 &&
      commonOwnerPresent &&
      terminalLast &&
      commonBeforeTerminal,
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

async function runTurn(label: "T1" | "T2", history: ChatMsg[], userLine: string) {
  const built = buildTurnContext(history, userLine);
  const system = built.systemPrompt ?? "";
  const lastBuiltUser = built.history[built.history.length - 1];
  if (!lastBuiltUser || lastBuiltUser.role !== "user") {
    throw new Error(`${label}: last built history item is not user`);
  }
  const assembledPrompt = `${system}\n${built.history.map((m) => m.content).join("\n")}`;
  const placement = auditPlacement(system, lastBuiltUser.content, assembledPrompt);
  if (!placement.placementOk) {
    throw new Error(`${label}: placement audit failed ${JSON.stringify(placement)}`);
  }
  if (placement.gemini31AgencyInjected) {
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
  if (requestBody.max_tokens != null) {
    throw new Error(`${label}: max_tokens must remain omitted`);
  }
  const messages = (requestBody.messages ?? assembled.messages) as Array<{
    role: string;
    content: unknown;
  }>;
  const lastReqUser = [...messages].reverse().find((m) => m.role === "user");
  const lastReqUserText = flattenMessageContent(lastReqUser?.content);
  const systemMessages = messages.filter((m) => m.role === "system");
  const systemJoined = systemMessages.map((m) => flattenMessageContent(m.content)).join("\n");
  const assembledAll = messages.map((m) => flattenMessageContent(m.content)).join("\n");
  const requestPlacement = auditPlacement(systemJoined, lastReqUserText, assembledAll);
  if (!requestPlacement.placementOk) {
    throw new Error(
      `${label}: assembled request placement failed ${JSON.stringify(requestPlacement)}`
    );
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
    ...automaticFlags(resp.text, resp.finishReason, label),
    placement,
    requestPlacement,
  };
  return { label, userLine, system, lastUser: lastReqUserText, requestBody, resp, metrics };
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

function loadRecordedB() {
  const runtime = JSON.parse(
    fs.readFileSync(path.join(AB_DIR, "RUNTIME.json"), "utf8")
  ) as {
    B: {
      t1: { raw: string; metrics: Record<string, unknown> };
      t2: { raw: string; metrics: Record<string, unknown> };
    };
  };
  return runtime.B;
}

function avg(a: number, b: number) {
  return Math.round(((a + b) / 2) * 1000) / 1000;
}

function num(v: unknown): number {
  return Number(v ?? 0);
}

async function main() {
  const A = loadBaselineA();
  const B = loadRecordedB();
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

  const aChars = avg(num(A.t1.visibleCharsIncludingSpaces), num(A.t2.visibleCharsIncludingSpaces));
  const bChars = avg(num(B.t1.metrics.visibleCharsIncludingSpaces), num(B.t2.metrics.visibleCharsIncludingSpaces));
  const cChars = avg(t1.metrics.visibleCharsIncludingSpaces, t2.metrics.visibleCharsIncludingSpaces);
  const aCost = avg(num(A.t1.upstreamCostUsd), num(A.t2.upstreamCostUsd));
  const bCost = avg(num(B.t1.metrics.upstreamCostUsd), num(B.t2.metrics.upstreamCostUsd));
  const cCost = avg(num(t1.metrics.upstreamCostUsd), num(t2.metrics.upstreamCostUsd));
  const aKrw = avg(num(A.t1.estimatedKrwApiCost), num(A.t2.estimatedKrwApiCost));
  const bKrw = avg(num(B.t1.metrics.estimatedKrwApiCost), num(B.t2.metrics.estimatedKrwApiCost));
  const cKrw = avg(t1.metrics.estimatedKrwApiCost, t2.metrics.estimatedKrwApiCost);

  const lengthGate =
    cChars >= 3000 &&
    t1.metrics.visibleCharsIncludingSpaces >= 2800 &&
    t2.metrics.visibleCharsIncludingSpaces >= 2800;
  const qualityGate =
    !t1.metrics.obviousRepetition &&
    !t2.metrics.obviousRepetition &&
    !t1.metrics.speechActInterpretationError &&
    !t2.metrics.speechActInterpretationError &&
    !t1.metrics.obviousUserAgencyViolation &&
    !t2.metrics.obviousUserAgencyViolation;
  const t2StreamIncomplete =
    t2.resp.finishReason == null ||
    t2.metrics.apiOutputTokens === 0 ||
    !t2.resp.text.trimEnd().match(/[.!?…다요죠네까]$/);
  const adoptCandidate = lengthGate && qualityGate && !t2StreamIncomplete;
  const aMargin = margin62P(aKrw);
  const bMargin = margin62P(bKrw);
  const cMargin = margin62P(cKrw);

  const bT2Speech = detectSpeechActError(B.t2.raw, "T2");

  const report = `# Gemini 3.7 Flash — length placement-only A/B/C

\`\`\`text
model = ${MODEL}
reasoning_effort = low
max_tokens = omitted
change = SAME sentence, placement only
A = vanilla baseline (recorded)
B = system/model-specific (recorded)
C = user-turn terminal owner (live)
sentence = ${GEMINI37_FLASH_LENGTH_SENTENCE}
T2_HISTORY = baseline A T1 RAW (same snapshot as B)
retry = 0
continuation = 0
recovery = 0
API_CALLS = 2
production billing = unchanged
merge/deploy = forbidden
\`\`\`

## Placement audit (C)

| | C T1 | C T2 |
|---|---|---|
| system has sentence | ${t1.metrics.placement.systemHasLengthSentence} | ${t2.metrics.placement.systemHasLengthSentence} |
| last-user count | ${t1.metrics.placement.lastUserCount} | ${t2.metrics.placement.lastUserCount} |
| assembled count | ${t1.metrics.placement.assembledCount} | ${t2.metrics.placement.assembledCount} |
| common owner present | ${t1.metrics.placement.commonOwnerPresent} | ${t2.metrics.placement.commonOwnerPresent} |
| sentence is last instruction | ${t1.metrics.placement.terminalLast} | ${t2.metrics.placement.terminalLast} |
| request placement ok | ${t1.metrics.requestPlacement.placementOk} | ${t2.metrics.requestPlacement.placementOk} |

## A/B/C 표

| | A T1 | B T1 | C T1 | A T2 | B T2 | C T2 |
|---|---:|---:|---:|---:|---:|---:|
| visible chars incl. spaces | ${A.t1.visibleCharsIncludingSpaces} | ${B.t1.metrics.visibleCharsIncludingSpaces} | ${t1.metrics.visibleCharsIncludingSpaces} | ${A.t2.visibleCharsIncludingSpaces} | ${B.t2.metrics.visibleCharsIncludingSpaces} | ${t2.metrics.visibleCharsIncludingSpaces} |
| chars excl. spaces | ${A.t1.charsExcludingSpaces} | ${B.t1.metrics.charsExcludingSpaces} | ${t1.metrics.charsExcludingSpaces} | ${A.t2.charsExcludingSpaces} | ${B.t2.metrics.charsExcludingSpaces} | ${t2.metrics.charsExcludingSpaces} |
| paragraphs | ${A.t1.paragraphCount} | ${B.t1.metrics.paragraphCount} | ${t1.metrics.paragraphCount} | ${A.t2.paragraphCount} | ${B.t2.metrics.paragraphCount} | ${t2.metrics.paragraphCount} |
| dialogue paragraphs | ${A.t1.dialogueParagraphCount} | ${B.t1.metrics.dialogueParagraphCount} | ${t1.metrics.dialogueParagraphCount} | ${A.t2.dialogueParagraphCount} | ${B.t2.metrics.dialogueParagraphCount} | ${t2.metrics.dialogueParagraphCount} |
| apiInputTokens | ${A.t1.apiInputTokens} | ${B.t1.metrics.apiInputTokens} | ${t1.metrics.apiInputTokens} | ${A.t2.apiInputTokens} | ${B.t2.metrics.apiInputTokens} | ${t2.metrics.apiInputTokens} |
| apiOutputTokens | ${A.t1.apiOutputTokens} | ${B.t1.metrics.apiOutputTokens} | ${t1.metrics.apiOutputTokens} | ${A.t2.apiOutputTokens} | ${B.t2.metrics.apiOutputTokens} | ${t2.metrics.apiOutputTokens} |
| reasoningTokens | ${A.t1.reasoningTokens} | ${B.t1.metrics.reasoningTokens} | ${t1.metrics.reasoningTokens} | ${A.t2.reasoningTokens} | ${B.t2.metrics.reasoningTokens} | ${t2.metrics.reasoningTokens} |
| latency ms | ${A.t1.latencyMs} | ${B.t1.metrics.latencyMs} | ${t1.metrics.latencyMs} | ${A.t2.latencyMs} | ${B.t2.metrics.latencyMs} | ${t2.metrics.latencyMs} |
| TTFT ms | ${A.t1.ttftMs} | ${B.t1.metrics.ttftMs} | ${t1.metrics.ttftMs} | ${A.t2.ttftMs} | ${B.t2.metrics.ttftMs} | ${t2.metrics.ttftMs} |
| finish | ${A.t1.finishReason} | ${B.t1.metrics.finishReason} | ${t1.metrics.finishReason} | ${A.t2.finishReason} | ${B.t2.metrics.finishReason} | ${t2.metrics.finishReason} |
| upstreamCostUsd | ${A.t1.upstreamCostUsd} | ${B.t1.metrics.upstreamCostUsd} | ${t1.metrics.upstreamCostUsd} | ${A.t2.upstreamCostUsd} | ${B.t2.metrics.upstreamCostUsd} | ${t2.metrics.upstreamCostUsd} |
| KRW cost | ${A.t1.estimatedKrwApiCost} | ${B.t1.metrics.estimatedKrwApiCost} | ${t1.metrics.estimatedKrwApiCost} | ${A.t2.estimatedKrwApiCost} | ${B.t2.metrics.estimatedKrwApiCost} | ${t2.metrics.estimatedKrwApiCost} |
| 62P margin KRW | ${margin62P(num(A.t1.estimatedKrwApiCost)).marginKrw} | ${B.t1.metrics.marginKrw} | ${t1.metrics.marginKrw} | ${margin62P(num(A.t2.estimatedKrwApiCost)).marginKrw} | ${B.t2.metrics.marginKrw} | ${t2.metrics.marginKrw} |
| 62P margin % | ${margin62P(num(A.t1.estimatedKrwApiCost)).marginPct} | ${B.t1.metrics.marginPct} | ${t1.metrics.marginPct} | ${margin62P(num(A.t2.estimatedKrwApiCost)).marginPct} | ${B.t2.metrics.marginPct} | ${t2.metrics.marginPct} |

## 평균

| | A | B | C | C−A | C−B |
|---|---:|---:|---:|---:|---:|
| avg chars | ${aChars} | ${bChars} | ${cChars} | ${Math.round((cChars - aChars) * 1000) / 1000} | ${Math.round((cChars - bChars) * 1000) / 1000} |
| avg USD | ${aCost} | ${bCost} | ${cCost} | ${Math.round((cCost - aCost) * 1_000_000) / 1_000_000} | ${Math.round((cCost - bCost) * 1_000_000) / 1_000_000} |
| avg KRW | ${aKrw} | ${bKrw} | ${cKrw} | ${Math.round((cKrw - aKrw) * 1000) / 1000} | ${Math.round((cKrw - bKrw) * 1000) / 1000} |
| 62P avg margin KRW | ${aMargin.marginKrw} | ${bMargin.marginKrw} | ${cMargin.marginKrw} | ${aMargin.marginKrw != null && cMargin.marginKrw != null ? Math.round((cMargin.marginKrw - aMargin.marginKrw) * 1000) / 1000 : null} | ${bMargin.marginKrw != null && cMargin.marginKrw != null ? Math.round((cMargin.marginKrw - bMargin.marginKrw) * 1000) / 1000 : null} |
| 62P avg margin % | ${aMargin.marginPct} | ${bMargin.marginPct} | ${cMargin.marginPct} | ${aMargin.marginPct != null && cMargin.marginPct != null ? Math.round((cMargin.marginPct - aMargin.marginPct) * 10) / 10 : null} | ${bMargin.marginPct != null && cMargin.marginPct != null ? Math.round((cMargin.marginPct - bMargin.marginPct) * 10) / 10 : null} |

\`\`\`text
C_avg >= 3000 = ${cChars >= 3000} (${cChars})
C_each >= 2800 = ${t1.metrics.atLeast2800Chars && t2.metrics.atLeast2800Chars} (T1=${t1.metrics.visibleCharsIncludingSpaces}, T2=${t2.metrics.visibleCharsIncludingSpaces})
obvious repetition = T1 ${t1.metrics.obviousRepetition} / T2 ${t2.metrics.obviousRepetition}
speech-act error = T1 ${t1.metrics.speechActInterpretationError} / T2 ${t2.metrics.speechActInterpretationError}
agency violation = T1 ${t1.metrics.obviousUserAgencyViolation} / T2 ${t2.metrics.obviousUserAgencyViolation}
ADOPT_TERMINAL_PLACEMENT_CANDIDATE = ${adoptCandidate}
NO_FURTHER_SENTENCE_STACK = true
B_PRODUCTION_ADOPT = false
T2_STREAM_INCOMPLETE = ${t2StreamIncomplete}
\`\`\`

## Regression diagnostics

| | B T1 | C T1 | B T2 | C T2 |
|---|---|---|---|---|
| obvious repetition | ${B.t1.metrics.obviousRepetition} | ${t1.metrics.obviousRepetition} | ${B.t2.metrics.obviousRepetition} | ${t2.metrics.obviousRepetition} |
| off-scene summary/foreshadow | ${B.t1.metrics.offSceneSummaryOrForeshadow} | ${t1.metrics.offSceneSummaryOrForeshadow} | ${B.t2.metrics.offSceneSummaryOrForeshadow} | ${t2.metrics.offSceneSummaryOrForeshadow} |
| obvious agency violation | ${B.t1.metrics.obviousUserAgencyViolation} | ${t1.metrics.obviousUserAgencyViolation} | ${B.t2.metrics.obviousUserAgencyViolation} | ${t2.metrics.obviousUserAgencyViolation} |
| speech-act error | n/a (recorded; T2 human-flagged) | ${t1.metrics.speechActInterpretationError} | ${bT2Speech.speechActInterpretationError} | ${t2.metrics.speechActInterpretationError} |
| speech-act evidence | | ${t1.metrics.speechActEvidence.join("; ") || "—"} | ${bT2Speech.speechActEvidence.join("; ") || "—"} | ${t2.metrics.speechActEvidence.join("; ") || "—"} |
| question marks | | ${t1.metrics.questionMarkCount} | | ${t2.metrics.questionMarkCount} |
| malformed/meta | ${B.t1.metrics.malformedOrMeta} | ${t1.metrics.malformedOrMeta} | ${B.t2.metrics.malformedOrMeta} | ${t2.metrics.malformedOrMeta} |
| finish truncation | ${B.t1.metrics.finishTruncation} | ${t1.metrics.finishTruncation} | ${B.t2.metrics.finishTruncation} | ${t2.metrics.finishTruncation} |

B T2 recorded speech-act (human): user "같이 갈래?"를 렌이 제안을 받아들인 것으로 오해.
Auto re-check of recorded B T2 = ${bT2Speech.speechActInterpretationError} (${bT2Speech.speechActEvidence.join("; ") || "—"})

## A T1 RAW

${A.t1Raw}

## B T1 RAW

${B.t1.raw}

## C T1 RAW

${t1.resp.text}

## A T2 RAW

${A.t2Raw}

## B T2 RAW

${B.t2.raw}

## C T2 RAW

${t2.resp.text}
`;

  const payload = {
    model: MODEL,
    reasoningSetting: "low",
    change: "GEMINI37_FLASH_LENGTH_SENTENCE_TERMINAL_USER_TAIL",
    sentence: GEMINI37_FLASH_LENGTH_SENTENCE,
    t2History: "baseline_A_t1_raw",
    API_CALLS: 2,
    retry: 0,
    continuation: 0,
    recovery: 0,
    adoptCandidate,
    lengthGate,
    qualityGate,
    averages: {
      aChars,
      bChars,
      cChars,
      aCostUsd: aCost,
      bCostUsd: bCost,
      cCostUsd: cCost,
      aKrw,
      bKrw,
      cKrw,
      aMargin62P: aMargin,
      bMargin62P: bMargin,
      cMargin62P: cMargin,
    },
    A: { t1: A.t1, t2: A.t2 },
    B: {
      t1: { raw: B.t1.raw, metrics: B.t1.metrics },
      t2: { raw: B.t2.raw, metrics: B.t2.metrics, speechAct: bT2Speech },
    },
    C: {
      t1: { raw: t1.resp.text, metrics: t1.metrics },
      t2: { raw: t2.resp.text, metrics: t2.metrics },
    },
  };

  for (const dir of [OUT_DIR, ARTIFACT_DIR]) {
    save(dir, "PLACEMENT_REPORT.md", report);
    save(dir, "RUNTIME.json", payload);
    save(dir, "a-t1-raw.txt", A.t1Raw);
    save(dir, "a-t2-raw.txt", A.t2Raw);
    save(dir, "b-t1-raw.txt", B.t1.raw);
    save(dir, "b-t2-raw.txt", B.t2.raw);
    save(dir, "c-t1-raw.txt", t1.resp.text);
    save(dir, "c-t2-raw.txt", t2.resp.text);
    save(dir, "c-t1-request.json", {
      reasoning_effort: t1.requestBody.reasoning_effort ?? null,
      max_tokens: t1.requestBody.max_tokens ?? null,
      model: t1.requestBody.model,
      systemChars: t1.system.length,
      lastUserTail: t1.lastUser.slice(-400),
      placement: t1.metrics.placement,
      requestPlacement: t1.metrics.requestPlacement,
    });
    save(dir, "c-t2-request.json", {
      reasoning_effort: t2.requestBody.reasoning_effort ?? null,
      max_tokens: t2.requestBody.max_tokens ?? null,
      model: t2.requestBody.model,
      systemChars: t2.system.length,
      lastUserTail: t2.lastUser.slice(-400),
      placement: t2.metrics.placement,
      requestPlacement: t2.metrics.requestPlacement,
    });
  }
  console.log(
    JSON.stringify(
      {
        out: path.join(OUT_DIR, "PLACEMENT_REPORT.md"),
        adoptCandidate,
        aChars,
        bChars,
        cChars,
        t1C: t1.metrics.visibleCharsIncludingSpaces,
        t2C: t2.metrics.visibleCharsIncludingSpaces,
        t2SpeechAct: t2.metrics.speechActInterpretationError,
        t2Agency: t2.metrics.obviousUserAgencyViolation,
      },
      null,
      2
    )
  );
}

void main();
