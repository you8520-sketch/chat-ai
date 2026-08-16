/**
 * Gemini 3.7 Flash — A vs B 6-seed length sample expansion.
 * A = vanilla (length sentence stripped in harness only).
 * B = same sentence once in system/model-specific (production B placement).
 * C is not run. No new sentence. retry/continuation/recovery = 0.
 *
 *   node --conditions=react-server --import tsx scripts/gemini-37-flash-length-ab-6seed.ts
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
const OUT_DIR = path.join(process.cwd(), "docs/audits/gemini-37-flash-length-ab-6seed");
const ARTIFACT_DIR = path.join("/opt/cursor/artifacts", "gemini-37-flash-length-ab-6seed");

const SEEDS = [
  "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
  "같이 갈래? *두리번*",
  "*가방 끈을 꼭 쥐고* 음… 조금만. 나 길 잘 모르거든.",
  "*나란히 걷다 멈춰 서서* 여기… 자주 오는 곳이야?",
  "*물병을 꺼내 내민다* …목마르면 마셔. 나 괜찮으니까.",
  "*벽에 기대 숨을 고른다* 잠깐만… 여기 좀 쉬자.",
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

function stripLengthSentence(text: string): string {
  return text.split(GEMINI37_FLASH_LENGTH_SENTENCE).join("").replace(/\n{3,}/g, "\n\n").trim();
}

function qualityFlags(text: string, seedIndex: number, finishReason: string | null) {
  const obviousRepetition = /(.{20,})\1\1/.test(text);
  const sameMeaningQuestionRepeat =
    (text.match(/\?/g) ?? []).length >= 8 ||
    /나 알아\?.{0,80}나 알아\?|같이 갈래\?.{0,80}같이 갈래\?/.test(text);
  const malformedMeta =
    /\[SYSTEM|as an AI|I am Gemini|language model|safety policy/i.test(text);
  const userAgency =
    /렌이 말했다|렌은 고개를 끄덕였다/.test(text) ||
    /렌은 .{0,20}(대답했다|승낙했다|거절했다|키스했다)/.test(text);
  const offSceneSummary =
    /다음 화|다음 장면에서는|이후의 이야기|요약하면|앞으로 .+게 될 것이다/.test(text);
  const speechActEvidence: string[] = [];
  if (seedIndex === 1) {
    const checks: Array<[RegExp, string]> = [
      [/렌(?:은|이).{0,40}제안.{0,16}(?:받아들|승낙|응했)/, "렌이 제안을 수락한 것으로 서술"],
      [/(?:덤덤한 어조로|넙죽|순순히).{0,16}제안.{0,12}(?:받아들|승낙)/, "제안을 넙죽/순순히 받아들"],
      [/제안을\s*넙죽\s*받아들/, "제안을 넙죽 받아들"],
      [/덥석\s*같이\s*가자고/, "덥석 같이 가자고 (user-as-acceptor)"],
    ];
    for (const [re, label] of checks) {
      if (re.test(text)) speechActEvidence.push(label);
    }
  }
  if (seedIndex === 4) {
    if (/렌(?:은|이).{0,24}(?:마셨|받아 마셨|물병을 받아)/.test(text)) {
      speechActEvidence.push("렌이 물을 마신 것으로 서술 (user offered)");
    }
  }
  return {
    obviousRepetition,
    sameMeaningQuestionRepeat,
    speechActInterpretationError: speechActEvidence.length > 0,
    speechActEvidence,
    obviousUserAgencyViolation: userAgency,
    offSceneSummaryOrForeshadow: offSceneSummary,
    malformedOrMeta: malformedMeta,
    finishTruncation: finishReason === "length",
  };
}

function buildTurnContext(userLine: string) {
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
    shortTermHistory: [{ role: "assistant", content: TERRA_PROMPT_CANARY_GREETING_NEUTRAL }],
    currentUserMessage: userLine,
    nsfw: false,
    gender: "male",
    provider: "cheaperinference",
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    completedTurns: 0,
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

function applyArmToBuilt(
  arm: "A" | "B",
  built: ReturnType<typeof buildContext>
): ReturnType<typeof buildContext> {
  if (arm === "B") return built;
  const split = built.openRouterSystemSplit;
  return {
    ...built,
    systemPrompt: stripLengthSentence(built.systemPrompt ?? ""),
    openRouterSystemSplit: split
      ? {
          ...split,
          systemRulesBlock: stripLengthSentence(split.systemRulesBlock ?? ""),
          characterSettingsBlock: stripLengthSentence(split.characterSettingsBlock ?? ""),
          dynamicBlock: stripLengthSentence(split.dynamicBlock ?? ""),
        }
      : split,
    history: built.history.map((m) =>
      m.role === "user"
        ? { ...m, content: stripLengthSentence(m.content) }
        : m
    ),
  };
}

async function runCell(arm: "A" | "B", seedIndex: number, userLine: string) {
  const label = `${arm}${seedIndex + 1}`;
  const built = applyArmToBuilt(arm, buildTurnContext(userLine));
  const system = built.systemPrompt ?? "";
  const lastUser = built.history[built.history.length - 1];
  const lastUserText = lastUser?.role === "user" ? lastUser.content : "";
  const systemCount = countOccurrences(system, GEMINI37_FLASH_LENGTH_SENTENCE);
  const userCount = countOccurrences(lastUserText, GEMINI37_FLASH_LENGTH_SENTENCE);
  if (system.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE)) {
    throw new Error(`${label}: Gemini 3.1 agency leaked`);
  }
  if (arm === "A" && (systemCount !== 0 || userCount !== 0)) {
    throw new Error(`${label}: A must not contain the length sentence`);
  }
  if (arm === "B" && (systemCount !== 1 || userCount !== 0)) {
    throw new Error(
      `${label}: B must have the sentence once in system, never in user-tail (${systemCount}/${userCount})`
    );
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
  const messages = (requestBody.messages ?? assembled.messages) as Array<{
    role: string;
    content: unknown;
  }>;
  const assembledAll = messages.map((m) => flattenMessageContent(m.content)).join("\n");
  const assembledCount = countOccurrences(assembledAll, GEMINI37_FLASH_LENGTH_SENTENCE);
  if (arm === "A" && assembledCount !== 0) {
    throw new Error(`${label}: A assembled request still has the sentence`);
  }
  if (arm === "B" && assembledCount !== 1) {
    throw new Error(`${label}: B assembled count ${assembledCount}, expected 1`);
  }
  const resp = await callOnce(requestBody);
  const usage = parseOpenRouterUsage(resp.usageRaw);
  const transportIncomplete =
    resp.finishReason == null ||
    usage.promptTokens === 0 ||
    usage.completionTokens === 0 ||
    resp.httpStatus !== 200;
  const krwPerUsd = getEffectiveKrwPerUsd();
  const usd = openRouterUsdCostFromRates({
    modelId: MODEL,
    promptTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  });
  const estimatedKrw =
    usage.upstreamCostUsd != null
      ? usage.upstreamCostUsd * krwPerUsd
      : usd.usdCost * krwPerUsd;
  const chars = [...resp.text.replace(/\r/g, "")].length;
  const flags = qualityFlags(resp.text, seedIndex, resp.finishReason);
  return {
    label,
    arm,
    seedIndex: seedIndex + 1,
    userLine,
    raw: resp.text,
    visibleCharsIncludingSpaces: chars,
    apiInputTokens: usage.promptTokens,
    apiOutputTokens: usage.completionTokens,
    upstreamCostUsd: usage.upstreamCostUsd ?? null,
    estimatedKrwApiCost: Math.round(estimatedKrw * 1000) / 1000,
    latencyMs: resp.latencyMs,
    ttftMs: resp.ttftMs,
    finishReason: resp.finishReason,
    httpStatus: resp.httpStatus,
    reasoningEffort: requestBody.reasoning_effort ?? null,
    maxTokens: requestBody.max_tokens ?? null,
    transportIncomplete,
    invalidTransport: transportIncomplete,
    systemCount,
    assembledCount,
    ...flags,
  };
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round(((s[mid - 1] + s[mid]) / 2) * 1000) / 1000 : s[mid];
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000;
}

function summarize(cells: Awaited<ReturnType<typeof runCell>>[]) {
  const valid = cells.filter((c) => !c.invalidTransport);
  const chars = valid.map((c) => c.visibleCharsIncludingSpaces);
  const min = chars.length ? Math.min(...chars) : null;
  const max = chars.length ? Math.max(...chars) : null;
  return {
    validSamples: valid.length,
    transportFailures: cells.filter((c) => c.invalidTransport).length,
    avgChars: avg(chars),
    medianChars: median(chars),
    minChars: min,
    maxChars: max,
    range: min != null && max != null ? max - min : null,
    coeffOfVariation:
      chars.length && avg(chars)
        ? Math.round(
            (Math.sqrt(chars.reduce((s, n) => s + (n - avg(chars)!) ** 2, 0) / chars.length) /
              avg(chars)!) *
              1000
          ) / 1000
        : null,
    ge2700: valid.filter((c) => c.visibleCharsIncludingSpaces >= 2700).length,
    ge3000: valid.filter((c) => c.visibleCharsIncludingSpaces >= 3000).length,
    avgOutputTokens: avg(valid.map((c) => c.apiOutputTokens)),
    avgKrw: avg(valid.map((c) => c.estimatedKrwApiCost)),
    avgLatency: avg(valid.map((c) => c.latencyMs)),
    speechActErrors: valid.filter((c) => c.speechActInterpretationError).length,
    agencyErrors: valid.filter((c) => c.obviousUserAgencyViolation).length,
    repetitionFlags: valid.filter((c) => c.obviousRepetition || c.sameMeaningQuestionRepeat).length,
    offSceneFlags: valid.filter((c) => c.offSceneSummaryOrForeshadow).length,
    malformedFlags: valid.filter((c) => c.malformedOrMeta).length,
    finishTruncations: valid.filter((c) => c.finishTruncation).length,
  };
}

function judge(
  a: ReturnType<typeof summarize>,
  b: ReturnType<typeof summarize>
): "LENGTH_ADAPTER_CANDIDATE" | "KEEP_VANILLA" {
  if (b.validSamples === 0) return "KEEP_VANILLA";
  const avgOk = (b.avgChars ?? 0) >= 3000;
  const medianNotWorse =
    a.medianChars == null || b.medianChars == null || b.medianChars >= a.medianChars;
  const extremeShortA = a.validSamples ? a.validSamples - a.ge2700 : 0;
  const extremeShortB = b.validSamples ? b.validSamples - b.ge2700 : 0;
  const shortNotWorse = extremeShortB <= extremeShortA;
  const qualityOk =
    b.speechActErrors === 0 &&
    b.agencyErrors <= a.agencyErrors &&
    b.repetitionFlags <= a.repetitionFlags + 1;
  if (avgOk && medianNotWorse && shortNotWorse && qualityOk) return "LENGTH_ADAPTER_CANDIDATE";
  return "KEEP_VANILLA";
}

async function main() {
  if (!process.env.CHEAPER_INFERENCE_API_KEY) {
    throw new Error("CHEAPER_INFERENCE_API_KEY is required");
  }
  const cells: Awaited<ReturnType<typeof runCell>>[] = [];
  for (let i = 0; i < SEEDS.length; i += 1) {
    for (const arm of ["A", "B"] as const) {
      const cell = await runCell(arm, i, SEEDS[i]);
      cells.push(cell);
      console.log(
        JSON.stringify({
          label: cell.label,
          chars: cell.visibleCharsIncludingSpaces,
          invalid: cell.invalidTransport,
          finish: cell.finishReason,
          speechAct: cell.speechActInterpretationError,
          agency: cell.obviousUserAgencyViolation,
        })
      );
    }
  }
  const aCells = cells.filter((c) => c.arm === "A");
  const bCells = cells.filter((c) => c.arm === "B");
  const A = summarize(aCells);
  const B = summarize(bCells);
  const verdict = judge(A, B);
  const bReject = verdict === "KEEP_VANILLA";

  const table = [
    "| seed | user | A chars | B chars | A finish | B finish | A speech-act | B speech-act | A agency | B agency | A invalid | B invalid |",
    "|---:|---|---:|---:|---|---|---|---|---|---|---|---|",
    ...SEEDS.map((user, i) => {
      const a = aCells[i];
      const b = bCells[i];
      return `| ${i + 1} | ${user.replace(/\|/g, "/")} | ${a.invalidTransport ? "INVALID_TRANSPORT" : a.visibleCharsIncludingSpaces} | ${b.invalidTransport ? "INVALID_TRANSPORT" : b.visibleCharsIncludingSpaces} | ${a.finishReason ?? "n/a"} | ${b.finishReason ?? "n/a"} | ${a.speechActInterpretationError} | ${b.speechActInterpretationError} | ${a.obviousUserAgencyViolation} | ${b.obviousUserAgencyViolation} | ${a.invalidTransport} | ${b.invalidTransport} |`;
    }),
  ].join("\n");

  const report = `# Gemini 3.7 Flash — A vs B 6-seed length expansion

\`\`\`text
model = ${MODEL}
reasoning_effort = low
max_tokens = omitted (production)
A = vanilla, no Gemini 3.7 length sentence
B = SAME sentence once in system/model-specific
C = not run
sentence = ${GEMINI37_FLASH_LENGTH_SENTENCE}
retry = 0
continuation = 0
recovery = 0
starting snapshot = same greeting + 조태형/렌 fixture
\`\`\`

## A/B 6-sample table

${table}

## Aggregate (valid samples only)

| | A | B |
|---|---:|---:|
| valid samples | ${A.validSamples} | ${B.validSamples} |
| avg chars | ${A.avgChars} | ${B.avgChars} |
| median chars | ${A.medianChars} | ${B.medianChars} |
| min | ${A.minChars} | ${B.minChars} |
| max | ${A.maxChars} | ${B.maxChars} |
| range | ${A.range} | ${B.range} |
| CV | ${A.coeffOfVariation} | ${B.coeffOfVariation} |
| >=2700 | ${A.ge2700} | ${B.ge2700} |
| >=3000 | ${A.ge3000} | ${B.ge3000} |
| avg output tokens | ${A.avgOutputTokens} | ${B.avgOutputTokens} |
| avg API KRW | ${A.avgKrw} | ${B.avgKrw} |
| avg latency | ${A.avgLatency} | ${B.avgLatency} |
| speech-act errors | ${A.speechActErrors} | ${B.speechActErrors} |
| agency errors | ${A.agencyErrors} | ${B.agencyErrors} |
| repetition flags | ${A.repetitionFlags} | ${B.repetitionFlags} |
| off-scene flags | ${A.offSceneFlags} | ${B.offSceneFlags} |
| malformed flags | ${A.malformedFlags} | ${B.malformedFlags} |
| transport failures | ${A.transportFailures} | ${B.transportFailures} |

## Quality flags by cell

| cell | repetition | same-q | speech-act | agency | off-scene | meta | truncate | transport |
|---|---|---|---|---|---|---|---|---|
${cells
  .map(
    (c) =>
      `| ${c.label} | ${c.obviousRepetition} | ${c.sameMeaningQuestionRepeat} | ${c.speechActInterpretationError}${c.speechActEvidence.length ? ` (${c.speechActEvidence.join("; ")})` : ""} | ${c.obviousUserAgencyViolation} | ${c.offSceneSummaryOrForeshadow} | ${c.malformedOrMeta} | ${c.finishTruncation} | ${c.invalidTransport} |`
  )
  .join("\n")}

## Verdict

\`\`\`text
B_avg >= 3000 = ${(B.avgChars ?? 0) >= 3000}
B_median vs A = ${B.medianChars} vs ${A.medianChars}
VERDICT = ${verdict}
B = ${bReject ? "REJECT" : "LENGTH_ADAPTER_CANDIDATE"}
NO_NEW_SENTENCE = true
C_NOT_RERUN = true
\`\`\`

## RAW paths

${cells.map((c) => `- ${c.label}: docs/audits/gemini-37-flash-length-ab-6seed/${c.label.toLowerCase()}-raw.txt`).join("\n")}
`;

  const payload = {
    model: MODEL,
    reasoningSetting: "low",
    sentence: GEMINI37_FLASH_LENGTH_SENTENCE,
    verdict,
    A,
    B,
    cells,
  };

  for (const dir of [OUT_DIR, ARTIFACT_DIR]) {
    save(dir, "SIX_SEED_REPORT.md", report);
    save(dir, "RUNTIME.json", payload);
    for (const cell of cells) {
      save(dir, `${cell.label.toLowerCase()}-raw.txt`, cell.raw);
    }
  }
  console.log(JSON.stringify({ out: path.join(OUT_DIR, "SIX_SEED_REPORT.md"), verdict, A, B }, null, 2));
}

void main();
