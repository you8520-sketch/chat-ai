/**
 * Evidence-only Phase D: isolate DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL.
 * Not imported by production runtime. Does not change src/ behavior.
 * Does not modify PR #555.
 *
 * ASSEMBLE_ONLY=1 — freeze prompts / trigger / owner map, no provider calls.
 * Otherwise at most 2 DeepSeek calls (R_D, A_D). No retry. No continuation.
 */
import Module from "module";
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { buildContext } from "../../src/services/contextBuilder";
import { formatUserPersonaForPrompt } from "../../src/lib/persona";
import { loadCharacterChunksForPromptReadOnly } from "../../src/lib/characterChunks";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  resolveSelectedAI,
} from "../../src/lib/chatModels";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../../src/lib/responseLength";
import { UNIFIED_RESPONSE_LENGTH_TARGET } from "../../src/lib/responseLengthConstants";
import { estimateTokens } from "../../src/lib/tokenEstimate";
import {
  DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY,
  DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK,
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
  resolveDeepSeekShortHistoryLengthExtra,
} from "../../src/lib/deepseekPromptStructure";
import { SNPV2_DEEPSEEK_LENGTH_ARM_ENV } from "../../src/lib/sharedNovelProseModelAdapters";
import { buildCompactTerminalLayoutRecencyLine } from "../../src/lib/webnovelOutputFormat";
import {
  buildOpenRouterRequestBody,
  resolveOpenRouterMaxTokens,
} from "../../src/lib/openRouterClient";
import { adaptCheaperInferenceChatBody } from "../../src/lib/cheaperInferenceConfig";
import { streamOpenRouterAdult } from "../../src/lib/openRouterAdult";
import type { ChatMsg } from "../../src/lib/ai";

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, "data/ds0813-phase-d-short-history-audit");
const ASSEMBLE_ONLY = process.env.ASSEMBLE_ONLY === "1";
const USER_ID = 59;
const TARGET = UNIFIED_RESPONSE_LENGTH_TARGET;
const MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const DENSE_INTERNAL_SOURCE_SHA = "91be35edc3adbe790452ec9420dc7b28e3e6c97a";
const SHORT_HISTORY_AVG_NO_WS_THRESHOLD = 2200;
const MAX_PROVIDER_CALLS = 2;

/**
 * Exact frozen wording from PR #242 head 91be35ed.
 * Do not rewrite. Do not use current environment-heavy SHORT HISTORY.
 */
const DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_DENSE_INTERNAL =
  "Sustain it through specific interpretation, consequential primary-character choices, concrete action, observable change within the existing scene, relationship development, and necessary inner experience, while preserving a concrete opening for the user's response rather than relying on micro-action padding.";

const DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL =
  "[SHORT HISTORY]\n" +
  "Recent assistant length is context, not a response-length example. " +
  "In this single response, develop a full scene of roughly normal requested length even with sparse history. " +
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_DENSE_INTERNAL;

const DENSE_INTERNAL_TEXT_SHA =
  "905c197657f417036224e218c85c3d03533f880bb0322c2823fa0124decfe589";

const PR555_ARM_A = {
  R: {
    SYSTEM_SHA: "8bd6cd21a793b03a818df2f88b4352a6c024c7585667bc0d8773d84d31d61212",
    HISTORY_SHA: "cb8894f0598712f6f508c189a21b85c01d9b10f0de3db4533ee6dca7656c37cc",
    CURRENT_USER_SHA: "1fcca4740997c4e2add03619c49886bd70026b8b2eabf1f4b5e68f603043577c",
  },
  A: {
    SYSTEM_SHA: "01cd8ec380ce4f5cd1759c73869536258c99cbd0d55e3dfe28e2f6c2ef787ee6",
    HISTORY_SHA: "29e3149289586f303c3ffc120a299184163b162a78e46e4f264e87231f6d1d58",
    CURRENT_USER_SHA: "f1814a3aa6946b0ff339e0577b8d2130729cafec6b0c42a77cc369f41e379750",
  },
} as const;

type FixtureKey = "R" | "A";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(path.join(EVIDENCE, rel), "utf8")) as T;
}

function countNoWsChars(text: string): number {
  return [...text.replace(/\s+/g, "")].length;
}

function countHangul(text: string): number {
  return (text.match(/[\uAC00-\uD7A3]/g) ?? []).length;
}

function countParagraphs(text: string): number {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).length;
}

function countDialogue(text: string): number {
  return (text.match(/[「“"][^」”"]+[」”"]/g) ?? []).length;
}

function visibleCharsWithSpaces(text: string): number {
  return text.replace(/\r/g, "").length;
}

function visibleCharsNoSpaces(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function countExact(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function extractQuotes(text: string): string[] {
  return [...text.matchAll(/[「“"]([^」”"]+)[」”"]/g)].map((m) => m[1].trim()).filter(Boolean);
}

function normalizeDialogue(s: string): string {
  return s.replace(/[….\s]/g, "");
}

type CharacterRow = Record<string, unknown> & {
  id: number;
  name: string;
  gender?: string | null;
  nsfw?: number;
  system_prompt?: string;
  world?: string | null;
  example_dialog?: string | null;
  greeting?: string | null;
  setting_chunks?: string | null;
  setting_chunks_en?: string | null;
  speech_profile?: string | null;
  creator_compiled_description_json?: string | null;
  appearance_raw?: string | null;
  appearance_compiled?: string | null;
  content_kind?: string | null;
};

type Persona = { name: string; gender: string; description: string };
type UserInputs = Record<
  FixtureKey,
  {
    text: string;
    nsfw: boolean;
    is_adult_mode: boolean;
    adult_consent_mode: string | null;
  }
>;

function shortHistoryStats(history: Array<{ role: string; content: string }>) {
  const recent = history
    .filter((m) => m.role === "assistant" && m.content.trim())
    .slice(-3);
  const avg =
    recent.length === 0
      ? 0
      : recent.reduce((sum, m) => sum + countNoWsChars(m.content), 0) / recent.length;
  const productionBlock = resolveDeepSeekShortHistoryLengthExtra(history);
  return {
    RECENT_ASSISTANT_COUNT: recent.length,
    RECENT_ASSISTANT_AVG_NO_WS: recent.length === 0 ? 0 : avg,
    SHORT_HISTORY_AVG_NO_WS_THRESHOLD,
    SHORT_HISTORY_TRIGGERED: productionBlock != null,
    PRODUCTION_RESOLVER_RETURNS_ENV_HEAVY_BLOCK:
      productionBlock === DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
    NOTE: "Trigger uses existing resolver. Candidate D wording is injected only by this harness.",
  };
}

function injectCandidateD(productionUserTurn: string): string {
  const style = DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY;
  if (!productionUserTurn.startsWith(style)) {
    throw new Error("production user turn missing DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY prefix");
  }
  const rest = productionUserTurn.slice(style.length).replace(/^\n+/, "");
  if (!rest.startsWith("[CURRENT USER INPUT]")) {
    throw new Error("expected [CURRENT USER INPUT] immediately after style reminder");
  }
  return `${style}\n${DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL}\n\n${rest}`;
}

function ownerMap(system: string, currentUser: string) {
  const layout = buildCompactTerminalLayoutRecencyLine();
  const styleIdx = currentUser.indexOf(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY);
  const denseIdx = currentUser.indexOf(DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL);
  const inputIdx = currentUser.indexOf("[CURRENT USER INPUT]");
  const layoutIdx = currentUser.indexOf(layout);
  const tailIdx = currentUser.lastIndexOf(USER_TAIL_LENGTH_OWNER_SENTENCE);
  return {
    USER_TAIL_COUNT: countExact(currentUser, USER_TAIL_LENGTH_OWNER_SENTENCE),
    USER_TAIL_IN_SYSTEM: countExact(system, USER_TAIL_LENGTH_OWNER_SENTENCE),
    DENSE_SHORT_HISTORY_COUNT: countExact(
      currentUser,
      DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL
    ),
    DENSE_IN_SYSTEM: countExact(system, DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL),
    ENV_HEAVY_SHORT_HISTORY_COUNT: countExact(currentUser, DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA),
    SYSTEM_LENGTH_ADAPTER_COUNT: countExact(system, "[DEEPSEEK LENGTH ADAPTER"),
    HISTORICAL_SINGLE_CALL_COUNT:
      countExact(system, DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK) +
      countExact(currentUser, DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK),
    USER_TAIL_TERMINAL: currentUser.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE),
    ORDER_OK:
      styleIdx === 0 &&
      denseIdx > styleIdx &&
      inputIdx > denseIdx &&
      layoutIdx > inputIdx &&
      tailIdx > layoutIdx &&
      currentUser.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE),
  };
}

function flagsFor(text: string, userInput: string, greeting: string) {
  const t = text;
  const refusal =
    /죄송하지만|요청을 수행할 수 없|I cannot|I'm unable|cannot comply|정책상 거부/.test(t);
  const meta = /as an ai|language model|system prompt|I am an AI|인공지능으로서/i.test(t);
  const sysLeak =
    /USER_TAIL_LENGTH_OWNER|TARGET_LENGTH|MINIMUM_FLOOR|\[DEEPSEEK LENGTH|SNPV2_DEEPSEEK|NO GODMODDING|CHARACTER KNOWLEDGE BOUNDARY|\[SHORT HISTORY\]/.test(
      t
    );
  const sentences = t
    .split(/(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 24);
  const seen = new Map<string, number>();
  for (const s of sentences) seen.set(s, (seen.get(s) ?? 0) + 1);
  const exactDup = [...seen.values()].some((n) => n >= 2);

  const inputQuotes = extractQuotes(userInput).map(normalizeDialogue);
  const outputQuotes = extractQuotes(t);
  const echo = outputQuotes.some((q) =>
    inputQuotes.includes(normalizeDialogue(q))
  );
  const userAttributed = [
    ...t.matchAll(/도윤(?:이|은|가|도|만|에게)?[^「“"\n]{0,24}[「“"]([^」”"]+)[」”"]/g),
    ...t.matchAll(/[「“"]([^」”"]+)[」”"][^.!\n]{0,16}도윤/g),
  ].map((m) => normalizeDialogue(m[1]));
  const newUserDialogue = userAttributed.some((q) => q && !inputQuotes.includes(q));

  const userIntentional =
    /도윤(?:이|은|가)?\s*(?:손을 뻗|몸을 돌|고개를 끄덕이며 다가|문을 열고|옷을 벗기|키스를 깊게|답했다|물었다|선택했다|결정했다)/.test(
      t
    ) && !/숨이|떨|홍조|달아오|반사|무의식|생리|심장이|몸이 굳/.test(t);
  const userMajor = /도윤(?:이|은|가)?\s*(?:선택|결정)(?:했다|한다)/.test(t);
  const userConsent = /도윤(?:이|은|가)?\s*(?:동의|거절|승낙|허락|거부)(?:했다|한다)/.test(t);
  const newCanon =
    /갑자기.{0,12}(각성|각인|페어\s*확정|등급이\s*바뀌)/.test(t);
  const inventedPct = [...t.matchAll(/\b(\d{1,3})%\b/g)].map((m) => m[1]);
  const sourceHasPct = /\d{1,3}%/.test(userInput) || /\d{1,3}%/.test(greeting);
  const numericState = inventedPct.length > 0 && !sourceHasPct;
  const newNpc =
    /처음 보는\s+(?:남자|여자|요원|가이드|센티넬)|낯선\s+(?:남자|여자)가\s+다가/.test(t);
  const unrelated = /갑자기\s+(?:게이트가\s+열|폭발|사이렌|경보)/.test(t);
  const premature =
    /그날 밤은 그렇게|다음 날 아침|며칠이 지난|장면은 그렇게 끝|자리를 떠났다\./.test(t);

  return {
    REFUSAL_PRESENT: refusal,
    META_LEAK: meta,
    SYSTEM_PROMPT_LEAK: sysLeak,
    EXACT_SENTENCE_DUPLICATION: exactDup,
    CURRENT_USER_DIALOGUE_ECHO: echo,
    NEW_USER_DIALOGUE_BEYOND_CURRENT_INPUT: newUserDialogue,
    NEW_USER_INTENTIONAL_ACTION_BEYOND_CURRENT_INPUT: userIntentional,
    USER_MAJOR_CHOICE_AUTHORED: userMajor,
    USER_CONSENT_OR_REFUSAL_AUTHORED: userConsent,
    NEW_CHARACTER_CANON_FACT: newCanon,
    NEW_DYNAMIC_NUMERIC_STATE_WITHOUT_SOURCE: numericState,
    NEW_EXTERNAL_NPC: newNpc,
    UNRELATED_EVENT: unrelated,
    PREMATURE_SCENE_CLOSE: premature,
    OUTPUT_TRUNCATED: false,
    NOTE_INVOLUNTARY_USER_PHYSIOLOGY_NOT_AGENCY:
      "breathing / tremble / flush / involuntary movement / physiological arousal / reflexive body response are not flagged as agency violations",
    INPUT_QUOTES: extractQuotes(userInput),
  };
}

type StreamTiming = {
  REQUEST_START_MS: number | null;
  HEADERS_RECEIVED_MS: number | null;
  FIRST_STREAM_EVENT_MS: number | null;
  FIRST_VISIBLE_DELTA_MS: number | null;
  LAST_VISIBLE_DELTA_MS: number | null;
  FINISH_EVENT_MS: number | null;
  TOTAL_LATENCY_MS: number | null;
  TTFT_VISIBLE_MS: number | null;
  VISIBLE_STREAM_DURATION_MS: number | null;
  REASONING_STREAM_SEEN: boolean;
  REASONING_TEXT_CHARS: number;
};

function emptyTiming(): StreamTiming {
  return {
    REQUEST_START_MS: null,
    HEADERS_RECEIVED_MS: null,
    FIRST_STREAM_EVENT_MS: null,
    FIRST_VISIBLE_DELTA_MS: null,
    LAST_VISIBLE_DELTA_MS: null,
    FINISH_EVENT_MS: null,
    TOTAL_LATENCY_MS: null,
    TTFT_VISIBLE_MS: null,
    VISIBLE_STREAM_DURATION_MS: null,
    REASONING_STREAM_SEEN: false,
    REASONING_TEXT_CHARS: 0,
  };
}

function finalizeTiming(t: StreamTiming): StreamTiming {
  if (t.REQUEST_START_MS != null && t.FIRST_VISIBLE_DELTA_MS != null) {
    t.TTFT_VISIBLE_MS = t.FIRST_VISIBLE_DELTA_MS - t.REQUEST_START_MS;
  }
  if (t.FIRST_VISIBLE_DELTA_MS != null && t.LAST_VISIBLE_DELTA_MS != null) {
    t.VISIBLE_STREAM_DURATION_MS = t.LAST_VISIBLE_DELTA_MS - t.FIRST_VISIBLE_DELTA_MS;
  }
  if (t.REQUEST_START_MS != null && t.FINISH_EVENT_MS != null && t.TOTAL_LATENCY_MS == null) {
    t.TOTAL_LATENCY_MS = t.FINISH_EVENT_MS - t.REQUEST_START_MS;
  }
  return t;
}

function installFetchTimer(timing: StreamTiming): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const isChat = url.includes("/chat/completions");
    if (isChat) timing.REQUEST_START_MS = Date.now();
    const res = await orig(input, init);
    if (!isChat || !res.body) return res;
    timing.HEADERS_RECEIVED_MS = Date.now();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let carry = "";
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        const now = Date.now();
        carry += decoder.decode(value, { stream: true });
        const lines = carry.split("\n");
        carry = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          if (timing.FIRST_STREAM_EVENT_MS == null) timing.FIRST_STREAM_EVENT_MS = now;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            if (timing.FINISH_EVENT_MS == null) timing.FINISH_EVENT_MS = now;
            continue;
          }
          try {
            const json = JSON.parse(payload) as {
              choices?: Array<{
                delta?: {
                  content?: string | null;
                  text?: string | null;
                  reasoning?: string | null;
                  reasoning_content?: string | null;
                };
                finish_reason?: string | null;
              }>;
            };
            const choice = json.choices?.[0];
            const reasoning = `${choice?.delta?.reasoning ?? ""}${choice?.delta?.reasoning_content ?? ""}`;
            if (reasoning) {
              timing.REASONING_STREAM_SEEN = true;
              timing.REASONING_TEXT_CHARS += reasoning.length;
            }
            const visible = `${choice?.delta?.content ?? ""}${choice?.delta?.text ?? ""}`;
            if (visible) {
              if (timing.FIRST_VISIBLE_DELTA_MS == null) timing.FIRST_VISIBLE_DELTA_MS = now;
              timing.LAST_VISIBLE_DELTA_MS = now;
            }
            if (choice?.finish_reason) timing.FINISH_EVENT_MS = now;
          } catch {
            /* incomplete SSE json */
          }
        }
        controller.enqueue(value);
      },
    });
    return new Response(stream, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
  return () => {
    globalThis.fetch = orig;
  };
}

function assembleOne(opts: {
  fixtureKey: FixtureKey;
  character: CharacterRow;
  persona: Persona;
  userText: string;
  nsfw: boolean;
}) {
  delete process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV];
  const greeting = String(opts.character.greeting ?? "");
  const shortTermHistory = [{ role: "assistant" as const, content: greeting }];
  const trigger = shortHistoryStats(shortTermHistory);
  const { chunks, usedEnglish } = loadCharacterChunksForPromptReadOnly(
    opts.character as never,
    opts.persona.name,
    opts.persona.name
  );
  const userPersona = formatUserPersonaForPrompt(
    opts.persona.name,
    opts.persona.description,
    opts.persona.name
  );
  const resolved = resolveSelectedAI(MODEL);
  const built = buildContext({
    charName: String(opts.character.name),
    chunks,
    userNickname: opts.persona.name,
    userPersona,
    userNote: "",
    longTermMemory: "",
    archiveMemory: null,
    shortTermHistory,
    currentUserMessage: opts.userText,
    nsfw: opts.nsfw,
    gender: (opts.character.gender as "male" | "female" | "other") ?? "other",
    userId: USER_ID,
    chatId: opts.fixtureKey === "R" ? 900017 : 900018,
    targetResponseChars: TARGET,
    modelId: resolved,
    provider: "openrouter",
    personaDisplayName: opts.persona.name,
    userPersonaGender: (opts.persona.gender as "male" | "female" | "other") ?? "male",
    useEnglishCharacterPrompt: usedEnglish,
    contentKind:
      opts.character.content_kind === "simulation" ? "simulation" : "character",
    userImpersonation: false,
    novelModeEnabled: false,
  });

  const system = built.systemPrompt ?? "";
  const history: ChatMsg[] = (built.history ?? []).map((m) => ({ ...m }));
  const lastUserIdx = [...history].map((m, i) => [m, i] as const).reverse().find(([m]) => m.role === "user")?.[1];
  if (lastUserIdx == null) throw new Error("assembled history missing current user turn");
  const productionUser = history[lastUserIdx].content;
  const productionUserSha = sha256(productionUser);

  if (trigger.SHORT_HISTORY_TRIGGERED) {
    history[lastUserIdx] = {
      ...history[lastUserIdx],
      content: injectCandidateD(productionUser),
    };
  }

  const currentUser = history[lastUserIdx].content;
  const historyOnly = history
    .filter((m, i) => i !== lastUserIdx)
    .map((m) => m.content)
    .join("\n\n");
  const owners = ownerMap(system, currentUser);
  const requestBody = adaptCheaperInferenceChatBody(
    buildOpenRouterRequestBody(
      resolved,
      [{ role: "system", content: system }, ...history],
      true,
      TARGET
    ) as Record<string, unknown>
  );

  return {
    fixtureKey: opts.fixtureKey,
    usedEnglish,
    chunkCount: chunks.length,
    greetingNoWs: countNoWsChars(greeting),
    trigger,
    system,
    history,
    currentUser,
    productionUser,
    SYSTEM_SHA: sha256(system),
    HISTORY_SHA: sha256(historyOnly),
    CURRENT_USER_SHA: sha256(currentUser),
    PRODUCTION_CURRENT_USER_SHA: productionUserSha,
    PR555_ARM_A_SYSTEM_SHA_MATCH: system ? sha256(system) === PR555_ARM_A[opts.fixtureKey].SYSTEM_SHA : false,
    PR555_ARM_A_HISTORY_SHA_MATCH: sha256(historyOnly) === PR555_ARM_A[opts.fixtureKey].HISTORY_SHA,
    PR555_ARM_A_PRODUCTION_USER_SHA_MATCH:
      productionUserSha === PR555_ARM_A[opts.fixtureKey].CURRENT_USER_SHA,
    DENSE_INTERNAL_TEXT_SHA: sha256(DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL),
    DENSE_INTERNAL_SOURCE_SHA,
    owners,
    SYSTEM_TOKENS: estimateTokens(system),
    HISTORY_TOKENS: estimateTokens(historyOnly),
    CURRENT_USER_TOKENS: estimateTokens(currentUser),
    TOTAL_ESTIMATED_INPUT: estimateTokens(
      `${system}\n${history.map((m) => m.content).join("\n")}`
    ),
    requestBody,
    maxTokens: resolveOpenRouterMaxTokens(TARGET, undefined, resolved),
    thinking: requestBody.thinking ?? null,
    reasoning_effort: requestBody.reasoning_effort ?? null,
    reasoning: requestBody.reasoning ?? null,
  };
}

async function callOnce(system: string, history: ChatMsg[], timing: StreamTiming) {
  const restore = installFetchTimer(timing);
  const wallStart = Date.now();
  try {
    const stream = streamOpenRouterAdult(
      system,
      history,
      MODEL,
      TARGET,
      {
        transportProvider: "cheaperinference",
        allowOpenRouterUnderLengthRecovery: false,
        allowEmptyStreamFallback: false,
      },
      {
        requestKind: "ds0813-phase-d-short-history-audit",
        chargeTurnBudget: false,
      }
    );
    let text = "";
    let result = await stream.next();
    while (!result.done) {
      text += result.value;
      result = await stream.next();
    }
    timing.TOTAL_LATENCY_MS = Date.now() - wallStart;
    return {
      text,
      usage: result.value,
      httpStatus: 200,
      error: null,
    };
  } catch (e) {
    timing.TOTAL_LATENCY_MS = Date.now() - wallStart;
    const msg = e instanceof Error ? e.message : String(e);
    const http = /(\b5\d\d\b)/.exec(msg)?.[1];
    return {
      text: "",
      usage: null,
      httpStatus: http ? Number(http) : null,
      error: msg.slice(0, 2000),
    };
  } finally {
    restore();
    finalizeTiming(timing);
  }
}

async function main() {
  if (sha256(DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL) !== DENSE_INTERNAL_TEXT_SHA) {
    throw new Error("Candidate D wording SHA mismatch — refuse to rewrite");
  }
  mkdirSync(path.join(EVIDENCE, "assembled"), { recursive: true });
  mkdirSync(path.join(EVIDENCE, "raw"), { recursive: true });
  mkdirSync(path.join(EVIDENCE, "flags"), { recursive: true });

  const flood = loadJson<CharacterRow>("fixtures/character-17-flood.json");
  const like = loadJson<CharacterRow>("fixtures/character-18-like.json");
  const persona = loadJson<Persona>("fixtures/persona-doyun.json");
  const inputs = loadJson<UserInputs>("fixtures/user-inputs.json");
  const fixtures: Record<FixtureKey, { character: CharacterRow; nsfw: boolean; text: string }> = {
    R: { character: flood, nsfw: inputs.R.nsfw, text: inputs.R.text },
    A: { character: like, nsfw: inputs.A.nsfw, text: inputs.A.text },
  };

  const assembled: Record<string, ReturnType<typeof assembleOne>> = {};
  const triggerFreeze: Record<string, unknown> = {};
  for (const fk of ["R", "A"] as FixtureKey[]) {
    const rec = assembleOne({
      fixtureKey: fk,
      character: fixtures[fk].character,
      persona,
      userText: fixtures[fk].text,
      nsfw: fixtures[fk].nsfw,
    });
    assembled[fk] = rec;
    triggerFreeze[fk] = rec.trigger;
    writeFileSync(
      path.join(EVIDENCE, "assembled", `${fk}_D.json`),
      JSON.stringify(
        {
          ...rec,
          requestBody: {
            model: rec.requestBody.model,
            thinking: rec.requestBody.thinking,
            reasoning_effort: rec.requestBody.reasoning_effort,
            reasoning: rec.requestBody.reasoning,
            max_tokens: rec.requestBody.max_tokens,
            temperature: rec.requestBody.temperature,
          },
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(path.join(EVIDENCE, "assembled", `${fk}_D.system.txt`), rec.system, "utf8");
    writeFileSync(path.join(EVIDENCE, "assembled", `${fk}_D.user.txt`), rec.currentUser, "utf8");
    writeFileSync(
      path.join(EVIDENCE, "assembled", `${fk}_D.production-user.txt`),
      rec.productionUser,
      "utf8"
    );
  }

  const ownerFreeze = {
    BASE_MAIN_SHA: "98f8111a6e81ad9551c3c9c5777032e40f7b4b3d",
    DENSE_INTERNAL_SOURCE_SHA,
    DENSE_INTERNAL_TEXT_SHA,
    CANDIDATE: "D",
    ONLY_PROMPT_VARIABLE: "DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL",
    fixtures: Object.fromEntries(
      Object.entries(assembled).map(([k, v]) => [
        k,
        {
          ...v.owners,
          trigger: v.trigger,
          SYSTEM_SHA: v.SYSTEM_SHA,
          HISTORY_SHA: v.HISTORY_SHA,
          CURRENT_USER_SHA: v.CURRENT_USER_SHA,
          PRODUCTION_CURRENT_USER_SHA: v.PRODUCTION_CURRENT_USER_SHA,
          PR555_ARM_A_SYSTEM_SHA_MATCH: v.PR555_ARM_A_SYSTEM_SHA_MATCH,
          PR555_ARM_A_HISTORY_SHA_MATCH: v.PR555_ARM_A_HISTORY_SHA_MATCH,
          PR555_ARM_A_PRODUCTION_USER_SHA_MATCH: v.PR555_ARM_A_PRODUCTION_USER_SHA_MATCH,
          thinking: v.thinking,
          reasoning_effort: v.reasoning_effort,
        },
      ])
    ),
  };
  writeFileSync(path.join(EVIDENCE, "OWNER_MAP.json"), JSON.stringify(ownerFreeze, null, 2), "utf8");
  writeFileSync(path.join(EVIDENCE, "TRIGGER.json"), JSON.stringify(triggerFreeze, null, 2), "utf8");

  const assertOwners = (fk: FixtureKey) => {
    const o = assembled[fk].owners;
    const checks = {
      USER_TAIL_COUNT: o.USER_TAIL_COUNT === 1,
      DENSE_SHORT_HISTORY_COUNT: o.DENSE_SHORT_HISTORY_COUNT === 1,
      SYSTEM_LENGTH_ADAPTER_COUNT: o.SYSTEM_LENGTH_ADAPTER_COUNT === 0,
      HISTORICAL_SINGLE_CALL_COUNT: o.HISTORICAL_SINGLE_CALL_COUNT === 0,
      ENV_HEAVY_ABSENT: o.ENV_HEAVY_SHORT_HISTORY_COUNT === 0,
      USER_TAIL_TERMINAL: o.USER_TAIL_TERMINAL,
      ORDER_OK: o.ORDER_OK,
      DENSE_NOT_IN_SYSTEM: o.DENSE_IN_SYSTEM === 0,
    };
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([n]) => n);
    return { checks, failed };
  };

  const ownerAssert = {
    R: assertOwners("R"),
    A: assertOwners("A"),
  };
  writeFileSync(
    path.join(EVIDENCE, "OWNER_ASSERT.json"),
    JSON.stringify(ownerAssert, null, 2),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        phase: "assembled",
        triggerFreeze,
        ownerAssert,
        R_SYSTEM_MATCH: assembled.R.PR555_ARM_A_SYSTEM_SHA_MATCH,
        A_SYSTEM_MATCH: assembled.A.PR555_ARM_A_SYSTEM_SHA_MATCH,
      },
      null,
      2
    )
  );

  if (ownerAssert.R.failed.length || ownerAssert.A.failed.length) {
    throw new Error(`owner-map assert failed: ${JSON.stringify(ownerAssert)}`);
  }

  const stopped: string[] = [];
  for (const fk of ["R", "A"] as FixtureKey[]) {
    if (!assembled[fk].trigger.SHORT_HISTORY_TRIGGERED) {
      stopped.push(fk);
      writeFileSync(
        path.join(EVIDENCE, `${fk}_TRIGGER_STOP.json`),
        JSON.stringify(
          {
            STOP: true,
            REASON: "SHORT_HISTORY_TRIGGERED=false — do not alter threshold, do not call provider",
            trigger: assembled[fk].trigger,
          },
          null,
          2
        ),
        "utf8"
      );
    }
  }

  if (ASSEMBLE_ONLY) return;

  let providerCalls = 0;
  const results: Record<string, unknown>[] = [];
  for (const fk of ["R", "A"] as FixtureKey[]) {
    if (!assembled[fk].trigger.SHORT_HISTORY_TRIGGERED) continue;
    if (providerCalls >= MAX_PROVIDER_CALLS) break;
    const rec = assembled[fk];
    const timing = emptyTiming();
    console.log(JSON.stringify({ phase: "calling", key: `${fk}_D` }));
    const out = await callOnce(rec.system, rec.history, timing);
    providerCalls += 1;
    const usage = (out.usage ?? {}) as Record<string, unknown>;
    const raw = out.text;
    writeFileSync(path.join(EVIDENCE, "raw", `${fk}_D.txt`), raw, "utf8");
    const finish =
      (usage.finishReason as string | undefined) ??
      (usage.finish_reason as string | undefined) ??
      null;
    const truncated = finish === "length" || finish === "max_tokens";
    const flags = {
      ...flagsFor(raw, fixtures[fk].text, String(fixtures[fk].character.greeting ?? "")),
      OUTPUT_TRUNCATED: truncated,
    };
    writeFileSync(path.join(EVIDENCE, "flags", `${fk}_D.json`), JSON.stringify(flags, null, 2), "utf8");
    const row = {
      KEY: `${fk}_D`,
      HTTP_STATUS: out.httpStatus,
      ERROR: out.error,
      FINISH_REASON: finish,
      INPUT_TOKENS: usage.inputTokens ?? usage.prompt_tokens ?? null,
      OUTPUT_TOKENS: usage.outputTokens ?? usage.completion_tokens ?? null,
      REASONING_TOKENS:
        usage.reasoningOutputTokens ?? usage.apiReasoningOutputTokens ?? usage.reasoning_tokens ?? 0,
      PROVIDER_COST: usage.cost ?? null,
      VISIBLE_CHARS_WITH_SPACES: visibleCharsWithSpaces(raw),
      VISIBLE_CHARS_NO_SPACES: visibleCharsNoSpaces(raw),
      KOREAN_CHARS: countHangul(raw),
      PARAGRAPH_COUNT: countParagraphs(raw),
      DIALOGUE_LINE_COUNT: countDialogue(raw),
      RAW_SHA256: sha256(raw),
      SYSTEM_SHA: rec.SYSTEM_SHA,
      HISTORY_SHA: rec.HISTORY_SHA,
      CURRENT_USER_SHA: rec.CURRENT_USER_SHA,
      timing,
      flags,
      usage,
    };
    results.push(row);
    writeFileSync(path.join(EVIDENCE, "raw", `${fk}_D.meta.json`), JSON.stringify(row, null, 2), "utf8");
    if (out.httpStatus && out.httpStatus >= 500) {
      console.log(JSON.stringify({ frozen_5xx: `${fk}_D`, status: out.httpStatus }));
      writeFileSync(
        path.join(EVIDENCE, `${fk}_D_5XX_STOP.json`),
        JSON.stringify({ STOP: true, HTTP_STATUS: out.httpStatus, ERROR: out.error }, null, 2),
        "utf8"
      );
    }
  }

  const r = results.find((x) => x.KEY === "R_D") as { VISIBLE_CHARS_WITH_SPACES?: number } | undefined;
  const a = results.find((x) => x.KEY === "A_D") as { VISIBLE_CHARS_WITH_SPACES?: number } | undefined;
  const rc = r?.VISIBLE_CHARS_WITH_SPACES ?? null;
  const ac = a?.VISIBLE_CHARS_WITH_SPACES ?? null;
  const rPass = rc != null && rc >= 2700;
  const aPass = ac != null && ac >= 2700;
  const bothCalled = rc != null && ac != null;
  const lengthReport = {
    R_D_CHARS: rc,
    A_D_CHARS: ac,
    R_D_GE_2700: rPass,
    A_D_GE_2700: aPass,
    D_SCREEN_LENGTH_PASS: bothCalled && rPass && aPass,
    D_SCREEN_FAIL: bothCalled && !(rPass && aPass),
    PROVIDER_CALLS: providerCalls,
    RETRIES: 0,
    CONTINUATION_CALLS: 0,
    TRIGGER_STOPS: stopped,
    QUALITY_SCORE_ASSIGNED: false,
    MODEL_WINNER_SELECTED: false,
  };
  writeFileSync(
    path.join(EVIDENCE, "LENGTH_REPORT.json"),
    JSON.stringify({ lengthReport, results }, null, 2),
    "utf8"
  );
  console.log(JSON.stringify({ phase: "done", lengthReport }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
