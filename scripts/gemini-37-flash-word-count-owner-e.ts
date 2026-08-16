/**
 * Experiment E — word-count USER_TAIL A/B for Gemini 3.7 Flash.
 * Production owner stays 3,200자. B only swaps that phrase to 1,100~1,500단어
 * on the already-assembled last user turn.
 *
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-word-count-owner-e.ts
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-word-count-owner-e.ts --phase=growing
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
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { openRouterUsdCostFromRates } from "../src/lib/openRouterModelPricing";
import { getEffectiveKrwPerUsd } from "../src/lib/exchangeRate";
import { GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE } from "../src/lib/gemini31UserAgencyAdapter";
import {
  applyWordCountOwnerSwap,
  assertWordCountAssembledDiff,
  WORD_COUNT_OWNER_SENTENCE,
} from "../src/lib/gemini37FlashWordCountOwnerE";
import type { ChatMsg } from "../src/lib/ai";

const MODEL = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const OUT_DIR = path.join(process.cwd(), "docs/audits/gemini-37-flash-word-count-owner-e");
const ARTIFACT_DIR = path.join("/opt/cursor/artifacts", "gemini-37-flash-word-count-owner-e");
const PRICING_DIR = path.join(process.cwd(), "docs/audits/gemini-37-flash-pricing");

const JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

const SHORT_FIXTURES = [
  { id: "S1", user: "나는 렌이라고… 본 기억이 안 나는데… 나 알아?", speechActNeed: "recognition" },
  { id: "S2", user: "같이 갈래? *두리번*", speechActNeed: "go-together" },
  { id: "S3", user: "*가방 끈을 꼭 쥐고* 음… 조금만. 나 길 잘 모르거든.", speechActNeed: "limited-accept" },
] as const;

const GROWING_USER_TURNS = [
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

function save(dir: string, name: string, content: string | object) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, name),
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    "utf8"
  );
}

function greetingHistory(): ChatMsg[] {
  return [{ role: "assistant", content: TERRA_PROMPT_CANARY_GREETING_NEUTRAL }];
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

function lastUser(history: ChatMsg[]): ChatMsg {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === "user") return history[i]!;
  }
  throw new Error("no user turn");
}

function swapHistoryToWordCount(history: ChatMsg[]): ChatMsg[] {
  const out = history.map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]?.role === "user") {
      out[i] = { ...out[i]!, content: applyWordCountOwnerSwap(out[i]!.content) };
      break;
    }
  }
  return out;
}

function visibleMetrics(text: string) {
  const visible = text.replace(/\r/g, "");
  const charsIncl = [...visible].length;
  const charsExcl = [...visible.replace(/\s/g, "")].length;
  const wordCount = visible.trim() ? visible.trim().split(/\s+/).length : 0;
  return { charsIncl, charsExcl, wordCount };
}

function qualityFlags(text: string, speechActNeed: string) {
  const obviousRepetition = /(.{20,})\1\1/.test(text);
  const questionLoop = (text.match(/\?/g) ?? []).length >= 8;
  const emotionRestate = /가슴이 뛰|심장이 뛰|얼굴이 달아/.test(text) &&
    (text.match(/가슴이 뛰|심장이 뛰|얼굴이 달아/g) ?? []).length >= 4;
  const agencyRegression =
    /렌이 말했다|렌은 고개를 끄덕였다/.test(text) ||
    /렌은 .{0,20}(대답했다|승낙했다|거절했다|키스했다)/.test(text);
  const summaryPreview = /다음 장면|다음에 계속|요약하면/.test(text);
  let speechActOk = true;
  if (speechActNeed === "recognition") speechActOk = /렌|기억|알|낯/.test(text);
  else if (speechActNeed === "go-together") speechActOk = /같이|가|어디/.test(text);
  else if (speechActNeed === "limited-accept") speechActOk = /조금|길|안내|데리/.test(text);
  return { obviousRepetition, questionLoop, emotionRestate, agencyRegression, summaryPreview, speechActOk };
}

function streamContentToText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(streamContentToText).join("");
  if (typeof content === "object") {
    const o = content as { text?: unknown; content?: unknown };
    if (typeof o.text === "string") return o.text;
    if (typeof o.content === "string") return o.content;
    if (o.content != null) return streamContentToText(o.content);
  }
  return "";
}

function consumeSseLine(
  line: string,
  state: {
    text: string;
    finishReason: string | null;
    resolvedModel: string | null;
    usageRaw: unknown;
    ttftMs: number | null;
    started: number;
  }
) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) return;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return;
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return;
  }
  if (typeof ev.model === "string") state.resolvedModel = ev.model;
  if (ev.usage) state.usageRaw = ev.usage;
  const choice0 = Array.isArray(ev.choices) ? ev.choices[0] : null;
  if (!choice0 || typeof choice0 !== "object") return;
  const choice = choice0 as Record<string, unknown>;
  if (typeof choice.finish_reason === "string" && choice.finish_reason) {
    state.finishReason = choice.finish_reason;
  }
  const delta = (choice.delta ?? {}) as Record<string, unknown>;
  const piece = streamContentToText(delta.content);
  if (piece) {
    if (state.ttftMs == null) state.ttftMs = Date.now() - state.started;
    state.text += piece;
  }
}

async function callOnce(requestBody: Record<string, unknown>) {
  const started = Date.now();
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(),
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const state = {
    text: "",
    finishReason: null as string | null,
    resolvedModel: null as string | null,
    usageRaw: null as unknown,
    ttftMs: null as number | null,
    started,
  };
  if (!res.body) {
    return { httpStatus: res.status, latencyMs: Date.now() - started, ...state };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    if (done) buffer += decoder.decode();
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) consumeSseLine(line, state);
    if (done) break;
  }
  return { httpStatus: res.status, latencyMs: Date.now() - started, ...state };
}

function isInvalidTransport(resp: {
  httpStatus: number;
  text: string;
  finishReason: string | null;
  usageRaw: unknown;
}): boolean {
  const usage = parseOpenRouterUsage(resp.usageRaw);
  return resp.httpStatus >= 400 || (resp.finishReason == null && usage.completionTokens === 0);
}

function assembleArm(built: ReturnType<typeof buildTurnContext>, arm: "A" | "B") {
  const history = arm === "A" ? built.history : swapHistoryToWordCount(built.history);
  if (arm === "B") {
    assertWordCountAssembledDiff({
      systemA: built.systemPrompt ?? "",
      systemB: built.systemPrompt ?? "",
      historyA: built.history,
      historyB: history,
    });
  }
  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt ?? "",
    history,
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
  requestBody.reasoning_effort = "low";
  delete requestBody.max_tokens;
  requestBody.stream_options = { include_usage: true };
  return { history, requestBody };
}

async function runCell(opts: {
  id: string;
  user: string;
  arm: "A" | "B";
  history: ChatMsg[];
  speechActNeed: string;
}) {
  const built = buildTurnContext(opts.history, opts.user);
  const { requestBody } = assembleArm(built, opts.arm);
  const last = lastUser(opts.arm === "A" ? built.history : swapHistoryToWordCount(built.history));
  const owner = opts.arm === "A" ? USER_TAIL_LENGTH_OWNER_SENTENCE : WORD_COUNT_OWNER_SENTENCE;
  const resp = await callOnce(requestBody);
  const usage = parseOpenRouterUsage(resp.usageRaw);
  const invalid = isInvalidTransport(resp);
  const metrics = visibleMetrics(resp.text);
  const usd = openRouterUsdCostFromRates({
    modelId: MODEL,
    promptTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  });
  const rawUsd = usage.upstreamCostUsd ?? usd.usdCost;
  return {
    id: opts.id,
    arm: opts.arm,
    user: opts.user,
    invalidTransport: invalid,
    charsInclSpaces: metrics.charsIncl,
    charsExclSpaces: metrics.charsExcl,
    wordCount: metrics.wordCount,
    outputTokens: usage.completionTokens,
    inputTokens: usage.promptTokens,
    finish: resp.finishReason,
    httpStatus: resp.httpStatus,
    reasoningEffort: requestBody.reasoning_effort ?? null,
    maxTokens: requestBody.max_tokens ?? null,
    apiRawCostUsd: rawUsd,
    apiRawCostKrw: rawUsd * getEffectiveKrwPerUsd(),
    ownerCount: last.content.split(owner).length - 1,
    ownerLast: last.content.trimEnd().endsWith(owner),
    systemHasOwner:
      (built.systemPrompt ?? "").includes(USER_TAIL_LENGTH_OWNER_SENTENCE) ||
      (built.systemPrompt ?? "").includes(WORD_COUNT_OWNER_SENTENCE),
    gemini31Agency: (built.systemPrompt ?? "").includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE),
    ...qualityFlags(resp.text, opts.speechActNeed),
    raw: resp.text,
  };
}

function judgeShort(
  rows: Array<{
    arm: string;
    invalidTransport: boolean;
    charsInclSpaces: number;
    obviousRepetition: boolean;
    questionLoop: boolean;
    emotionRestate: boolean;
    agencyRegression: boolean;
    speechActOk: boolean;
  }>
) {
  const valid = rows.filter((r) => !r.invalidTransport);
  const a = valid.filter((r) => r.arm === "A");
  const b = valid.filter((r) => r.arm === "B");
  const avg = (xs: typeof valid) =>
    xs.length ? xs.reduce((s, r) => s + r.charsInclSpaces, 0) / xs.length : 0;
  const avgA = avg(a);
  const avgB = avg(b);
  const enoughB = b.length >= 2;
  const longer =
    enoughB && (avgB >= 3500 || (avgA > 0 && avgB >= avgA * 1.25));
  const qualityOk =
    enoughB &&
    b.every((r) => !r.obviousRepetition && !r.questionLoop && !r.emotionRestate && !r.agencyRegression);
  const wordCountSignal = enoughB && longer && qualityOk;
  return {
    validA: a.length,
    validB: b.length,
    avgA: Math.round(avgA * 10) / 10,
    avgB: Math.round(avgB * 10) / 10,
    enoughB,
    longer,
    qualityOk,
    WORD_COUNT_SIGNAL: wordCountSignal,
    KEEP_VANILLA: !wordCountSignal,
    WORD_COUNT_CANDIDATE: wordCountSignal,
  };
}

function loadGrowingHistory(throughTurn: number, nextUser: string): { history: ChatMsg[]; user: string } {
  const history: ChatMsg[] = greetingHistory();
  for (let i = 1; i <= throughTurn; i++) {
    const user = GROWING_USER_TURNS[i - 1];
    const rawPath = path.join(PRICING_DIR, `t${i}-raw.txt`);
    if (!user || !fs.existsSync(rawPath)) {
      throw new Error(`missing growing snapshot t${i}`);
    }
    history.push({ role: "user", content: user });
    history.push({ role: "assistant", content: fs.readFileSync(rawPath, "utf8") });
  }
  return { history, user: nextUser };
}

function renderReport(opts: {
  phase: string;
  assembled: ReturnType<typeof assertWordCountAssembledDiff>;
  rows: Array<Record<string, unknown>>;
  judgement: ReturnType<typeof judgeShort>;
}): string {
  return [
    "# Gemini 3.7 Flash experiment E — word-count USER_TAIL",
    "",
    "```text",
    "B SYSTEM sentence = REJECT",
    "C terminal placement = REJECT",
    "#432 SYSTEM owner = REJECT",
    "D 3200→4000 numeric-only = REJECT",
    "production = vanilla USER_TAIL 3200자",
    "E = 3,200자 이상 → 1,100~1,500단어 only",
    `phase = ${opts.phase}`,
    "retry = 0",
    "continuation = 0",
    "recovery = 0",
    "reasoning_effort = low",
    "max_tokens = omitted",
    "```",
    "",
    "```text",
    JSON.stringify(opts.assembled, null, 2),
    "```",
    "",
    "| cell | arm | chars+sp | chars-sp | words | outTok | inTok | finish | invalid | rep | agency |",
    "|---|---|---:|---:|---:|---:|---:|---|---|---|---|",
    ...opts.rows.map(
      (r) =>
        `| ${r.id} | ${r.arm} | ${r.charsInclSpaces} | ${r.charsExclSpaces} | ${r.wordCount} | ${r.outputTokens} | ${r.inputTokens} | ${r.finish} | ${r.invalidTransport} | ${r.obviousRepetition} | ${r.agencyRegression} |`
    ),
    "",
    "```text",
    JSON.stringify(opts.judgement, null, 2),
    "```",
    "",
    ...opts.rows.flatMap((r) => [`## ${r.id} ${r.arm}`, "", String(r.raw ?? ""), ""]),
  ].join("\n");
}

async function main() {
  const phase = process.argv.includes("--phase=growing") ? "growing" : "short";
  const fixtures =
    phase === "short"
      ? SHORT_FIXTURES.map((f) => ({ ...f, history: greetingHistory() }))
      : [
          { id: "G20", ...loadGrowingHistory(6, GROWING_USER_TURNS[6]!), speechActNeed: "open" },
          { id: "G30", ...loadGrowingHistory(9, GROWING_USER_TURNS[9]!), speechActNeed: "open" },
          { id: "G40", ...loadGrowingHistory(12, GROWING_USER_TURNS[12]!), speechActNeed: "open" },
        ];

  const probe = buildTurnContext(greetingHistory(), SHORT_FIXTURES[0]!.user);
  const assembled = assertWordCountAssembledDiff({
    systemA: probe.systemPrompt ?? "",
    systemB: probe.systemPrompt ?? "",
    historyA: probe.history,
    historyB: swapHistoryToWordCount(probe.history),
  });
  if ((probe.systemPrompt ?? "").includes(USER_TAIL_LENGTH_OWNER_SENTENCE)) {
    throw new Error("SYSTEM owner leak");
  }

  const rows = [];
  for (const fixture of fixtures) {
    for (const arm of ["A", "B"] as const) {
      const cell = await runCell({
        id: fixture.id,
        user: fixture.user,
        arm,
        history: fixture.history,
        speechActNeed: fixture.speechActNeed,
      });
      rows.push(cell);
      save(OUT_DIR, `${fixture.id}-${arm}-raw.txt`, cell.raw);
      save(ARTIFACT_DIR, `${fixture.id}-${arm}-raw.txt`, cell.raw);
      console.log(
        JSON.stringify({
          id: cell.id,
          arm: cell.arm,
          chars: cell.charsInclSpaces,
          words: cell.wordCount,
          out: cell.outputTokens,
          finish: cell.finish,
          invalid: cell.invalidTransport,
        })
      );
    }
  }

  const judgement = judgeShort(rows);
  const report = renderReport({ phase, assembled, rows, judgement });
  const payload = {
    phase,
    model: MODEL,
    assembled,
    judgement,
    rows: rows.map(({ raw, ...rest }) => rest),
    rawByCell: Object.fromEntries(rows.map((r) => [`${r.id}-${r.arm}`, r.raw])),
  };
  for (const dir of [OUT_DIR, ARTIFACT_DIR]) {
    save(dir, "REPORT.md", report);
    save(dir, "RUNTIME.json", payload);
    save(dir, "ASSEMBLED_AUDIT.json", assembled);
  }
  console.log(JSON.stringify({ judgement, out: path.join(OUT_DIR, "REPORT.md") }, null, 2));
}

void main();
