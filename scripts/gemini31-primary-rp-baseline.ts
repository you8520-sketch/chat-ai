/**
 * Gemini 3.1 Pro Preview — production-path Korean RP quality baseline.
 *
 * Inventory (no provider):
 *   node --conditions=react-server --import tsx scripts/gemini31-primary-rp-baseline.ts
 *
 * Live (exactly 4 Cheaper Inference calls, retry/continuation/recovery = 0):
 *   node --conditions=react-server --import tsx scripts/gemini31-primary-rp-baseline.ts --live
 *
 * Does not change production prompts. Does not write a style/length adapter.
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
} from "../src/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "../src/lib/chatModels";
import {
  GEMINI31_USER_AGENCY_SUPPLEMENT,
  GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE,
} from "../src/lib/gemini31UserAgencyAdapter";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../src/lib/responseLengthConstants";
import { COMMON_LENGTH_OWNER_MINIMAL } from "../src/lib/rpDiagnosticCanary";
import { COLLABORATIVE_INTERACTIVE_OWNER_TITLE } from "../src/lib/noGodmodding";
import { CURRENT_USER_INPUT_HEADER } from "../src/lib/currentUserInputLabel";
import { TERRA_PROMPT_CANARY_GREETING_NEUTRAL } from "../src/lib/terraPromptCanary";
import { OPENING_TURN_USER } from "../src/lib/chatGreetingContext";
import { loadCharacterChunksForPromptReadOnly } from "../src/lib/characterChunks";
import { formatSelectedPersonaForPrompt } from "../src/lib/userPersonas";
import { resolveNarrativePov, buildNarrativePovPrompt } from "../src/lib/narrativePov";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK } from "../src/lib/adultHandoffSourceRouting";
import { ENOCH_FIXTURES } from "../data/canon-core-audit/d2-enoch-fixtures";
import type { ChatMsg } from "../src/lib/ai";

loadEnvLocal();

const MODEL = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
const LIVE = process.argv.includes("--live");
const OUT_DIR = path.join(process.cwd(), "docs/audits/gemini31-primary-rp-baseline");
const ARTIFACT_DIR = path.join("/opt/cursor/artifacts", "gemini31-primary-rp-baseline");

/** Exact 3.7 Flash quiet-relationship card (frozen baseline, not newly simplified). */
const JO_TAEHYUNG_CARD = `너는 조태형이다. 에이지스 본부 S급 특수계 음압 센티넬. 고위험 폭주형.
북극곰 귀 흰 후드티, 유광 블랙 재킷, 녹색 눈, 검은 네일, 은반지, 여자 향수.
목에 전자 초커. 낙천적이고 능청스러우며 사람을 옭아매는 관찰력이 있다.
렌 곁에서는 이명이 가라앉는다.`;

const JO_TAEHYUNG_WORLD =
  "에이지스 컨트롤 본부. 센티넬/가이드. 중앙 로비, 지원국, 동기화 챔버.";

const ENOCH_ACTIVE = ENOCH_FIXTURES.find((f) => f.id === "enoch-active");
if (!ENOCH_ACTIVE) throw new Error("missing enoch-active fixture");

/**
 * Production 에녹 greeting row is not in this VM seed DB / fixture JSON.
 * Frozen here before any provider call. Speech matches creator canon (short, dry, command).
 */
const ENOCH_GREETING = `에녹은 방독면 필터를 한 번 눌러 확인한 뒤, 버려진 상가 골목 입구의 그림자만 짚었다. 회색 안개는 아직 옅었고, 셔터가 바람에 낮게 울렸다.

"소리 줄여. 여기서부터는 발소리도 무기다."`;

type FixtureDef = {
  id: "A" | "B";
  family: "quiet_relationship" | "world_action";
  label: string;
  characterId: number;
  charName: string;
  gender: "male";
  systemPrompt: string;
  world: string;
  greeting: string;
  turns: [string, string];
  fixtureRecovery: {
    userInputsReusedFrom: string;
    characterRowExact: boolean;
    greetingExact: boolean;
    whyNewFreeze: string | null;
  };
};

const FIXTURES: FixtureDef[] = [
  {
    id: "A",
    family: "quiet_relationship",
    label: "QUIET / RELATIONSHIP / CHARACTER-VOICE — 조태형",
    characterId: 18,
    charName: "조태형",
    gender: "male",
    systemPrompt: JO_TAEHYUNG_CARD,
    world: JO_TAEHYUNG_WORLD,
    greeting: TERRA_PROMPT_CANARY_GREETING_NEUTRAL,
    turns: ["나는 렌이라고… 본 기억이 안 나는데… 나 알아?", "같이 갈래? *두리번*"],
    fixtureRecovery: {
      userInputsReusedFrom:
        "docs/audits/gemini-37-flash-baseline + scripts/gemini-37-flash-rp-baseline.ts",
      characterRowExact: false,
      greetingExact: true,
      whyNewFreeze:
        "VM seed DB has no production roster row id=18 (라이크/조태형). Reused the already-frozen 3.7 quiet card + greeting through production chunk compilation rather than inventing a new card.",
    },
  },
  {
    id: "B",
    family: "world_action",
    label: "WORLD / ACTION / EVENT — 에녹",
    characterId: 10,
    charName: "에녹",
    gender: "male",
    systemPrompt: ENOCH_ACTIVE.creatorRawDescription,
    world: ENOCH_ACTIVE.world,
    greeting: ENOCH_GREETING,
    turns: [
      "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?",
      "*렌은 에녹의 소매를 짧게 잡아끈다.* 왼쪽 골목으로 우회할까요?",
    ],
    fixtureRecovery: {
      userInputsReusedFrom:
        "scripts/final-production-model-smoke-live.ts terra_action + data/human-review/final-production-model-smoke",
      characterRowExact: false,
      greetingExact: false,
      whyNewFreeze:
        "c10_fixture.json / live production greeting are not on this VM. Canon is data/canon-core-audit/d2-enoch-fixtures.ts (restructured from production 에녹 id=10). Greeting newly frozen before provider calls.",
    },
  },
];

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function charCount(text: string): number {
  return [...text].length;
}

function save(dir: string, name: string, content: string | object) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, name),
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    "utf8"
  );
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) {
          return String((block as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  return hay.split(needle).length - 1;
}

function redactBody(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  delete next.api_key;
  delete next.authorization;
  return next;
}

function seedHistory(greeting: string): ChatMsg[] {
  return [
    { role: "user", content: OPENING_TURN_USER },
    { role: "assistant", content: greeting },
  ];
}

function assembleTurn(opts: {
  fixture: FixtureDef;
  history: ChatMsg[];
  currentUserMessage: string;
}) {
  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: opts.fixture.characterId,
      name: opts.fixture.charName,
      gender: opts.fixture.gender,
      system_prompt: opts.fixture.systemPrompt,
      world: opts.fixture.world,
      example_dialog: "",
      setting_chunks: "",
      speech_profile: "",
    },
    "렌",
    "렌"
  );
  const userPersona = formatSelectedPersonaForPrompt("렌", "male", "성별: 남성");
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: opts.fixture.charName,
  });
  const completedTurns = Math.max(0, Math.floor((opts.history.length - 2) / 2));
  const built = buildContext({
    charName: opts.fixture.charName,
    chunks,
    userNickname: "렌",
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: opts.history,
    currentUserMessage: opts.currentUserMessage,
    nsfw: false,
    gender: opts.fixture.gender,
    memoryMeta: "",
    modelId: MODEL,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: "렌",
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    completedTurns,
    provider: "openrouter",
    contentKind: "character",
    exampleDialog: "",
    narrativePov,
  });
  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt ?? "",
    history: built.history ?? [],
    modelId: MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: true,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: built.openRouterSystemSplit,
      charName: opts.fixture.charName,
      personaName: "렌",
    },
  });
  const requestBody = {
    ...(assembled.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  };
  return { built, assembled, requestBody, chunks, narrativePov, completedTurns };
}

function inventoryFromAssembly(
  fixture: FixtureDef,
  assembled: ReturnType<typeof assembleTurn>
) {
  const system = assembled.built.systemPrompt ?? "";
  const messages = (assembled.requestBody.messages ?? []) as Array<{
    role?: string;
    content?: unknown;
  }>;
  const flatMessages = messages.map((m) => ({
    role: m.role ?? "",
    content: flattenContent(m.content),
  }));
  const fullPayload = flatMessages.map((m) => m.content).join("\n\n");
  const lastUser = [...flatMessages].reverse().find((m) => m.role === "user");
  const currentUser = lastUser?.content ?? "";
  const lengthIdx = currentUser.lastIndexOf(USER_TAIL_LENGTH_OWNER_SENTENCE);
  const lengthIsTail =
    lengthIdx >= 0 &&
    currentUser.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE.trim());
  const styleHits = [
    /Gemini 3\.1.{0,40}(style|prose|문체|문단|리듬)/i,
    /GEMINI31_STYLE/,
    /GEMINI 3\.1 (RP )?adapter/i,
    /\[GEMINI 3\.1 .{0,40}STYLE/,
  ];
  const lengthHits = [
    /Gemini 3\.1.{0,40}(length|분량|글자)/i,
    /GEMINI31_LENGTH/,
    /\[GEMINI 3\.1 .{0,40}LENGTH/,
  ];
  const styleSpecific = styleHits.some((re) => re.test(system) || re.test(fullPayload));
  const lengthSpecific = lengthHits.some((re) => re.test(system) || re.test(fullPayload));
  return {
    EXACT_MODEL_ID: assembled.requestBody.model ?? null,
    PROVIDER: "cheaperinference",
    ENDPOINT: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    TEMPERATURE: assembled.requestBody.temperature ?? null,
    TOP_P: assembled.requestBody.top_p ?? null,
    MAX_TOKENS: assembled.requestBody.max_tokens ?? null,
    REASONING_EFFORT: assembled.requestBody.reasoning_effort ?? null,
    THINKING_CONFIG: assembled.requestBody.thinking ?? assembled.requestBody.thinking_config ?? null,
    REASONING_OBJECT: assembled.requestBody.reasoning ?? null,
    INCLUDE_REASONING: assembled.requestBody.include_reasoning ?? null,
    COMMON_LENGTH_OWNER_TEXT: USER_TAIL_LENGTH_OWNER_SENTENCE,
    COMMON_LENGTH_OWNER_COUNT: countOccurrences(fullPayload, USER_TAIL_LENGTH_OWNER_SENTENCE),
    COMMON_LENGTH_OWNER_POSITION: lengthIsTail
      ? "current_user_message_absolute_tail"
      : lengthIdx >= 0
        ? "current_user_message_present_not_tail"
        : "missing",
    COMMON_LENGTH_OWNER_MINIMAL_COUNT: countOccurrences(fullPayload, COMMON_LENGTH_OWNER_MINIMAL),
    GEMINI31_AGENCY_SUPPLEMENT_PRESENT: system.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE),
    GEMINI31_AGENCY_SUPPLEMENT_CHARS: charCount(GEMINI31_USER_AGENCY_SUPPLEMENT),
    GEMINI31_AGENCY_SUPPLEMENT_GATE:
      "isGemini31ProModel(modelId) && godmoddingMode==='standard' && contentKind!=='simulation'",
    GEMINI31_STYLE_SPECIFIC_PROMPT_CHARS: styleSpecific ? -1 : 0,
    GEMINI31_LENGTH_SPECIFIC_PROMPT_CHARS: lengthSpecific ? -1 : 0,
    GEMINI31_STYLE_SPECIFIC_PROMPT_DETECTED: styleSpecific,
    GEMINI31_LENGTH_SPECIFIC_PROMPT_DETECTED: lengthSpecific,
    GEMINI31_QWEN_STYLE_CONTINUITY_PRESENT: fullPayload.includes(
      GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK
    ),
    NORMAL_CURRENT_USER_WRAPPER: currentUser.startsWith(CURRENT_USER_INPUT_HEADER),
    CURRENT_USER_WRAPPER_HEAD: currentUser.split("\n").slice(0, 8),
    COMMON_PROSE_OWNER_COUNT: {
      OUTPUT_LAYOUT: countOccurrences(fullPayload, "[OUTPUT LAYOUT]"),
      SEMANTIC_PARAGRAPHING: countOccurrences(fullPayload, "[SEMANTIC PARAGRAPHING]"),
      DIALOGUE_AND_NARRATION: countOccurrences(fullPayload, "[DIALOGUE & NARRATION]"),
      WEBNOVEL_OUTPUT_FORMAT: countOccurrences(fullPayload, "[WEBNOVEL OUTPUT FORMAT]"),
    },
    COMMON_AGENCY_OWNER_COUNT: countOccurrences(
      fullPayload,
      COLLABORATIVE_INTERACTIVE_OWNER_TITLE
    ),
    SYSTEM_CHARS: charCount(system),
    MESSAGE_COUNT: messages.length,
    COMPLETED_TURNS: assembled.completedTurns,
    NARRATIVE_POV: assembled.narrativePov,
    POV_OWNER_PRESENT: fullPayload.includes("NARRATIVE POV OWNER: THIRD PERSON"),
    CHUNK_COUNT: assembled.chunks.length,
    CHUNK_CATEGORIES: assembled.chunks.map((c) => c.category),
    NO_MODEL_SPECIFIC_PROSE_EXPERIMENT:
      !styleSpecific &&
      !lengthSpecific &&
      !fullPayload.includes(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK),
    shas: {
      system: sha256(system),
      messages: sha256(JSON.stringify(flatMessages)),
      currentUser: sha256(currentUser),
      requestBody: sha256(JSON.stringify(redactBody(assembled.requestBody))),
      fixtureCanon: sha256(optsCanon(fixture)),
    },
  };
}

function optsCanon(fixture: FixtureDef): string {
  return JSON.stringify({
    id: fixture.id,
    characterId: fixture.characterId,
    charName: fixture.charName,
    systemPrompt: fixture.systemPrompt,
    world: fixture.world,
    greeting: fixture.greeting,
    turns: fixture.turns,
  });
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

function dialogueQuoteCount(text: string): number {
  const pairs = [
    text.match(/「[^」]*」/g)?.length ?? 0,
    text.match(/『[^』]*』/g)?.length ?? 0,
    text.match(/“[^”]*”/g)?.length ?? 0,
  ];
  const loose = (text.match(/"/g) ?? []).length;
  return pairs.reduce((a, b) => a + b, 0) + Math.floor(loose / 2);
}

function maxConsecutive(flags: boolean[]): number {
  let max = 0;
  let cur = 0;
  for (const f of flags) {
    if (f) {
      cur += 1;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
  }
  return max;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 === 1 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

function structuralMetrics(text: string) {
  const visible = text.replace(/\r/g, "");
  const paragraphs = countParagraphs(visible);
  const dialogueFlags = paragraphs.map(isDialogueParagraph);
  const narration = paragraphs.filter((_, i) => !dialogueFlags[i]);
  const dialogue = paragraphs.filter((_, i) => dialogueFlags[i]);
  const paraChars = paragraphs.map((p) => charCount(p));
  return {
    VISIBLE_CHARS_INCL_SPACES: charCount(visible),
    VISIBLE_CHARS_EXCL_SPACES: charCount(visible.replace(/\s/g, "")),
    PARAGRAPH_COUNT: paragraphs.length,
    NARRATION_PARAGRAPH_COUNT: narration.length,
    DIALOGUE_PARAGRAPH_COUNT: dialogue.length,
    DIALOGUE_PARAGRAPH_RATIO:
      paragraphs.length > 0
        ? Math.round((dialogue.length / paragraphs.length) * 1000) / 1000
        : 0,
    DIALOGUE_QUOTE_COUNT: dialogueQuoteCount(visible),
    MAX_CONSECUTIVE_DIALOGUE_PARAGRAPHS: maxConsecutive(dialogueFlags),
    MEDIAN_PARAGRAPH_CHARS: median(paraChars),
    VERY_SHORT_NARRATION_PARAGRAPH_COUNT: narration.filter((p) => charCount(p) < 50).length,
  };
}

type FlagVal = true | false | "UNCERTAIN";

function flagAgencyPassages(text: string, userLine: string, charName: string) {
  const paragraphs = countParagraphs(text);
  const passages: Array<{
    quote: string;
    ACTOR: string;
    TARGET: string | null;
    ACTION: string;
    FLAG: string;
  }> = [];
  const major =
    /(말했다|대답했다|승낙했다|거절했다|키스했다|달렸다|쏘았다|고개를 끄덕였다|손을 잡았다|따라갔다|결정했다|동의했다)/;
  for (const p of paragraphs) {
    const userSubject = /렌(?:은|이)\s/.test(p);
    const userObjectOnly = /렌(?:을|를|에게|한테|쪽)/.test(p) && !userSubject;
    if (userSubject && /[「『“"]/.test(p) && !userLine.includes(p.slice(0, 20))) {
      const m = p.match(/렌(?:은|이)\s([^.]{0,40})/);
      passages.push({
        quote: p.slice(0, 280),
        ACTOR: "렌",
        TARGET: null,
        ACTION: m?.[1] ?? "UNCERTAIN_DIALOGUE_OR_ACTION",
        FLAG: "NEW_USER_DIALOGUE",
      });
    } else if (userSubject && major.test(p)) {
      const m = p.match(/렌(?:은|이)\s(.{0,40})/);
      passages.push({
        quote: p.slice(0, 280),
        ACTOR: "렌",
        TARGET: null,
        ACTION: m?.[1] ?? "UNCERTAIN",
        FLAG: "NEW_USER_MAJOR_ACTION",
      });
    } else if (userObjectOnly) {
      passages.push({
        quote: p.slice(0, 280),
        ACTOR: charName,
        TARGET: "렌",
        ACTION: "object_mention_only_not_inferred_as_user_actor",
        FLAG: "NOT_USER_ACTOR",
      });
    }
  }
  return passages;
}

function humanReviewFlags(text: string, userLine: string, charName: string) {
  const malformed =
    /\[SYSTEM|as an AI|I am Gemini|language model|safety policy|OPENROUTER/i.test(text);
  const obviousRepetition = /(.{20,})\1\1/.test(text);
  const replay =
    userLine.trim().length >= 12 &&
    text.includes(userLine.replace(/\*/g, "").trim().slice(0, 18));
  const premature =
    /다음(?:에| 장면| 기회)|오늘은 여기까지|이야기를 마친다|fade to black/i.test(text);
  const fragmentation =
    structuralMetrics(text).VERY_SHORT_NARRATION_PARAGRAPH_COUNT >= 6;
  const agency = flagAgencyPassages(text, userLine, charName);
  const newUserDialogue = agency.some((p) => p.FLAG === "NEW_USER_DIALOGUE");
  const newUserMajor = agency.some((p) => p.FLAG === "NEW_USER_MAJOR_ACTION");
  const flags: Record<string, FlagVal> = {
    CHARACTER_VOICE_DRIFT: "UNCERTAIN",
    GENERIC_RP_VOICE: "UNCERTAIN",
    CURRENT_USER_REPLAY: replay ? "UNCERTAIN" : false,
    CURRENT_USER_STATE_CONTRADICTION: "UNCERTAIN",
    NEW_USER_DIALOGUE: newUserDialogue ? true : false,
    NEW_USER_MAJOR_ACTION: newUserMajor ? true : false,
    NEW_USER_INTENT_AS_FACT: "UNCERTAIN",
    UNCONFIRMED_USER_BODY_FACT: "UNCERTAIN",
    SCENE_ADVANCES: "UNCERTAIN",
    PREMATURE_SCENE_CLOSE: premature ? "UNCERTAIN" : false,
    OBVIOUS_SEMANTIC_REPETITION: obviousRepetition,
    PARAGRAPH_FRAGMENTATION: fragmentation ? "UNCERTAIN" : false,
    MALFORMED_OR_META_OUTPUT: malformed,
    CANON_CONTRADICTION: "UNCERTAIN",
    UNSUPPORTED_MAJOR_LOCATION_OR_EVENT: "UNCERTAIN",
  };
  return { flags, agencyPassages: agency.filter((p) => p.FLAG !== "NOT_USER_ACTOR") };
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
  if (!res.ok) {
    const errText = await res.text();
    return {
      httpStatus,
      latencyMs: Date.now() - started,
      ttftMs,
      finishReason: null as string | null,
      resolvedModel: null as string | null,
      text: "",
      usageRaw: null as unknown,
      error: errText.slice(0, 4000),
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
      error: "missing body",
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
    error: null as string | null,
  };
}

function freezeAssembled(label: string, fixture: FixtureDef, assembled: ReturnType<typeof assembleTurn>) {
  const inv = inventoryFromAssembly(fixture, assembled);
  const messages = (assembled.requestBody.messages ?? []) as Array<{
    role?: string;
    content?: unknown;
  }>;
  const flat = messages.map((m) => ({
    role: m.role ?? "",
    content: flattenContent(m.content),
  }));
  const lastUser = [...flat].reverse().find((m) => m.role === "user");
  const payload = {
    label,
    fixtureId: fixture.id,
    inventory: inv,
    system: assembled.built.systemPrompt ?? "",
    messages: flat,
    currentUserMessage: lastUser?.content ?? "",
    outboundBody: redactBody({
      ...assembled.requestBody,
      messages: "[see messages]",
    }),
    requestBodyBeforeAdaptKeys: Object.keys(assembled.assembled.requestBodyBeforeAdapt).sort(),
    requestBodyAfterAdaptKeys: Object.keys(assembled.requestBody).sort(),
    adaptationKeyDiff: assembled.assembled.adaptationKeyDiff,
  };
  for (const dir of [OUT_DIR, ARTIFACT_DIR]) {
    save(dir, `${label}-system.txt`, payload.system);
    save(dir, `${label}-messages.json`, payload.messages);
    save(dir, `${label}-current-user.txt`, payload.currentUserMessage);
    save(dir, `${label}-request.json`, {
      outboundBody: payload.outboundBody,
      inventory: inv,
      adaptationKeyDiff: payload.adaptationKeyDiff,
    });
  }
  return payload;
}

function writeInventory(invA: ReturnType<typeof freezeAssembled>, invB: ReturnType<typeof freezeAssembled>) {
  const shared = invA.inventory;
  const report = {
    phase: "INVENTORY_NO_PROVIDER",
    TOTAL_PROVIDER_CALLS: 0,
    EXACT_MODEL_ID: shared.EXACT_MODEL_ID,
    PROVIDER: shared.PROVIDER,
    TEMPERATURE: shared.TEMPERATURE,
    TOP_P: shared.TOP_P,
    MAX_TOKENS: shared.MAX_TOKENS,
    REASONING_EFFORT: shared.REASONING_EFFORT,
    THINKING_CONFIG: shared.THINKING_CONFIG,
    COMMON_LENGTH_OWNER_TEXT: shared.COMMON_LENGTH_OWNER_TEXT,
    COMMON_LENGTH_OWNER_COUNT: shared.COMMON_LENGTH_OWNER_COUNT,
    COMMON_LENGTH_OWNER_POSITION: shared.COMMON_LENGTH_OWNER_POSITION,
    GEMINI31_AGENCY_SUPPLEMENT_PRESENT: shared.GEMINI31_AGENCY_SUPPLEMENT_PRESENT,
    GEMINI31_AGENCY_SUPPLEMENT_CHARS: shared.GEMINI31_AGENCY_SUPPLEMENT_CHARS,
    GEMINI31_AGENCY_SUPPLEMENT_GATE: shared.GEMINI31_AGENCY_SUPPLEMENT_GATE,
    GEMINI31_AGENCY_SUPPLEMENT_TEXT: GEMINI31_USER_AGENCY_SUPPLEMENT,
    GEMINI31_STYLE_SPECIFIC_PROMPT_CHARS: shared.GEMINI31_STYLE_SPECIFIC_PROMPT_CHARS,
    GEMINI31_LENGTH_SPECIFIC_PROMPT_CHARS: shared.GEMINI31_LENGTH_SPECIFIC_PROMPT_CHARS,
    NORMAL_CURRENT_USER_WRAPPER: shared.NORMAL_CURRENT_USER_WRAPPER,
    COMMON_PROSE_OWNER_COUNT: shared.COMMON_PROSE_OWNER_COUNT,
    COMMON_AGENCY_OWNER_COUNT: shared.COMMON_AGENCY_OWNER_COUNT,
    distinguish: {
      A_common_production_prompt:
        "shared RP / USER CONTROL owner / CURRENT USER wrapper / length tail / OUTPUT LAYOUT / Speech Lock / canon chunks",
      B_gemini31_agency_only_supplement: GEMINI31_USER_AGENCY_SUPPLEMENT,
      C_gemini31_prose_style_specific_text: "(none)",
      D_gemini31_length_specific_text: "(none)",
    },
    architecturalPrincipleHolds:
      shared.GEMINI31_AGENCY_SUPPLEMENT_PRESENT === true &&
      shared.GEMINI31_STYLE_SPECIFIC_PROMPT_CHARS === 0 &&
      shared.GEMINI31_LENGTH_SPECIFIC_PROMPT_CHARS === 0,
    fixtureFreeze: FIXTURES.map((f) => ({
      id: f.id,
      family: f.family,
      label: f.label,
      characterId: f.characterId,
      charName: f.charName,
      turns: f.turns,
      greetingSha: sha256(f.greeting),
      canonSha: sha256(f.systemPrompt),
      recovery: f.fixtureRecovery,
    })),
    A_T1: invA.inventory,
    B_T1: invB.inventory,
    PRODUCTION_PROMPT_CHANGED: false,
  };
  const md = `# Gemini 3.1 Pro Preview — current production inventory

Do not call a provider during this inventory. This file is the freeze.

## A. CURRENT PRODUCTION INVENTORY

| Field | Value |
| --- | --- |
| EXACT_MODEL_ID | \`${String(shared.EXACT_MODEL_ID)}\` |
| PROVIDER | cheaperinference |
| TEMPERATURE | ${String(shared.TEMPERATURE)} |
| TOP_P | ${String(shared.TOP_P)} |
| MAX_TOKENS | ${String(shared.MAX_TOKENS)} |
| REASONING_EFFORT | ${String(shared.REASONING_EFFORT)} |
| THINKING_CONFIG | ${JSON.stringify(shared.THINKING_CONFIG)} |
| COMMON_LENGTH_OWNER_COUNT | ${shared.COMMON_LENGTH_OWNER_COUNT} |
| COMMON_LENGTH_OWNER_POSITION | ${shared.COMMON_LENGTH_OWNER_POSITION} |
| GEMINI31_AGENCY_SUPPLEMENT_PRESENT | ${String(shared.GEMINI31_AGENCY_SUPPLEMENT_PRESENT)} |
| GEMINI31_AGENCY_SUPPLEMENT_CHARS | ${shared.GEMINI31_AGENCY_SUPPLEMENT_CHARS} |
| GEMINI31_STYLE_SPECIFIC_PROMPT_CHARS | ${shared.GEMINI31_STYLE_SPECIFIC_PROMPT_CHARS} |
| GEMINI31_LENGTH_SPECIFIC_PROMPT_CHARS | ${shared.GEMINI31_LENGTH_SPECIFIC_PROMPT_CHARS} |
| NORMAL_CURRENT_USER_WRAPPER | ${String(shared.NORMAL_CURRENT_USER_WRAPPER)} |
| COMMON_AGENCY_OWNER_COUNT | ${shared.COMMON_AGENCY_OWNER_COUNT} |

### COMMON_LENGTH_OWNER_TEXT

${USER_TAIL_LENGTH_OWNER_SENTENCE}

### Distinguish

- **A. common production prompt** — shared RP, USER CONTROL owner, CURRENT USER wrapper, user-tail length, OUTPUT LAYOUT, Speech Lock, production chunk compiler, third-person POV owner
- **B. Gemini 3.1 agency-only supplement** — present (kept; not a prose/style/length adapter)
- **C. Gemini 3.1 prose/style-specific text** — none
- **D. Gemini 3.1 length-specific text** — none

### Agency supplement (B)

\`\`\`
${GEMINI31_USER_AGENCY_SUPPLEMENT}
\`\`\`

Gate: \`${shared.GEMINI31_AGENCY_SUPPLEMENT_GATE}\`

## Fixture freeze

Exact previously frozen user inputs are reused. Exact production character SQL rows are **not** on this VM seed DB.

- **A** quiet: 3.7 Flash baseline user inputs + frozen 조태형 card/greeting, compiled through production \`loadCharacterChunksForPromptReadOnly\`
- **B** action: production-smoke 에녹 user inputs + d2-enoch production-compiled canon; greeting newly frozen

PRODUCTION_PROMPT_CHANGED=false
`;
  for (const dir of [OUT_DIR, ARTIFACT_DIR]) {
    save(dir, "INVENTORY.json", report);
    save(dir, "INVENTORY.md", md);
    save(dir, "FIXTURES.json", FIXTURES);
  }
  return report;
}

async function runInventory() {
  const results: ReturnType<typeof freezeAssembled>[] = [];
  for (const fixture of FIXTURES) {
    const assembled = assembleTurn({
      fixture,
      history: seedHistory(fixture.greeting),
      currentUserMessage: fixture.turns[0],
    });
    results.push(freezeAssembled(`${fixture.id}-T1`, fixture, assembled));
  }
  return writeInventory(results[0]!, results[1]!);
}

async function runLive() {
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    throw new Error("CHEAPER_INFERENCE_API_KEY is required");
  }
  const rows: Record<string, unknown>[] = [];
  let providerCalls = 0;
  for (const fixture of FIXTURES) {
    let history = seedHistory(fixture.greeting);
    for (const turn of [1, 2] as const) {
      const label = `${fixture.id}-T${turn}`;
      const userLine = fixture.turns[turn - 1]!;
      const assembled = assembleTurn({
        fixture,
        history,
        currentUserMessage: userLine,
      });
      const frozen = freezeAssembled(label, fixture, assembled);
      if (providerCalls >= 4) {
        throw new Error(`API_CALL_BUDGET_EXCEEDED:${providerCalls}/4`);
      }
      providerCalls += 1;
      const resp = await callOnce(assembled.requestBody);
      if (resp.error || resp.httpStatus !== 200 || !resp.text.trim()) {
        save(OUT_DIR, `${label}-FAIL.json`, resp);
        save(ARTIFACT_DIR, `${label}-FAIL.json`, resp);
        throw new Error(`${label} provider fail: ${resp.error ?? resp.httpStatus}`);
      }
      const usage = parseOpenRouterUsage(resp.usageRaw);
      const struct = structuralMetrics(resp.text);
      const review = humanReviewFlags(resp.text, userLine, fixture.charName);
      const ownerTarget = DEFAULT_TARGET_RESPONSE_CHARS;
      const sampleRatio =
        Math.round((struct.VISIBLE_CHARS_INCL_SPACES / ownerTarget) * 1000) / 1000;
      const row = {
        label,
        fixtureId: fixture.id,
        family: fixture.family,
        userLine,
        requestedModel: MODEL,
        resolvedModel: resp.resolvedModel,
        ...struct,
        INPUT_TOKENS: usage.promptTokens,
        OUTPUT_TOKENS: usage.completionTokens,
        REASONING_TOKENS_IF_REPORTED: usage.reasoningTokens,
        CACHE_READ: usage.cacheReadTokens,
        CACHE_WRITE: usage.cacheWriteTokens,
        LATENCY_MS: resp.latencyMs,
        TTFT_MS: resp.ttftMs,
        FINISH_REASON: resp.finishReason,
        HTTP_STATUS: resp.httpStatus,
        OWNER_TARGET_CHARS: ownerTarget,
        SAMPLE_TARGET_RATIO: sampleRatio,
        SEVERE_SHORT_OUTPUT: struct.VISIBLE_CHARS_INCL_SPACES < 1200,
        flags: review.flags,
        agencyPassages: review.agencyPassages,
        shas: frozen.inventory.shas,
        rawSha: sha256(resp.text),
        usageRaw: resp.usageRaw,
      };
      rows.push(row);
      for (const dir of [OUT_DIR, ARTIFACT_DIR]) {
        save(dir, `${label}-raw.txt`, resp.text);
        save(dir, `${label}-meta.json`, row);
      }
      history = [
        ...history,
        { role: "user", content: userLine },
        { role: "assistant", content: resp.text },
      ];
    }
  }
  return { rows, providerCalls };
}

function evidenceState(rows: Array<Record<string, unknown>>) {
  const shorts = rows.filter((r) => r.SEVERE_SHORT_OUTPUT === true);
  const malformed = rows.filter((r) => r.flags && (r.flags as { MALFORMED_OR_META_OUTPUT: FlagVal }).MALFORMED_OR_META_OUTPUT === true);
  const repetition = rows.filter(
    (r) =>
      r.flags &&
      (r.flags as { OBVIOUS_SEMANTIC_REPETITION: FlagVal }).OBVIOUS_SEMANTIC_REPETITION === true
  );
  const agencyTrue = rows.filter((r) => {
    const f = r.flags as { NEW_USER_DIALOGUE?: FlagVal; NEW_USER_MAJOR_ACTION?: FlagVal };
    return f?.NEW_USER_DIALOGUE === true || f?.NEW_USER_MAJOR_ACTION === true;
  });
  const repeated =
    shorts.length >= 2 || malformed.length >= 2 || repetition.length >= 2 || agencyTrue.length >= 2;
  return {
    NO_REPEATED_SOURCE_DEFECT_FOUND: !repeated,
    REPEATED_SOURCE_DEFECT_FOUND: repeated,
    STYLE_ADAPTER_JUSTIFIED: false,
    LENGTH_ADAPTER_JUSTIFIED: shorts.length >= 2,
    ADAPTER_CANDIDATE_REVIEW_REQUIRED: repeated,
    note:
      "Deterministic failures only. Literary quality is not scored. Length adapter is not written even if LENGTH_ADAPTER_JUSTIFIED would be diagnostically true.",
  };
}

function renderHumanReview(opts: {
  inventory: Awaited<ReturnType<typeof runInventory>>;
  live: Awaited<ReturnType<typeof runLive>>;
}) {
  const { inventory, live } = opts;
  const raws = live.rows
    .map((r) => {
      const raw = fs.readFileSync(path.join(OUT_DIR, `${r.label}-raw.txt`), "utf8");
      return `## ${r.label}\n\n### user\n\n${r.userLine}\n\n### RAW\n\n${raw}\n`;
    })
    .join("\n");
  const table = live.rows
    .map((r) =>
      [
        r.label,
        r.VISIBLE_CHARS_INCL_SPACES,
        r.PARAGRAPH_COUNT,
        r.DIALOGUE_PARAGRAPH_COUNT,
        r.DIALOGUE_PARAGRAPH_RATIO,
        r.INPUT_TOKENS,
        r.OUTPUT_TOKENS,
        r.REASONING_TOKENS_IF_REPORTED,
        r.LATENCY_MS,
        r.TTFT_MS,
        r.FINISH_REASON,
        r.SAMPLE_TARGET_RATIO,
      ].join(" | ")
    )
    .join("\n");
  const evidence = evidenceState(live.rows);
  return `# Gemini 3.1 Pro Preview — primary RP quality baseline

QUALITY_SCORE_ASSIGNED=false
MODEL_WINNER_SELECTED=false
PRODUCTION_PROMPT_CHANGED=false
HUMAN_RAW_REVIEW_REQUIRED=true
TOTAL_PROVIDER_CALLS=${live.providerCalls}
RETRIES=0
CONTINUATIONS=0
RECOVERY_CALLS=0

## A. CURRENT PRODUCTION INVENTORY

See \`INVENTORY.md\`. Summary:

- EXACT_MODEL_ID=\`${String(inventory.EXACT_MODEL_ID)}\`
- PROVIDER=cheaperinference
- TEMPERATURE=${String(inventory.TEMPERATURE)}
- TOP_P=${String(inventory.TOP_P)}
- MAX_TOKENS=${String(inventory.MAX_TOKENS)}
- REASONING_EFFORT=${String(inventory.REASONING_EFFORT)}
- THINKING_CONFIG=${JSON.stringify(inventory.THINKING_CONFIG)}
- GEMINI31_AGENCY_SUPPLEMENT_PRESENT=${String(inventory.GEMINI31_AGENCY_SUPPLEMENT_PRESENT)}
- GEMINI31_AGENCY_SUPPLEMENT_CHARS=${inventory.GEMINI31_AGENCY_SUPPLEMENT_CHARS}
- GEMINI31_STYLE_SPECIFIC_PROMPT_CHARS=${inventory.GEMINI31_STYLE_SPECIFIC_PROMPT_CHARS}
- GEMINI31_LENGTH_SPECIFIC_PROMPT_CHARS=${inventory.GEMINI31_LENGTH_SPECIFIC_PROMPT_CHARS}

3.7 Flash numeric reference (comparison only, not a target):
T1 2775 / 24p / 9 dialogue (~37.5%); T2 2798 / 28p / 9 dialogue (~32.1%).

## B. EXACT FOUR-CALL TABLE

label | VISIBLE_CHARS_INCL_SPACES | PARAGRAPH_COUNT | DIALOGUE_PARAGRAPH_COUNT | DIALOGUE_RATIO | INPUT_TOKENS | OUTPUT_TOKENS | REASONING | LATENCY_MS | TTFT_MS | FINISH | SAMPLE_TARGET_RATIO
--- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---
${table}

## C. FULL RAW

${raws}

## D / E / F / G

See \`RUNTIME.json\`. Evidence state:

\`\`\`json
${JSON.stringify(evidence, null, 2)}
\`\`\`
`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const inventory = await runInventory();
  console.log(
    JSON.stringify(
      {
        phase: LIVE ? "inventory_then_live" : "inventory_only",
        model: inventory.EXACT_MODEL_ID,
        temperature: inventory.TEMPERATURE,
        reasoning: inventory.REASONING_EFFORT,
        agency: inventory.GEMINI31_AGENCY_SUPPLEMENT_PRESENT,
        styleChars: inventory.GEMINI31_STYLE_SPECIFIC_PROMPT_CHARS,
        lengthChars: inventory.GEMINI31_LENGTH_SPECIFIC_PROMPT_CHARS,
      },
      null,
      2
    )
  );
  if (!LIVE) return;
  const live = await runLive();
  const evidence = evidenceState(live.rows);
  const runtime = {
    TOTAL_PROVIDER_CALLS: live.providerCalls,
    RETRIES: 0,
    CONTINUATIONS: 0,
    RECOVERY_CALLS: 0,
    QUALITY_SCORE_ASSIGNED: false,
    MODEL_WINNER_SELECTED: false,
    PRODUCTION_PROMPT_CHANGED: false,
    HUMAN_RAW_REVIEW_REQUIRED: true,
    GEMINI31_STYLE_ADAPTER_CHARS: 0,
    GEMINI31_LENGTH_ADAPTER_CHARS: 0,
    KEEP_CURRENT_PRODUCTION: evidence.NO_REPEATED_SOURCE_DEFECT_FOUND,
    inventory,
    rows: live.rows,
    evidence,
  };
  const md = renderHumanReview({ inventory, live });
  for (const dir of [OUT_DIR, ARTIFACT_DIR]) {
    save(dir, "RUNTIME.json", runtime);
    save(dir, "HUMAN_REVIEW.md", md);
  }
  console.log(
    JSON.stringify(
      {
        out: path.join(OUT_DIR, "HUMAN_REVIEW.md"),
        calls: live.providerCalls,
        evidence,
        chars: live.rows.map((r) => [r.label, r.VISIBLE_CHARS_INCL_SPACES]),
      },
      null,
      2
    )
  );
}

void main();
