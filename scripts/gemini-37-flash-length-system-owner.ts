/**
 * Gemini 3.7 Flash — SYSTEM length owner live test.
 * Short-context 3 + growing-history 3. retry/continuation/recovery = 0.
 *
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-length-system-owner.ts
 */
import Module from "module";
import { execFileSync } from "node:child_process";

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
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { openRouterUsdCostFromRates } from "../src/lib/openRouterModelPricing";
import { getEffectiveKrwPerUsd } from "../src/lib/exchangeRate";
import {
  GEMINI37_FLASH_LENGTH_OWNER_BLOCK,
  REJECTED_GEMINI37_FLASH_LENGTH_B_SENTENCE,
  auditGemini37LengthOwners,
} from "../src/lib/gemini37FlashLengthAdapter";
import type { ChatMsg } from "../src/lib/ai";

const MODEL = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const OUT_DIR = path.join(
  process.cwd(),
  "docs/audits/gemini-37-flash-length-system-owner"
);
const ARTIFACT_DIR = path.join(
  "/opt/cursor/artifacts",
  "gemini-37-flash-length-system-owner"
);
const PRICING_RAW_REF =
  "origin/cursor/gemini-37-flash-pricing:docs/audits/gemini-37-flash-pricing";

const SHORT_SEEDS = [
  {
    id: "S1",
    user: "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
  },
  {
    id: "S2",
    user: "같이 갈래? *두리번*",
  },
  {
    id: "S3",
    user: "*가방 끈을 꼭 쥐고* 음… 조금만. 나 길 잘 모르거든.",
  },
] as const;

const USER_TURNS_T1_T13 = [
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
] as const;

const JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

type QualityFlags = {
  obviousRepetition: boolean;
  sameQuestionStreak: number;
  emotionRestatement: boolean;
  speechActMisread: boolean;
  agencyRegression: boolean;
  summaryPreview: boolean;
};

type TurnRecord = {
  id: string;
  kind: "short-context" | "growing-history";
  userLine: string;
  raw: string;
  chars: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  finishReason: string | null;
  httpStatus: number;
  latencyMs: number;
  ttftMs: number | null;
  maxTokens: unknown;
  reasoningEffort: unknown;
  actualKrw: number;
  userP: number;
  realizedMarginPct: number | null;
  transportInvalid: boolean;
  flags: QualityFlags;
  ownerAudit: ReturnType<typeof auditGemini37LengthOwners>;
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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/** Report-only V2 user P. Does not modify the price table. */
function computeGemini37FlashUserP(inputTokens: number, billedOutputTokens: number): number {
  const input = Math.max(0, Math.round(inputTokens) || 0);
  const output = Math.max(0, Math.round(billedOutputTokens) || 0);
  const inputSurcharge =
    input <= 25_000 ? 0 : Math.ceil((input - 25_000) / 10_000) * 1;
  let outputSurcharge = 0;
  if (output <= 2_500) outputSurcharge = 0;
  else if (output <= 4_000) outputSurcharge = 25;
  else if (output <= 5_500) outputSurcharge = 30;
  else if (output <= 7_000) outputSurcharge = 40;
  else if (output <= 9_000) outputSurcharge = 50;
  else outputSurcharge = 50 + Math.ceil((output - 9_000) / 1_500) * 10;
  return 35 + inputSurcharge + outputSurcharge;
}

function loadRecordedAssistantRaw(turnNumber: number): string {
  const ref = `${PRICING_RAW_REF}/t${turnNumber}-raw.txt`;
  return execFileSync("git", ["show", ref], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function buildGrowingHistoryThrough(assistantTurns: number): ChatMsg[] {
  const history: ChatMsg[] = [
    { role: "assistant", content: TERRA_PROMPT_CANARY_GREETING_NEUTRAL },
  ];
  for (let i = 1; i <= assistantTurns; i += 1) {
    history.push({ role: "user", content: USER_TURNS_T1_T13[i - 1] });
    history.push({ role: "assistant", content: loadRecordedAssistantRaw(i) });
  }
  return history;
}

function questionStreak(text: string): number {
  const questions = text
    .split(/(?<=[.?!\n])/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith("?") || s.endsWith("？"));
  let max = 0;
  let cur = 0;
  for (const q of questions) {
    if (q) {
      cur += 1;
      max = Math.max(max, cur);
    } else {
      cur = 0;
    }
  }
  return max;
}

function qualityFlags(text: string, userLine: string): QualityFlags {
  const obviousRepetition = /(.{20,})\1\1/.test(text);
  const sameQuestionStreak = questionStreak(text);
  const emotionRestatement =
    /(불안|긴장|설렘|안도|당황).{0,80}\1/.test(text) &&
    (text.match(/같은 마음|다시 한번 느꼈|또 다시 불안/g) ?? []).length >= 2;
  const agencyRegression =
    /렌이 말했다|렌은 고개를 끄덕였다/.test(text) ||
    /렌은 .{0,20}(대답했다|승낙했다|거절했다|키스했다)/.test(text);
  const summaryPreview =
    /다음 장면|다음으로 이어질|요약하면|앞으로의 전개|다음 턴/.test(text);
  let speechActMisread = false;
  if (userLine.includes("나 알아?")) {
    speechActMisread = /처음 보는 사람|이름이 뭐야|자기소개부터/.test(text);
  } else if (userLine.includes("같이 갈래?")) {
    speechActMisread = /어디로 가고 싶어\?|목적지가 어디/.test(text) &&
      !/가자|따라와|이쪽|안내/.test(text);
  } else if (userLine.includes("조금만")) {
    speechActMisread = /거절|혼자 가|안 가도 돼/.test(text);
  }
  return {
    obviousRepetition,
    sameQuestionStreak,
    emotionRestatement,
    speechActMisread,
    agencyRegression,
    summaryPreview,
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

function assembleRequest(history: ChatMsg[], currentUserMessage: string) {
  const built = buildTurnContext(history, currentUserMessage);
  const system = built.systemPrompt ?? "";
  const lastUser = built.history[built.history.length - 1];
  const ownerAudit = auditGemini37LengthOwners({
    system,
    lastUser: lastUser?.content ?? "",
  });
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
  const messages = (requestBody.messages ?? []) as Array<{
    role?: string;
    content?: unknown;
  }>;
  const flattenContent = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && "text" in part) {
            return typeof (part as { text?: unknown }).text === "string"
              ? String((part as { text: string }).text)
              : "";
          }
          return "";
        })
        .join("\n");
    }
    return "";
  };
  const systemJoined = messages
    .filter((m) => m.role === "system")
    .map((m) => flattenContent(m.content))
    .join("\n");
  const lastUserJoined = [...messages]
    .reverse()
    .find((m) => m.role === "user");
  const lastUserText = flattenContent(lastUserJoined?.content);
  const rawAudit = auditGemini37LengthOwners({
    system: systemJoined,
    lastUser: lastUserText,
  });
  return {
    built,
    system,
    lastUser: lastUser?.content ?? "",
    requestBody,
    ownerAudit,
    rawAudit,
    genericInSystem: systemJoined.includes(USER_TAIL_LENGTH_OWNER_SENTENCE),
    genericInUser: lastUserText.includes(USER_TAIL_LENGTH_OWNER_SENTENCE),
    rejectedBPresent:
      systemJoined.includes(REJECTED_GEMINI37_FLASH_LENGTH_B_SENTENCE) ||
      lastUserText.includes(REJECTED_GEMINI37_FLASH_LENGTH_B_SENTENCE),
    ownerInUserTail: lastUserText.includes(GEMINI37_FLASH_LENGTH_OWNER_BLOCK),
    maxTokens: requestBody.max_tokens ?? null,
    reasoningEffort: requestBody.reasoning_effort ?? null,
  };
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
      finishReason: null as string | null,
      text: "",
      usageRaw: null as unknown,
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
    text,
    usageRaw,
  };
}

async function runTurn(
  id: string,
  kind: TurnRecord["kind"],
  history: ChatMsg[],
  userLine: string
): Promise<TurnRecord> {
  const assembled = assembleRequest(history, userLine);
  const resp = await callOnce(assembled.requestBody);
  const usage = parseOpenRouterUsage(resp.usageRaw);
  const transportInvalid =
    (resp.finishReason == null || resp.finishReason === "") &&
    usage.promptTokens === 0 &&
    usage.completionTokens === 0;
  const usd = openRouterUsdCostFromRates({
    modelId: MODEL,
    promptTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  });
  const krwPerUsd = getEffectiveKrwPerUsd();
  const actualKrw = round3(
    usage.upstreamCostUsd != null
      ? usage.upstreamCostUsd * krwPerUsd
      : usd.usdCost * krwPerUsd
  );
  const userP = computeGemini37FlashUserP(
    usage.promptTokens,
    usage.completionTokens
  );
  const realizedMarginPct =
    userP > 0 && !transportInvalid ? round1((1 - actualKrw / userP) * 100) : null;
  return {
    id,
    kind,
    userLine,
    raw: resp.text,
    chars: [...resp.text].length,
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    reasoningTokens: usage.reasoningTokens,
    finishReason: resp.finishReason,
    httpStatus: resp.httpStatus,
    latencyMs: resp.latencyMs,
    ttftMs: resp.ttftMs,
    maxTokens: assembled.maxTokens,
    reasoningEffort: assembled.reasoningEffort,
    actualKrw,
    userP,
    realizedMarginPct,
    transportInvalid,
    flags: qualityFlags(resp.text, userLine),
    ownerAudit: assembled.rawAudit,
  };
}

function stats(values: number[]) {
  if (values.length === 0) {
    return { n: 0, avg: 0, median: 0, min: 0, max: 0 };
  }
  const avg = values.reduce((s, n) => s + n, 0) / values.length;
  return {
    n: values.length,
    avg: round1(avg),
    median: round1(median(values)),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function verdict(valid: TurnRecord[]) {
  const short = valid.filter((t) => t.kind === "short-context");
  const growing = valid.filter((t) => t.kind === "growing-history");
  const allChars = valid.map((t) => t.chars);
  const shortGe3500 = short.filter((t) => t.chars >= 3500).length;
  const growingAvg =
    growing.length > 0
      ? growing.reduce((s, t) => s + t.chars, 0) / growing.length
      : 0;
  const allAvg =
    allChars.length > 0
      ? allChars.reduce((s, n) => s + n, 0) / allChars.length
      : 0;
  const qualityFail = valid.some(
    (t) =>
      t.flags.obviousRepetition ||
      t.flags.sameQuestionStreak >= 3 ||
      t.flags.emotionRestatement ||
      t.flags.speechActMisread ||
      t.flags.agencyRegression ||
      t.flags.summaryPreview
  );
  const failReasons: string[] = [];
  if (allAvg < 3500) failReasons.push("valid average < 3500");
  if (allAvg < 4000) failReasons.push("primary average < 4000");
  if (shortGe3500 < 2) failReasons.push("short-context < 2/3 at 3500");
  if (growing.length > 0 && (growingAvg < 4000 || growingAvg > 6500)) {
    failReasons.push("growing-history average outside 4000~6500");
  }
  if (qualityFail) failReasons.push("quality flags");
  return {
    primaryAvg: round1(allAvg),
    shortGe3500,
    growingAvg: round1(growingAvg),
    qualityFail,
    failReasons,
    result: failReasons.length === 0 && valid.length >= 4 ? "PASS" : "FAIL",
  };
}

function renderReport(opts: {
  offlineAudit: ReturnType<typeof assembleRequest>;
  turns: TurnRecord[];
  judged: ReturnType<typeof verdict>;
}): string {
  const { offlineAudit, turns, judged } = opts;
  const valid = turns.filter((t) => !t.transportInvalid);
  const invalid = turns.filter((t) => t.transportInvalid);
  const charStats = stats(valid.map((t) => t.chars));
  const short = valid.filter((t) => t.kind === "short-context");
  const growing = valid.filter((t) => t.kind === "growing-history");
  const lines: string[] = [];
  lines.push("# Gemini 3.7 Flash SYSTEM length owner");
  lines.push("");
  lines.push("```text");
  lines.push(`model = ${MODEL}`);
  lines.push("reasoning_effort = low (unchanged)");
  lines.push(`max_tokens = ${JSON.stringify(offlineAudit.maxTokens)} (omitted = provider default)`);
  lines.push(`GEMINI37_LENGTH_OWNER_COUNT = ${offlineAudit.rawAudit.GEMINI37_LENGTH_OWNER_COUNT}`);
  lines.push(`owner location = ${offlineAudit.rawAudit.location}`);
  lines.push(`generic user-tail owner suppressed = ${!offlineAudit.genericInUser}`);
  lines.push(`rejected B present = ${offlineAudit.rejectedBPresent}`);
  lines.push("retry = 0");
  lines.push("continuation = 0");
  lines.push("recovery = 0");
  lines.push("```");
  lines.push("");
  lines.push("## Owner");
  lines.push("");
  lines.push("```text");
  lines.push(GEMINI37_FLASH_LENGTH_OWNER_BLOCK);
  lines.push("```");
  lines.push("");
  lines.push(`- count: ${offlineAudit.rawAudit.GEMINI37_LENGTH_OWNER_COUNT}`);
  lines.push(`- location: SYSTEM / model-specific section only`);
  lines.push(`- generic USER_TAIL_LENGTH_OWNER_SENTENCE in user: ${offlineAudit.genericInUser}`);
  lines.push(`- owner duplicated on user tail: ${offlineAudit.ownerInUserTail}`);
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  lines.push(`**${judged.result}**`);
  lines.push("");
  lines.push(`- valid n = ${valid.length}`);
  lines.push(`- INVALID_TRANSPORT n = ${invalid.length}`);
  lines.push(`- valid avg/median/min/max chars = ${charStats.avg} / ${charStats.median} / ${charStats.min} / ${charStats.max}`);
  lines.push(`- short-context >=3500 = ${judged.shortGe3500}/${short.length}`);
  lines.push(`- growing-history avg = ${judged.growingAvg}`);
  if (judged.failReasons.length) {
    lines.push(`- fail reasons: ${judged.failReasons.join("; ")}`);
  }
  lines.push("");
  lines.push("## Short-context");
  lines.push("");
  for (const t of turns.filter((x) => x.kind === "short-context")) {
    lines.push(`### ${t.id}${t.transportInvalid ? " — INVALID_TRANSPORT" : ""}`);
    lines.push("");
    lines.push(`user: ${t.userLine}`);
    lines.push("");
    lines.push(
      `chars=${t.chars} outputTokens=${t.outputTokens} inputTokens=${t.inputTokens} finish=${t.finishReason} actualKRW=${t.actualKrw} userP=${t.userP} margin=${t.realizedMarginPct}`
    );
    lines.push("");
    lines.push(`flags: ${JSON.stringify(t.flags)}`);
    lines.push("");
    lines.push("[RAW]");
    lines.push("");
    lines.push(t.raw || "(empty)");
    lines.push("");
  }
  lines.push("## Growing-history");
  lines.push("");
  for (const t of turns.filter((x) => x.kind === "growing-history")) {
    lines.push(`### ${t.id}${t.transportInvalid ? " — INVALID_TRANSPORT" : ""}`);
    lines.push("");
    lines.push(`user: ${t.userLine}`);
    lines.push("");
    lines.push(
      `chars=${t.chars} outputTokens=${t.outputTokens} inputTokens=${t.inputTokens} finish=${t.finishReason} actualKRW=${t.actualKrw} userP=${t.userP} margin=${t.realizedMarginPct}`
    );
    lines.push("");
    lines.push(`flags: ${JSON.stringify(t.flags)}`);
    lines.push("");
    lines.push("[RAW]");
    lines.push("");
    lines.push(t.raw || "(empty)");
    lines.push("");
  }
  lines.push("## Cost");
  lines.push("");
  lines.push("| id | chars | in | out | KRW | userP | margin |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const t of valid) {
    lines.push(
      `| ${t.id} | ${t.chars} | ${t.inputTokens} | ${t.outputTokens} | ${t.actualKrw} | ${t.userP} | ${t.realizedMarginPct} |`
    );
  }
  const totalKrw = round3(valid.reduce((s, t) => s + t.actualKrw, 0));
  const totalP = valid.reduce((s, t) => s + t.userP, 0);
  lines.push("");
  lines.push(
    `valid totals: ${totalP}P revenue / ${totalKrw} KRW actual / margin ${
      totalP > 0 ? round1((1 - totalKrw / totalP) * 100) : "n/a"
    }%`
  );
  lines.push("");
  lines.push("Price table was not modified. userP uses the current Gemini 3.7 V2 formula (report-only).");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const greetingHistory: ChatMsg[] = [
    { role: "assistant", content: TERRA_PROMPT_CANARY_GREETING_NEUTRAL },
  ];
  const offlineAudit = assembleRequest(greetingHistory, SHORT_SEEDS[0].user);
  if (offlineAudit.rawAudit.GEMINI37_LENGTH_OWNER_COUNT !== 1) {
    throw new Error(
      `GEMINI37_LENGTH_OWNER_COUNT=${offlineAudit.rawAudit.GEMINI37_LENGTH_OWNER_COUNT}`
    );
  }
  if (offlineAudit.rawAudit.location !== "system") {
    throw new Error(`owner location=${offlineAudit.rawAudit.location}`);
  }
  if (offlineAudit.genericInUser || offlineAudit.ownerInUserTail) {
    throw new Error("length owner leaked onto user tail");
  }
  if (offlineAudit.rejectedBPresent) {
    throw new Error("rejected B sentence present");
  }
  if (offlineAudit.reasoningEffort !== "low") {
    throw new Error(`reasoning_effort=${String(offlineAudit.reasoningEffort)}`);
  }

  const turns: TurnRecord[] = [];
  for (const seed of SHORT_SEEDS) {
    turns.push(await runTurn(seed.id, "short-context", greetingHistory, seed.user));
  }

  const growingSpecs = [
    { id: "G1", through: 7, user: USER_TURNS_T1_T13[7] },
    { id: "G2", through: 9, user: USER_TURNS_T1_T13[9] },
    { id: "G3", through: 12, user: USER_TURNS_T1_T13[12] },
  ] as const;
  for (const spec of growingSpecs) {
    const history = buildGrowingHistoryThrough(spec.through);
    turns.push(await runTurn(spec.id, "growing-history", history, spec.user));
  }

  const valid = turns.filter((t) => !t.transportInvalid);
  const judged = verdict(valid);
  const report = renderReport({ offlineAudit, turns, judged });
  const payload = {
    model: MODEL,
    reasoningEffort: offlineAudit.reasoningEffort,
    maxTokens: offlineAudit.maxTokens,
    owner: {
      text: GEMINI37_FLASH_LENGTH_OWNER_BLOCK,
      ...offlineAudit.rawAudit,
      genericInUser: offlineAudit.genericInUser,
      ownerInUserTail: offlineAudit.ownerInUserTail,
      rejectedBPresent: offlineAudit.rejectedBPresent,
    },
    turns,
    validCharStats: stats(valid.map((t) => t.chars)),
    judged,
  };

  for (const dir of [OUT_DIR, ARTIFACT_DIR]) {
    save(dir, "REPORT.md", report);
    save(dir, "RUNTIME.json", payload);
    save(dir, "offline-request-audit.json", {
      maxTokens: offlineAudit.maxTokens,
      reasoningEffort: offlineAudit.reasoningEffort,
      owner: offlineAudit.rawAudit,
      genericInUser: offlineAudit.genericInUser,
      ownerInUserTail: offlineAudit.ownerInUserTail,
      rejectedBPresent: offlineAudit.rejectedBPresent,
    });
    for (const t of turns) {
      save(dir, `${t.id.toLowerCase()}-raw.txt`, t.raw);
    }
  }

  console.log(
    JSON.stringify(
      {
        out: path.join(OUT_DIR, "REPORT.md"),
        ownerCount: offlineAudit.rawAudit.GEMINI37_LENGTH_OWNER_COUNT,
        location: offlineAudit.rawAudit.location,
        maxTokens: offlineAudit.maxTokens,
        reasoningEffort: offlineAudit.reasoningEffort,
        judged,
        turns: turns.map((t) => ({
          id: t.id,
          chars: t.chars,
          inputTokens: t.inputTokens,
          outputTokens: t.outputTokens,
          finish: t.finishReason,
          transportInvalid: t.transportInvalid,
          userP: t.userP,
          actualKrw: t.actualKrw,
        })),
      },
      null,
      2
    )
  );
}

void main();
