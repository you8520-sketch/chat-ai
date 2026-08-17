/**
 * Experiment D — vanilla USER_TAIL owner numeric-only A/B.
 * A = 3,200. B = Gemini 3.7 Flash only 4,000. One template.
 * No retry / continuation / recovery. INVALID_TRANSPORT excluded.
 *
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-numeric-owner-d.ts
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-numeric-owner-d.ts --phase=growing
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
import {
  GEMINI37_FLASH_NUMERIC_OWNER_MODEL_ID,
  resolveUserTailLengthOwnerSentence,
  type UserTailLengthOwnerArm,
} from "../src/lib/responseLength";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE } from "../src/lib/gemini31UserAgencyAdapter";
import type { ChatMsg } from "../src/lib/ai";

const MODEL = GEMINI37_FLASH_NUMERIC_OWNER_MODEL_ID;
const OUT_DIR = path.join(
  process.cwd(),
  "docs/audits/gemini-37-flash-numeric-owner-d"
);
const ARTIFACT_DIR = path.join(
  "/opt/cursor/artifacts",
  "gemini-37-flash-numeric-owner-d"
);

const JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

const SHORT_FIXTURES = [
  {
    id: "S1",
    user: "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
    speechActNeed: "recognition",
  },
  {
    id: "S2",
    user: "같이 갈래? *두리번*",
    speechActNeed: "go-together",
  },
  {
    id: "S3",
    user: "*가방 끈을 꼭 쥐고* 음… 조금만. 나 길 잘 모르거든.",
    speechActNeed: "limited-accept",
  },
] as const;

const GROWING_FIXTURES = [
  { id: "G1", user: "너는 여기서 오래 일했어?" },
  { id: "G2", user: "일단 네 말대로 가볼게. 옆에 있어줄래?" },
  { id: "G3", user: "이명, 지금은 좀 어때." },
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

function buildTurnContext(
  history: ChatMsg[],
  currentUserMessage: string,
  arm: UserTailLengthOwnerArm
) {
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
    userTailLengthOwnerArm: arm,
  });
}

function lastUserContent(history: ChatMsg[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === "user") return history[i]!.content;
  }
  return "";
}

function ownerAudit(built: ReturnType<typeof buildContext>, arm: UserTailLengthOwnerArm) {
  const owner = resolveUserTailLengthOwnerSentence({
    modelId: MODEL,
    experimentArm: arm,
  });
  const lastUser = lastUserContent(built.history);
  const system = built.systemPrompt ?? "";
  return {
    owner,
    ownerCount: lastUser.split(owner).length - 1,
    ownerLast: lastUser.trimEnd().endsWith(owner),
    systemHasOwner: system.includes(owner) || system.includes("3,200") || system.includes("4,000"),
    gemini31Agency: system.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE),
    rejectedB: /약 3,200~4,000자 분량으로 완성한다/.test(system + lastUser),
    rejectedC: /\[RESPONSE LENGTH — GEMINI 3\.7 FLASH\]/.test(system + lastUser),
  };
}

function assertNumericOnlyAssembled(
  a: ReturnType<typeof buildContext>,
  b: ReturnType<typeof buildContext>
) {
  if ((a.systemPrompt ?? "") !== (b.systemPrompt ?? "")) {
    throw new Error("SYSTEM diff != 0");
  }
  if (a.history.length !== b.history.length) {
    throw new Error("history length diff");
  }
  for (let i = 0; i < a.history.length - 1; i++) {
    if (JSON.stringify(a.history[i]) !== JSON.stringify(b.history[i])) {
      throw new Error(`history diff at ${i}`);
    }
  }
  const lastA = lastUserContent(a.history);
  const lastB = lastUserContent(b.history);
  if (lastB !== lastA.replaceAll("3,200", "4,000")) {
    throw new Error("current user / owner diff is not 3,200 -> 4,000 only");
  }
  if (lastA.replaceAll("3,200", "") !== lastB.replaceAll("4,000", "")) {
    throw new Error("non-numeric owner residue");
  }
}

function qualityFlags(text: string, speechActNeed: string) {
  const obviousRepetition = /(.{20,})\1\1/.test(text);
  const agencyRegression =
    /렌이 말했다|렌은 고개를 끄덕였다/.test(text) ||
    /렌은 .{0,20}(대답했다|승낙했다|거절했다|키스했다)/.test(text);
  let speechActOk = true;
  if (speechActNeed === "recognition") {
    speechActOk = /렌|기억|알|낯/.test(text);
  } else if (speechActNeed === "go-together") {
    speechActOk = /같이|가|어디/.test(text);
  } else if (speechActNeed === "limited-accept") {
    speechActOk = /조금|길|안내|데리/.test(text);
  }
  return {
    obviousRepetition,
    agencyRegression,
    speechActOk,
  };
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

function extractDeltaText(choice: Record<string, unknown>): string {
  const delta = (choice.delta ?? {}) as Record<string, unknown>;
  const fromContent = streamContentToText(delta.content);
  if (fromContent) return fromContent;
  if (typeof delta.text === "string" && delta.text) return delta.text;
  const message = (choice.message ?? {}) as Record<string, unknown>;
  const fromMessage = streamContentToText(message.content);
  if (fromMessage) return fromMessage;
  if (typeof choice.text === "string" && choice.text) return choice.text;
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
    sawDone: boolean;
  }
) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return;
  if (!trimmed.startsWith("data:")) return;
  const data = trimmed.slice(5).trim();
  if (!data) return;
  if (data === "[DONE]") {
    state.sawDone = true;
    return;
  }
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
  const piece = extractDeltaText(choice);
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
  const httpStatus = res.status;
  const state = {
    text: "",
    finishReason: null as string | null,
    resolvedModel: null as string | null,
    usageRaw: null as unknown,
    ttftMs: null as number | null,
    started,
    sawDone: false,
  };
  if (!res.body) {
    return { httpStatus, latencyMs: Date.now() - started, ...state };
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
  return { httpStatus, latencyMs: Date.now() - started, ...state };
}

function isInvalidTransport(resp: {
  httpStatus: number;
  text: string;
  finishReason: string | null;
  usageRaw: unknown;
}): boolean {
  const usage = parseOpenRouterUsage(resp.usageRaw);
  return (
    resp.httpStatus >= 400 ||
    (resp.finishReason == null && usage.completionTokens === 0)
  );
}

async function runCell(opts: {
  id: string;
  user: string;
  arm: UserTailLengthOwnerArm;
  history: ChatMsg[];
  speechActNeed: string;
}) {
  const built = buildTurnContext(opts.history, opts.user, opts.arm);
  const audit = ownerAudit(built, opts.arm);
  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt ?? "",
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
  requestBody.reasoning_effort = "low";
  delete requestBody.max_tokens;
  requestBody.stream_options = { include_usage: true };
  const resp = await callOnce(requestBody);
  const usage = parseOpenRouterUsage(resp.usageRaw);
  const invalid = isInvalidTransport(resp);
  const chars = [...resp.text.replace(/\r/g, "")].length;
  return {
    id: opts.id,
    arm: opts.arm,
    user: opts.user,
    invalidTransport: invalid,
    charsIncludingSpaces: chars,
    outputTokens: usage.completionTokens,
    inputTokens: usage.promptTokens,
    finish: resp.finishReason,
    httpStatus: resp.httpStatus,
    reasoningEffort: requestBody.reasoning_effort ?? null,
    maxTokens: requestBody.max_tokens ?? null,
    upstreamCostUsd: usage.upstreamCostUsd ?? null,
    ownerCount: audit.ownerCount,
    ownerLast: audit.ownerLast,
    systemHasOwner: audit.systemHasOwner,
    rejectedB: audit.rejectedB,
    rejectedC: audit.rejectedC,
    gemini31Agency: audit.gemini31Agency,
    ...qualityFlags(resp.text, opts.speechActNeed),
    raw: resp.text,
  };
}

function judgeShort(
  rows: Array<{
    arm: string;
    invalidTransport: boolean;
    charsIncludingSpaces: number;
    obviousRepetition: boolean;
    agencyRegression: boolean;
    speechActOk: boolean;
  }>
) {
  const valid = rows.filter((r) => !r.invalidTransport);
  const a = valid.filter((r) => r.arm === "A");
  const b = valid.filter((r) => r.arm === "B");
  const avg = (xs: typeof valid) =>
    xs.length ? xs.reduce((s, r) => s + r.charsIncludingSpaces, 0) / xs.length : 0;
  const avgA = avg(a);
  const avgB = avg(b);
  const longer = avgB > avgA * 1.08 && avgB - avgA >= 150;
  const shorterOrFlat = avgB <= avgA;
  const meanGe3000 = avgB >= 3000;
  const noRep = b.every((r) => !r.obviousRepetition);
  const noAgency = b.every((r) => !r.agencyRegression);
  const speechOk = b.every((r) => r.speechActOk);
  let verdict: "NUMERIC_OWNER_CANDIDATE" | "KEEP_VANILLA" | "STOP_SHORT_NO_GAIN" =
    "KEEP_VANILLA";
  if (shorterOrFlat || !longer) verdict = "STOP_SHORT_NO_GAIN";
  if (longer && meanGe3000 && noRep && noAgency && speechOk) {
    verdict = "NUMERIC_OWNER_CANDIDATE";
  } else if (longer) {
    verdict = "KEEP_VANILLA";
  }
  return {
    validA: a.length,
    validB: b.length,
    avgA: Math.round(avgA * 10) / 10,
    avgB: Math.round(avgB * 10) / 10,
    longer,
    meanGe3000,
    noRep,
    noAgency,
    speechOk,
    verdict,
  };
}

function renderReport(opts: {
  phase: string;
  assembledOk: boolean;
  rows: Array<Record<string, unknown>>;
  judgement: ReturnType<typeof judgeShort>;
}): string {
  const lines = [
    "# Gemini 3.7 Flash experiment D — numeric-only USER_TAIL owner",
    "",
    "```text",
    "SYSTEM length owner = REJECT (#432 closed)",
    "B wording = REJECT",
    "C wording = REJECT",
    "production = vanilla USER_TAIL",
    "D = 3,200 vs 4,000 number only",
    `phase = ${opts.phase}`,
    "retry = 0",
    "continuation = 0",
    "recovery = 0",
    "reasoning_effort = low",
    "max_tokens = omitted",
    "```",
    "",
    `assembled A/B numeric-only: ${opts.assembledOk}`,
    "",
    `| cell | arm | chars | outTok | finish | invalid | rep | agency | speech |`,
    `|---|---|---:|---:|---|---|---|---|---|`,
    ...opts.rows.map(
      (r) =>
        `| ${r.id} | ${r.arm} | ${r.charsIncludingSpaces} | ${r.outputTokens} | ${r.finish} | ${r.invalidTransport} | ${r.obviousRepetition} | ${r.agencyRegression} | ${r.speechActOk} |`
    ),
    "",
    "```text",
    JSON.stringify(opts.judgement, null, 2),
    "```",
    "",
  ];
  for (const r of opts.rows) {
    lines.push(`## ${r.id} ${r.arm}`, "", `[RAW]`, "", String(r.raw ?? ""), "");
  }
  return lines.join("\n");
}

async function main() {
  const phase = process.argv.includes("--phase=growing") ? "growing" : "short";
  const history = greetingHistory();
  const fixtures =
    phase === "short"
      ? SHORT_FIXTURES.map((f) => ({ ...f, history }))
      : GROWING_FIXTURES.map((f) => ({
          ...f,
          history,
          speechActNeed: "open",
        }));

  const assembledA = buildTurnContext(history, fixtures[0]!.user, "A");
  const assembledB = buildTurnContext(history, fixtures[0]!.user, "B");
  assertNumericOnlyAssembled(assembledA, assembledB);
  const auditA = ownerAudit(assembledA, "A");
  const auditB = ownerAudit(assembledB, "B");
  if (auditA.ownerCount !== 1 || auditB.ownerCount !== 1) {
    throw new Error("owner count != 1");
  }
  if (auditA.systemHasOwner || auditB.systemHasOwner) {
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
        speechActNeed: "speechActNeed" in fixture ? fixture.speechActNeed : "open",
      });
      rows.push(cell);
      save(OUT_DIR, `${fixture.id}-${arm}-raw.txt`, cell.raw);
      save(ARTIFACT_DIR, `${fixture.id}-${arm}-raw.txt`, cell.raw);
      console.log(
        JSON.stringify({
          id: cell.id,
          arm: cell.arm,
          chars: cell.charsIncludingSpaces,
          out: cell.outputTokens,
          finish: cell.finish,
          invalid: cell.invalidTransport,
        })
      );
    }
  }

  const judgement = judgeShort(rows);
  const report = renderReport({
    phase,
    assembledOk: true,
    rows,
    judgement,
  });
  const payload = {
    phase,
    model: MODEL,
    assembledOk: true,
    auditA,
    auditB,
    judgement,
    rows: rows.map(({ raw, ...rest }) => rest),
    rawByCell: Object.fromEntries(rows.map((r) => [`${r.id}-${r.arm}`, r.raw])),
  };
  for (const dir of [OUT_DIR, ARTIFACT_DIR]) {
    save(dir, "REPORT.md", report);
    save(dir, "RUNTIME.json", payload);
  }
  console.log(JSON.stringify({ judgement, out: path.join(OUT_DIR, "REPORT.md") }, null, 2));
}

void main();
