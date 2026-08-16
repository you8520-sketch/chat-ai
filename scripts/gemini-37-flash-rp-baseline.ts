/**
 * Gemini 3.7 Flash — production-path Korean RP baseline.
 * buildContext → assemblePrimaryRpRequest → Cheaper Inference.
 * No 3.7-specific prompt, no 3.1 agency inheritance, no retry/continuation.
 *
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-rp-baseline.ts
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
import type { ChatMsg } from "../src/lib/ai";

const MODEL = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const OUT_DIR = path.join(
  process.cwd(),
  "docs/audits/gemini-37-flash-baseline"
);
const ARTIFACT_DIR = path.join("/opt/cursor/artifacts", "gemini-37-flash-baseline");

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
  return {
    atLeast3000Chars: [...text].length >= 3000,
    obviousRepetition,
    malformedOrMeta: malformedMeta,
    obviousUserAgencyViolation: userAgency,
    finishTruncation: finishReason === "length",
  };
}

function measureModelSpecificPromptChars(system: string): {
  GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS: number;
  gemini31AgencyInjected: boolean;
  gemini37NamedPromptPresent: boolean;
} {
  const gemini31AgencyInjected = system.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE);
  const gemini37NamedPromptPresent =
    /Gemini 3\.7|GEMINI 3\.7|3\.7 Flash RP adapter/i.test(system);
  return {
    GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS: 0,
    gemini31AgencyInjected,
    gemini37NamedPromptPresent,
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
  if (!requestBody.stream) {
    const json = (await res.json()) as Record<string, unknown>;
    const latencyMs = Date.now() - started;
    const choice = Array.isArray(json.choices) ? (json.choices[0] as Record<string, unknown>) : {};
    const message = (choice.message ?? {}) as Record<string, unknown>;
    return {
      httpStatus,
      latencyMs,
      ttftMs,
      finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
      resolvedModel: typeof json.model === "string" ? json.model : null,
      text: typeof message.content === "string" ? message.content : "",
      usageRaw: json.usage ?? null,
      json,
    };
  }

  if (!res.body) {
    return {
      httpStatus,
      latencyMs: Date.now() - started,
      ttftMs,
      finishReason: null,
      resolvedModel: null,
      text: "",
      usageRaw: null,
      json: { error: "missing body", status: httpStatus },
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
    json: null,
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
    estimatedKrwApiCost: Math.round(estimatedKrw * 1000) / 1000,
    httpStatus: resp.httpStatus,
    requestedModel: MODEL,
    resolvedModel: resp.resolvedModel,
    reasoningEffort: requestBody.reasoning_effort ?? null,
    maxTokens: requestBody.max_tokens ?? null,
    ...automaticFlags(resp.text, resp.finishReason),
    promptAudit,
  };
  return { label, userLine, system, requestBody, resp, metrics, usage };
}

async function main() {
  const greetingHistory: ChatMsg[] = [
    { role: "assistant", content: TERRA_PROMPT_CANARY_GREETING_NEUTRAL },
  ];
  const t1 = await runTurn("T1", greetingHistory, T1_USER);
  const t2History: ChatMsg[] = [
    ...greetingHistory,
    { role: "user", content: T1_USER },
    { role: "assistant", content: t1.resp.text },
  ];
  const t2 = await runTurn("T2", t2History, T2_USER);

  const review = `# Gemini 3.7 Flash RP baseline

\`\`\`text
model = ${MODEL}
reasoning_effort = low
GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS = 0
retry = 0
continuation = 0
recovery = 0
\`\`\`

[T1 RAW]
${t1.resp.text}

[T1 METRICS]
${JSON.stringify(t1.metrics, null, 2)}

[T2 RAW]
${t2.resp.text}

[T2 METRICS]
${JSON.stringify(t2.metrics, null, 2)}
`;

  const payload = {
    model: MODEL,
    reasoningSetting: "low",
    GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS: 0,
    t1: { user: T1_USER, raw: t1.resp.text, metrics: t1.metrics },
    t2: { user: T2_USER, raw: t2.resp.text, metrics: t2.metrics },
  };

  for (const dir of [OUT_DIR, ARTIFACT_DIR]) {
    save(dir, "HUMAN_REVIEW.md", review);
    save(dir, "RUNTIME.json", payload);
    save(dir, "t1-raw.txt", t1.resp.text);
    save(dir, "t2-raw.txt", t2.resp.text);
    save(dir, "t1-request.json", {
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
        out: path.join(OUT_DIR, "HUMAN_REVIEW.md"),
        t1Chars: t1.metrics.visibleCharsIncludingSpaces,
        t2Chars: t2.metrics.visibleCharsIncludingSpaces,
        t1Reasoning: t1.metrics.reasoningTokens,
        t2Reasoning: t2.metrics.reasoningTokens,
        promptSpecific: t1.metrics.promptAudit,
      },
      null,
      2
    )
  );
}

void main();
