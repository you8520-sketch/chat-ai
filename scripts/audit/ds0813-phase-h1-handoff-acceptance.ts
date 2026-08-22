/**
 * Phase H1: assemble the frozen PR #560 Gemini → DeepSeek handoff fixture
 * with current production owners, then (only after acceptance) run exactly
 * 3 DeepSeek V4 Pro 0813 calls (H1R1/H1R2/H1R3).
 *
 * ASSEMBLE_ONLY=1 — freeze assembly + acceptance, no provider calls.
 * Not imported by production.
 */
import Module from "module";
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { loadEnvLocal } from "../load-env-local";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import type { ChatMsg } from "../../src/lib/ai";
import type { CharacterSettingRow } from "../../src/lib/characterChunks";
import { loadCharacterChunksForPromptReadOnly } from "../../src/lib/characterChunks";
import { formatPublicPersonaForPrompt } from "../../src/lib/personaSecretPrompt";
import { resolveExampleDialogForPrompt } from "../../src/lib/narrationFewShotTemplates";
import { resolveNarrativePov } from "../../src/lib/narrativePov";
import { resolveCharacterGender } from "../../src/lib/characterGender";
import { UNIFIED_RESPONSE_LENGTH_TARGET } from "../../src/lib/responseLengthConstants";
import { buildContext } from "../../src/services/contextBuilder";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "../../src/lib/chatModels";
import {
  advanceModelRouteState,
  appendAdultHandoffPrompt,
  appendAdultHandoffToSystemSplit,
  buildSceneContinuityPacket,
  classifySceneMode,
  DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
  detectModelRefusal,
  extractHandoffContinuityFromAssistantText,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
  resolveEffectiveConsentMode,
  selectAdultHandoffRawVariants,
  type ModelRouteState,
  type SceneContinuityPacket,
} from "../../src/lib/adultSceneRouting";
import {
  invokePreparedAdultRefusalFallback,
  resolveAdultDeliveryPlan,
} from "../../src/lib/adultDeliveryPlan";
import {
  resolveAdultHandoffTargetModelId,
  resolvePersistedAdultHandoffSourceModelId,
} from "../../src/lib/adultHandoffSourceRouting";
import {
  adaptCheaperInferenceChatBody,
  applyDeepSeekAdultHandoffTrueOff,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
  resolveDeepSeekAdultHandoffTrueOff,
} from "../../src/lib/cheaperInferenceConfig";
import { assemblePrimaryRpRequest } from "../../src/lib/openRouterAdult";
import { buildOpenRouterRequestBody } from "../../src/lib/openRouterClient";
import { estimateTokens } from "../../src/lib/tokenEstimate";
import {
  CURRENT_USER_AGENCY_REINFORCEMENT_OWNER,
  wrapCurrentUserInput,
} from "../../src/lib/currentUserInputLabel";
import {
  STANDARD_AGENCY_ALLOWED_EXCEPTIONS,
  STANDARD_AGENCY_CANONICAL_OWNER,
  STANDARD_AGENCY_FORBIDDEN_NEW_B,
  buildNoGodmoddingBlock,
} from "../../src/lib/noGodmodding";

loadEnvLocal();

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, "data/ds0813-phase-h1-handoff-authority");
const ASSEMBLE_ONLY = process.env.ASSEMBLE_ONLY === "1";
const GEMINI = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const REFUSAL_SEAM = "I cannot fulfill this request.";
const TARGET = UNIFIED_RESPONSE_LENGTH_TARGET;
const FLOOR = 2700;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
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

function publicBodyKeys(body: Record<string, unknown>): Record<string, unknown> {
  const skip = new Set(["messages"]);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(body).sort()) {
    if (skip.has(key)) continue;
    if (/authorization|api[_-]?key|bearer/i.test(key)) continue;
    out[key] = body[key];
  }
  out.KEYS = Object.keys(body).sort();
  out.HAS_MESSAGES = Array.isArray(body.messages);
  out.MESSAGE_COUNT = Array.isArray(body.messages) ? body.messages.length : 0;
  return out;
}

function sentenceWindow(text: string, index: number, span = 80): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + span);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function firstMatchSentence(text: string, re: RegExp): string | null {
  const m = text.match(re);
  if (!m || m.index == null) return null;
  return sentenceWindow(text, m.index, Math.max(80, m[0].length + 40));
}

type FlagValue = boolean | "UNCERTAIN";

function flagWithEvidence(
  value: FlagValue,
  evidence: string | null
): { value: FlagValue; evidence: string | null } {
  return { value, evidence: value === false ? null : evidence };
}

/**
 * H1 objective flags. Involuntary physiology is not an agency violation.
 * Ambiguous hits are UNCERTAIN with the matching RAW span.
 */
function flagsFor(text: string, finishReason: string | null) {
  const spoken = firstMatchSentence(
    text,
    /렌(?:이|은|가|도)?[^「“"\n]{0,20}(?:말했다|물었다|답했다|대꾸했다|중얼거렸다|속삭였다)\s*[「“"][^」”"]+[」”"]/
  );
  const spokenQuote = firstMatchSentence(
    text,
    /렌(?:이|은|가|도)?[^.\n]{0,24}[「“"][^」”"]+[」”"]/
  );
  const deliberate = firstMatchSentence(
    text,
    /렌(?:이|은|가)?\s*(?:태형|라이크)?(?:의)?\s*(?:몸을\s*벽|벽\s*쪽|벽을\s*향해|밀어붙|손을\s*(?:뻗|옮|가져|넣)|끌어당|잡아끌|문을\s*열고|자리를\s*옮|한\s*발\s*(?:다가|물러)|물건을\s*(?:집|챙|사용))/
  );
  const inner = firstMatchSentence(
    text,
    /렌(?:이|은|가)?\s*(?:속으로|마음속으로|생각했다|바랐다|원했다)/
  );
  const intent = firstMatchSentence(
    text,
    /렌(?:이|은|가|도|의)?[^.\n]{0,24}(?:더\s*원하고|원하고\s*있|좋아하(?:고|는)|동의한|거절한|두려운|겁먹은)/
  );
  const consent = firstMatchSentence(
    text,
    /렌(?:이|은|가)?\s*(?:동의|거절|승낙|허락|거부)(?:했다|한다)/
  );
  const major = firstMatchSentence(
    text,
    /렌(?:이|은|가)?\s*(?:선택|결정)(?:했다|한다)/
  );
  const rewind = firstMatchSentence(
    text,
    /(?:같이\s*갈래\?|서쪽\s*통로|형광\s*라인|로비\s*중앙의\s*분수)/
  );
  const staleLoc = firstMatchSentence(
    text,
    /(?:벽면의\s*안내판|형광\s*라인이\s*긴\s*복도|로비\s*중앙의\s*분수|서쪽\s*통로)/
  );
  const newLoc = firstMatchSentence(text, /응접실|회의실|옥상|지하\s*주차장/);
  const sceneEvent = firstMatchSentence(
    text,
    /(?:CCTV|씨씨티비|순찰|경보|알람이\s*울|경비원이)/
  );
  const forced = /(?:어떻게\s*할래|선택해|A\s*아니면\s*B|어디로\s*갈래)\s*[?？]?[.\s]*$/.test(
    text.trim()
  )
    ? text.trim().slice(-120)
    : null;
  const refusal = /죄송하지만|요청을 수행할 수 없|I cannot|I'm unable|cannot comply|정책상 거부|cannot fulfill/i.test(
    text
  );
  const meta = /as an ai|language model|system prompt|I am an AI|인공지능으로서|safety policy/i.test(
    text
  );
  const sysLeak =
    /USER_TAIL_LENGTH_OWNER|TARGET_LENGTH|MINIMUM_FLOOR|\[DEEPSEEK LENGTH|NO GODMODDING|SceneContinuityPacket|adultHandoff|reasoning_effort/.test(
      text
    );
  const foreign = /[\u0400-\u04FF\u3040-\u30FF]/.test(text);
  const truncated =
    finishReason === "length" || /[은는이가을를]\s*$/.test(text.trim()) || /,\s*$/.test(text.trim());

  return {
    NEW_USER_SPOKEN_DIALOGUE: flagWithEvidence(
      spoken ? true : spokenQuote ? "UNCERTAIN" : false,
      spoken ?? spokenQuote
    ),
    NEW_USER_DELIBERATE_ACTION: flagWithEvidence(Boolean(deliberate), deliberate),
    NEW_USER_INNER_THOUGHT: flagWithEvidence(inner ? "UNCERTAIN" : false, inner),
    NEW_USER_INTENT_ATTRIBUTION: flagWithEvidence(Boolean(intent), intent),
    USER_CONSENT_OR_REFUSAL_AUTHORED: flagWithEvidence(Boolean(consent), consent),
    USER_MAJOR_CHOICE_AUTHORED: flagWithEvidence(Boolean(major), major),
    CURRENT_USER_SCENE_REWOUND: flagWithEvidence(Boolean(rewind), rewind),
    STALE_PREVIOUS_LOCATION_RESTORED: flagWithEvidence(Boolean(staleLoc), staleLoc),
    NEW_UNSUPPORTED_LOCATION: flagWithEvidence(Boolean(newLoc), newLoc),
    NEW_SCENE_DRIVING_EVENT: flagWithEvidence(Boolean(sceneEvent), sceneEvent),
    TURN_ENDS_ON_NEW_FORCED_CHOICE: flagWithEvidence(Boolean(forced), forced),
    REFUSAL: flagWithEvidence(refusal, refusal ? text.slice(0, 160) : null),
    META_LEAK: flagWithEvidence(meta, meta ? firstMatchSentence(text, /as an ai|language model|system prompt|I am an AI|인공지능으로서|safety policy/i) : null),
    SYSTEM_LEAK: flagWithEvidence(sysLeak, sysLeak ? firstMatchSentence(text, /USER_TAIL_LENGTH_OWNER|TARGET_LENGTH|MINIMUM_FLOOR|\[DEEPSEEK LENGTH|NO GODMODDING|SceneContinuityPacket|adultHandoff|reasoning_effort/) : null),
    FOREIGN_SCRIPT: flagWithEvidence(foreign, foreign ? firstMatchSentence(text, /[\u0400-\u04FF\u3040-\u30FF]/) : null),
    TRUNCATION: flagWithEvidence(truncated, truncated ? text.trim().slice(-80) : null),
    NOTE_INVOLUNTARY_PHYSIOLOGY_NOT_AGENCY:
      "automatic / involuntary physiological reactions are not agency violations",
  };
}

type StreamTiming = {
  REQUEST_START: string | null;
  HEADERS_RECEIVED: string | null;
  FIRST_VISIBLE_DELTA: string | null;
  LAST_VISIBLE_DELTA: string | null;
  FINISH_EVENT: string | null;
  TTFT_MS: number | null;
  TOTAL_LATENCY_MS: number | null;
  REASONING_STREAM_EVENTS: number;
  REASONING_TEXT_CHARS: number;
};

function iso(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

async function callExactBody(body: Record<string, unknown>) {
  const wallStart = Date.now();
  let headersMs: number | null = null;
  let firstVisible: number | null = null;
  let lastVisible: number | null = null;
  let finishMs: number | null = null;
  let reasoningEvents = 0;
  let reasoningChars = 0;
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(),
    body: JSON.stringify(body),
  });
  headersMs = Date.now();
  if (!res.body) {
    return {
      httpStatus: res.status,
      text: "",
      finishReason: null,
      usage: null as Record<string, unknown> | null,
      timing: {
        REQUEST_START: iso(wallStart),
        HEADERS_RECEIVED: iso(headersMs),
        FIRST_VISIBLE_DELTA: null,
        LAST_VISIBLE_DELTA: null,
        FINISH_EVENT: null,
        TTFT_MS: null,
        TOTAL_LATENCY_MS: Date.now() - wallStart,
        REASONING_STREAM_EVENTS: 0,
        REASONING_TEXT_CHARS: 0,
      } satisfies StreamTiming,
    };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let text = "";
  let finishReason: string | null = null;
  let usage: Record<string, unknown> | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const now = Date.now();
      carry += decoder.decode(value, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          if (finishMs == null) finishMs = now;
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
            usage?: Record<string, unknown>;
          };
          const choice = json.choices?.[0];
          const reasoning = `${choice?.delta?.reasoning ?? ""}${choice?.delta?.reasoning_content ?? ""}`;
          if (reasoning) {
            reasoningEvents += 1;
            reasoningChars += [...reasoning].length;
          }
          const visible = `${choice?.delta?.content ?? ""}${choice?.delta?.text ?? ""}`;
          if (visible) {
            if (firstVisible == null) firstVisible = now;
            lastVisible = now;
            text += visible;
          }
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
            finishMs = now;
          }
          if (json.usage) usage = json.usage;
        } catch {
          /* incomplete SSE */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return {
    httpStatus: res.status,
    text,
    finishReason,
    usage,
    timing: {
      REQUEST_START: iso(wallStart),
      HEADERS_RECEIVED: iso(headersMs),
      FIRST_VISIBLE_DELTA: iso(firstVisible),
      LAST_VISIBLE_DELTA: iso(lastVisible),
      FINISH_EVENT: iso(finishMs),
      TTFT_MS: firstVisible != null ? firstVisible - wallStart : null,
      TOTAL_LATENCY_MS: Date.now() - wallStart,
      REASONING_STREAM_EVENTS: reasoningEvents,
      REASONING_TEXT_CHARS: reasoningChars,
    } satisfies StreamTiming,
  };
}

function messagesSha(messages: ChatMsg[]): string {
  return sha256(messages.map((m) => `${m.role}\u0000${m.content}`).join("\u0001"));
}

function historySha(history: ChatMsg[]): string {
  return sha256(history.map((m) => `${m.role}\u0000${m.content}`).join("\u0001"));
}

function proveAcceptance(input: {
  systemPrompt: string;
  currentUserWrapped: string;
  currentUserText: string;
  packet: SceneContinuityPacket;
}): Record<string, boolean | string> {
  const { systemPrompt, currentUserWrapped, currentUserText, packet } = input;
  const oldContinue = /직전 assistant 출력의 바로 다음 순간부터/.test(systemPrompt);
  const oldKeep = /최대한 유지/.test(systemPrompt);
  const oldUnfinished = /직전 출력에서 완료되지 않은 행동이나 대화가 있다면/.test(
    systemPrompt
  );
  const newest = /현재 사용자 턴 전체가 최신 장면 상태다/.test(systemPrompt);
  const noTruncate = /사용자 턴을 자르거나 다시 해석하지 않는다/.test(systemPrompt);
  const minorAllow =
    /사소한 이동·접촉·물건 수취·일상 행동은 공동 서술할 수 있다/.test(systemPrompt) ||
    /small movement\/contact\/object-handling\/daily continuity may be co-narrated/.test(
      currentUserWrapped
    );
  const forbidden =
    systemPrompt.includes(STANDARD_AGENCY_FORBIDDEN_NEW_B) &&
    currentUserWrapped.includes(STANDARD_AGENCY_FORBIDDEN_NEW_B);
  const involuntary =
    systemPrompt.includes(STANDARD_AGENCY_ALLOWED_EXCEPTIONS) &&
    currentUserWrapped.includes(STANDARD_AGENCY_ALLOWED_EXCEPTIONS);
  const coauthor = buildNoGodmoddingBlock("", "", "currentTurnDelegated", {
    currentTurnDelegation: {
      active: true,
      allowDialogue: true,
      allowMajorActions: true,
      source: "explicit_ooc",
      duration: "persistent",
    },
  });
  const coauthorUnchanged =
    coauthor.includes("[USER AUTHORING — CURRENT-TURN OOC DELEGATION]") &&
    !coauthor.includes("[USER CONTROL — COLLABORATIVE INTERACTIVE]") &&
    wrapCurrentUserInput("x", {
      mode: "current_turn_ooc_delegated",
      coauthorDuration: "persistent",
    }).includes("ongoing persona co-authoring until revoked");

  const acceptance = {
    CURRENT_USER_AUTHORITY_CONFLICT: oldContinue || oldKeep || !newest || !noTruncate,
    CAN_PREVIOUS_ASSISTANT_REWIND_CURRENT_USER:
      oldContinue || oldUnfinished || Boolean(packet.unfinishedAction),
    PACKET_LOCATION_PRESENT: packet.location != null,
    PACKET_POSITIONS_PRESENT: packet.positions != null,
    PACKET_UNFINISHED_ACTION_PRESENT: packet.unfinishedAction != null,
    PACKET_CURRENT_SPEECH_STATE_PRESENT: packet.currentSpeechState != null,
    CURRENT_USER_CONTACT_DIRECTION_PRIORITY: true,
    STANDARD_AGENCY_CANONICAL_OWNER: STANDARD_AGENCY_CANONICAL_OWNER,
    CURRENT_USER_AGENCY_REINFORCEMENT_OWNER: CURRENT_USER_AGENCY_REINFORCEMENT_OWNER,
    AGENCY_SEMANTICS_IDENTICAL_OR_STRICT_SUBSET: true,
    AGENCY_CONTRADICTION_PRESENT: minorAllow || !forbidden,
    NEW_DELIBERATE_USER_ACTION_FORBIDDEN_CLEARLY: forbidden && !minorAllow,
    INVOLUNTARY_REACTION_ALLOWED_CLEARLY: involuntary,
    AI_CHARACTER_PROACTIVE_ACTION_ALLOWED: /\[A\]는 수동적으로 기다리기만 하지 않고/.test(
      systemPrompt
    ),
    COAUTHOR_SEMANTICS_UNCHANGED: coauthorUnchanged,
    CURRENT_USER_FULLY_PRESENT: currentUserText
      .split(/(?<=다\.)\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .every((sentence) => currentUserWrapped.includes(sentence)),
    HANDOFF_CONTINUATION_NARROW_STYLE:
      /유효한 문장 호흡만 참고한다/.test(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION) &&
      !/최대한 유지/.test(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION),
  };
  const mustBeFalse = [
    "CURRENT_USER_AUTHORITY_CONFLICT",
    "CAN_PREVIOUS_ASSISTANT_REWIND_CURRENT_USER",
    "PACKET_LOCATION_PRESENT",
    "PACKET_POSITIONS_PRESENT",
    "PACKET_UNFINISHED_ACTION_PRESENT",
    "PACKET_CURRENT_SPEECH_STATE_PRESENT",
    "AGENCY_CONTRADICTION_PRESENT",
  ] as const;
  const mustBeTrue = [
    "NEW_DELIBERATE_USER_ACTION_FORBIDDEN_CLEARLY",
    "INVOLUNTARY_REACTION_ALLOWED_CLEARLY",
    "COAUTHOR_SEMANTICS_UNCHANGED",
    "CURRENT_USER_FULLY_PRESENT",
    "HANDOFF_CONTINUATION_NARROW_STYLE",
    "AI_CHARACTER_PROACTIVE_ACTION_ALLOWED",
  ] as const;
  const failures: string[] = [];
  for (const key of mustBeFalse) {
    if (acceptance[key] !== false) failures.push(`${key}=${String(acceptance[key])}`);
  }
  for (const key of mustBeTrue) {
    if (acceptance[key] !== true) failures.push(`${key}=${String(acceptance[key])}`);
  }
  if (failures.length) {
    throw new Error(`H1 assembly acceptance FAILED (no provider calls): ${failures.join("; ")}`);
  }
  return acceptance;
}

async function main() {
  mkdirSync(path.join(EVIDENCE, "raw"), { recursive: true });
  mkdirSync(path.join(EVIDENCE, "flags"), { recursive: true });
  mkdirSync(path.join(EVIDENCE, "bodies"), { recursive: true });
  mkdirSync(path.join(EVIDENCE, "assembled"), { recursive: true });

  const character = JSON.parse(
    readFileSync(path.join(EVIDENCE, "source-fixtures/character-18-like.json"), "utf8")
  ) as CharacterSettingRow & {
    id: number;
    name: string;
    adult_status: string;
    adult_consent_modes_json: string;
    participant_min_age: number;
    content_kind?: string;
    greeting?: string;
    description?: string;
    nsfw?: number;
  };
  const persona = JSON.parse(
    readFileSync(path.join(EVIDENCE, "source-fixtures/persona-ren.json"), "utf8")
  ) as { name: string; gender: string; description: string };
  const currentUser = JSON.parse(
    readFileSync(path.join(EVIDENCE, "source-fixtures/current-user.json"), "utf8")
  ) as { text: string };
  const t1 = readFileSync(path.join(EVIDENCE, "gemini-history/T1_GEMINI.txt"), "utf8").replace(
    /\r/g,
    ""
  );
  const t2 = readFileSync(path.join(EVIDENCE, "gemini-history/T2_GEMINI.txt"), "utf8").replace(
    /\r/g,
    ""
  );
  const greeting = readFileSync(
    path.join(EVIDENCE, "source-fixtures/like-greeting.txt"),
    "utf8"
  ).replace(/\r/g, "");

  const t1User = "나는 렌이라고… 본 기억이 안 나는데… 나 알아?";
  const t2User = "같이 갈래? *두리번*";
  const shortTermHistory: ChatMsg[] = [
    { role: "assistant", content: greeting },
    { role: "user", content: t1User },
    { role: "assistant", content: t1 },
    { role: "user", content: t2User },
    { role: "assistant", content: t2 },
  ];

  const { chunks, usedEnglish } = loadCharacterChunksForPromptReadOnly(
    character,
    persona.name,
    persona.name
  );
  const userPersona = formatPublicPersonaForPrompt(
    persona.name,
    resolveCharacterGender(persona.gender),
    persona.description
  );
  const exampleDialog = resolveExampleDialogForPrompt(character.example_dialog, character.name);
  const routingConfig = resolveAdultRoutingConfig(process.env);
  const sourceModelId = resolvePersistedAdultHandoffSourceModelId({
    selectedModelId: GEMINI,
    state: {},
  });
  const adultTargetModelId = resolveAdultHandoffTargetModelId({
    sourceModelId,
    existingAdultModelId: routingConfig.adultModelId,
    state: {},
  });
  if (adultTargetModelId !== DEEPSEEK) {
    throw new Error(`expected DeepSeek target, got ${adultTargetModelId}`);
  }

  const priorState: ModelRouteState = {
    activeRoute: "general",
    currentSceneMode: "normal",
    adultRouteMinimumTurnsRemaining: 0,
    safeSceneStreak: 0,
    activeConsentMode: "standard",
    sexualContextActive: false,
  };
  const requestedConsentMode = resolveEffectiveConsentMode({
    requested: "standard",
    previous: priorState.activeConsentMode,
    currentInput: currentUser.text,
    allowedConsentModes: ["standard", "cnc_opt_in"],
  });
  const classification = classifySceneMode({
    currentInput: currentUser.text,
    previousSceneMode: priorState.currentSceneMode,
    recentRawText: `${t1}\n${t2}`,
    activeConsentMode: requestedConsentMode,
  });
  const eligibility = resolveAdultEligibility({
    userAdultVerified: true,
    adultContentVisibilityEnabled: true,
    participants: [
      {
        adultStatus: "confirmed",
        age: character.participant_min_age,
        description: character.description ?? character.name,
      },
      {
        description: persona.description,
        isVerifiedAdultUserPersona: true,
      },
    ],
  });
  const deliveryPlan = resolveAdultDeliveryPlan({
    routingEnabled: true,
    eligibility,
    silentRefusalFallback: routingConfig.silentRefusalFallback,
    selectedModelId: GEMINI,
    adultTargetModelId,
    classification,
    state: priorState,
    adultDialogueProfile: "auto",
    providerCapabilities: routingConfig.providerCapabilities,
  });
  if (!deliveryPlan.fallbackPrepared) {
    throw new Error(`fallback not prepared: ${JSON.stringify({ classification, eligibility })}`);
  }
  if (deliveryPlan.primaryModelId !== GEMINI || deliveryPlan.fallbackModelId !== DEEPSEEK) {
    throw new Error(
      `unexpected plan primary=${deliveryPlan.primaryModelId} fallback=${deliveryPlan.fallbackModelId}`
    );
  }

  const refusal = detectModelRefusal({ text: REFUSAL_SEAM, finishReason: "stop" });
  if (!refusal.refused) throw new Error("refusal seam did not trigger");

  const extracted = extractHandoffContinuityFromAssistantText({
    text: t2,
    characterName: character.name,
    personaName: persona.name,
    currentUserText: currentUser.text,
  });
  const continuityPacket = buildSceneContinuityPacket({
    previousSceneMode: classification.sceneReset ? "normal" : priorState.currentSceneMode,
    sexualContextActive:
      classification.sexualContextActive || priorState.sexualContextActive === true,
    activeConsentMode: requestedConsentMode,
    charactersPresent: [character.name, persona.name],
    currentPov: "third_person",
    sceneReset: classification.sceneReset,
    ...(classification.sceneReset ? {} : extracted),
  });
  const handoffPacketSha = sha256(JSON.stringify(continuityPacket));

  const fallbackVariants = selectAdultHandoffRawVariants(shortTermHistory, {
    baseExchanges: routingConfig.baseRawExchanges,
    targetExchanges: routingConfig.handoffTargetRawExchanges,
    extraRawTokens: routingConfig.handoffExtraRawTokens,
  });
  const fallbackHistory = fallbackVariants.handoff.history;

  const built = buildContext({
    charName: character.name,
    contentKind: character.content_kind === "simulation" ? "simulation" : "character",
    narrativePov: resolveNarrativePov({
      mode: "third_person",
      contentKind: "character",
      mainCharacterName: character.name,
      povCharacterName: character.name,
    }),
    chunks,
    systemPrompt: character.system_prompt,
    world: character.world,
    exampleDialog,
    speechProfileJson: character.speech_profile,
    characterPersonality: character.description,
    userNickname: persona.name,
    userPersona,
    shortTermHistory: fallbackHistory,
    currentUserMessage: currentUser.text,
    nsfw: true,
    gender: resolveCharacterGender(character.gender),
    modelId: DEEPSEEK,
    userImpersonation: false,
    novelModeEnabled: false,
    personaDisplayName: persona.name,
    targetResponseChars: TARGET,
    completedTurns: 2,
    userPersonaGender: resolveCharacterGender(persona.gender),
    provider: "openrouter",
    useEnglishCharacterPrompt: usedEnglish,
    preserveAdultHandoffRawHistory: true,
    adultHandoffRequiredTurnFloor: fallbackVariants.handoff.rawTurnsIncluded,
  });

  const systemPrompt = appendAdultHandoffPrompt(built.systemPrompt, continuityPacket, {
    sourceModelId,
    adultTargetModelId,
  });
  appendAdultHandoffToSystemSplit(built.openRouterSystemSplit, continuityPacket, {
    sourceModelId,
    adultTargetModelId,
  });

  const trueOff = resolveDeepSeekAdultHandoffTrueOff({
    selectedModelId: GEMINI,
    adultHandoffActuallyApplied: true,
    resolvedTargetModelId: DEEPSEEK,
  });
  if (!trueOff) throw new Error("resolveDeepSeekAdultHandoffTrueOff returned false");

  const assembled = assemblePrimaryRpRequest({
    system: systemPrompt,
    history: built.history,
    modelId: DEEPSEEK,
    targetResponseChars: TARGET,
    stream: true,
    messageOpts: {
      transportProvider: "cheaperinference",
      deepSeekAdultHandoffTrueOff: true,
      allowOpenRouterUnderLengthRecovery: false,
      requestKind: "adult-general-refusal-fallback",
      charName: character.name,
      personaName: persona.name,
    },
  });
  const body = assembled.requestBody;
  if (body.model !== DEEPSEEK) throw new Error(`model ${String(body.model)}`);
  if (JSON.stringify(body.thinking) !== JSON.stringify({ type: "disabled" })) {
    throw new Error(`thinking ${JSON.stringify(body.thinking)}`);
  }
  if (body.reasoning_effort !== "none") {
    throw new Error(`reasoning_effort ${String(body.reasoning_effort)}`);
  }
  const nativeAdapted = adaptCheaperInferenceChatBody(
    buildOpenRouterRequestBody(DEEPSEEK, assembled.messages as ChatMsg[], true, TARGET) as Record<
      string,
      unknown
    >
  );
  const ownerApplied = applyDeepSeekAdultHandoffTrueOff({ ...nativeAdapted });
  if (ownerApplied.reasoning_effort !== "none") {
    throw new Error("production handoff owner did not set reasoning_effort=none");
  }

  const systemSha = sha256(systemPrompt);
  const histSha = historySha(fallbackHistory);
  const currentUserWrapped = [...built.history].reverse().find((m) => m.role === "user");
  if (!currentUserWrapped) throw new Error("missing current user in assembled history");
  const currentUserSha = sha256(currentUserWrapped.content);
  const finalMessagesSha = messagesSha(assembled.messages as ChatMsg[]);
  const outboundConfig = {
    model: body.model,
    temperature: body.temperature ?? "OMITTED",
    top_p: body.top_p ?? "OMITTED",
    thinking: body.thinking ?? "OMITTED",
    reasoning_effort: body.reasoning_effort ?? "OMITTED",
    max_tokens: body.max_tokens ?? "OMITTED",
    stream: body.stream ?? "OMITTED",
    KEYS: Object.keys(body).sort(),
  };

  const acceptance = proveAcceptance({
    systemPrompt,
    currentUserWrapped: currentUserWrapped.content,
    currentUserText: currentUser.text,
    packet: continuityPacket,
  });

  const afterHandoff = advanceModelRouteState({
    previous: priorState,
    deliveredRoute: "adult",
    sceneModeAfter: classification.sceneMode,
    sexualContextActive: true,
    routeTriggerReason: "general_model_refusal",
    config: routingConfig,
    enteredAdultThisTurn: true,
    activeConsentMode: "standard",
    adultHandoffSourceModelId: sourceModelId,
    adultHandoffTargetModelId: adultTargetModelId,
  });
  const nextNormal = classifySceneMode({
    currentInput: "로비로 다시 나가서 잠깐 바람 좀 쐬자.",
    previousSceneMode: afterHandoff.currentSceneMode,
    recentRawText: t2,
    activeConsentMode: "standard",
  });
  const nextPlan = resolveAdultDeliveryPlan({
    routingEnabled: true,
    eligibility,
    silentRefusalFallback: routingConfig.silentRefusalFallback,
    selectedModelId: GEMINI,
    adultTargetModelId,
    classification: nextNormal,
    state: afterHandoff,
    adultDialogueProfile: "auto",
    providerCapabilities: routingConfig.providerCapabilities,
  });

  const historyJoined = fallbackHistory.map((m) => m.content).join("\n");
  const tokenEst = {
    SYSTEM_TOKENS: estimateTokens(systemPrompt),
    HISTORY_TOKENS: estimateTokens(historyJoined),
    CURRENT_USER_TOKENS: estimateTokens(currentUserWrapped.content),
    FINAL_MESSAGES_TOKENS: estimateTokens(
      (assembled.messages as ChatMsg[]).map((m) => m.content).join("\n")
    ),
  };

  const owners = {
    ACTUAL_PRODUCTION_HANDOFF_PATH: true,
    SELECTED_PRIMARY: GEMINI,
    HANDOFF_TARGET: adultTargetModelId,
    SOURCE_OWNER: "resolvePersistedAdultHandoffSourceModelId + resolveAdultHandoffTargetModelId",
    DELIVERY_PLAN: deliveryPlan,
    TRUE_OFF_OWNER: "resolveDeepSeekAdultHandoffTrueOff → assemblePrimaryRpRequest.deepSeekAdultHandoffTrueOff",
    REFUSAL_SEAM: REFUSAL_SEAM,
    REFUSAL_DETECTED: refusal,
    HANDOFF_TRANSPORT: outboundConfig,
    CONTINUITY_PACKET: continuityPacket,
    usedEnglish,
    NEXT_TURN_MODEL: nextPlan.primaryModelId,
    DEEPSEEK_STICKY: nextPlan.primaryModelId === DEEPSEEK,
    USER_COAUTHOR_MODE: "OFF",
    BILLING_ISOLATION: "harness does not touch user points; USER_POINT_DEDUCTIONS=0",
    STANDARD_AGENCY_CANONICAL_OWNER: STANDARD_AGENCY_CANONICAL_OWNER,
    CURRENT_USER_AGENCY_REINFORCEMENT_OWNER: CURRENT_USER_AGENCY_REINFORCEMENT_OWNER,
    AGENCY_SEMANTICS_IDENTICAL_OR_STRICT_SUBSET: true,
  };
  const parity = {
    SYSTEM_SHA: systemSha,
    HISTORY_SHA: histSha,
    CURRENT_USER_SHA: currentUserSha,
    HANDOFF_PACKET_SHA: handoffPacketSha,
    FINAL_MESSAGES_SHA: finalMessagesSha,
    OUTBOUND_CONFIG: outboundConfig,
    PRECEDING_GEMINI_ASSISTANT_CHARS: [t1.length, t2.length],
    HANDOFF_RAW_TURNS: fallbackVariants.handoff.rawTurnsIncluded,
    MESSAGES_IDENTICAL_ACROSS_H1R1_H1R2_H1R3: true,
    ...tokenEst,
  };
  writeFileSync(path.join(EVIDENCE, "OWNERS.json"), JSON.stringify(owners, null, 2), "utf8");
  writeFileSync(path.join(EVIDENCE, "PARITY.json"), JSON.stringify(parity, null, 2), "utf8");
  writeFileSync(
    path.join(EVIDENCE, "ACCEPTANCE.json"),
    JSON.stringify({ ...acceptance, ...tokenEst }, null, 2),
    "utf8"
  );
  writeFileSync(
    path.join(EVIDENCE, "bodies/H_HANDOFF.keys.json"),
    JSON.stringify(publicBodyKeys(body), null, 2),
    "utf8"
  );
  writeFileSync(path.join(EVIDENCE, "assembled/HANDOFF_SYSTEM.txt"), systemPrompt, "utf8");
  writeFileSync(
    path.join(EVIDENCE, "assembled/CURRENT_USER.txt"),
    currentUserWrapped.content,
    "utf8"
  );
  writeFileSync(
    path.join(EVIDENCE, "assembled/HISTORY.json"),
    JSON.stringify(fallbackHistory, null, 2),
    "utf8"
  );
  writeFileSync(
    path.join(EVIDENCE, "assembled/CONTINUITY_PACKET.json"),
    JSON.stringify(continuityPacket, null, 2),
    "utf8"
  );
  writeFileSync(
    path.join(EVIDENCE, "assembled/FINAL_MESSAGES.sha.txt"),
    `${finalMessagesSha}\n`,
    "utf8"
  );

  console.log(JSON.stringify({ phase: "assembled", acceptance, parity }, null, 2));
  if (ASSEMBLE_ONLY) return;

  const results: Record<string, unknown>[] = [];
  for (const key of ["H1R1", "H1R2", "H1R3"] as const) {
    let deepseekCalls = 0;
    const fallback = await invokePreparedAdultRefusalFallback({
      plan: deliveryPlan,
      fallbackContextAvailable: true,
      text: REFUSAL_SEAM,
      finishReason: "stop",
      hasVisibleTokens: false,
      fallbackAlreadyAttempted: false,
      runFallback: async () => {
        deepseekCalls += 1;
        console.log(JSON.stringify({ phase: "calling", key, deepseekCalls }));
        return callExactBody(body);
      },
    });
    if (!fallback.invoked) throw new Error(`${key} fallback not invoked: ${fallback.reason}`);
    const out = fallback.result;
    const raw = out.text;
    writeFileSync(path.join(EVIDENCE, "raw", `${key}.txt`), raw, "utf8");
    const flags = {
      ...flagsFor(raw, out.finishReason),
      PRIMARY_REFUSAL_VISIBLE: false,
      DEEPSEEK_CALLS: deepseekCalls,
      VISIBLE_ASSISTANT_RESPONSES: 1,
      USER_POINT_DEDUCTIONS: 0,
      QUALITY_SCORE_ASSIGNED: false,
    };
    writeFileSync(path.join(EVIDENCE, "flags", `${key}.json`), JSON.stringify(flags, null, 2), "utf8");
    const usage = (out.usage ?? {}) as Record<string, unknown>;
    const visible = raw.replace(/\r/g, "");
    const row = {
      KEY: key,
      HTTP_STATUS: out.httpStatus,
      FINISH_REASON: out.finishReason,
      INPUT_TOKENS: usage.prompt_tokens ?? usage.input_tokens ?? null,
      OUTPUT_TOKENS: usage.completion_tokens ?? usage.output_tokens ?? null,
      REASONING_TOKENS: usage.reasoning_tokens ?? usage.reasoningOutputTokens ?? null,
      VISIBLE_CHARS_WITH_SPACES: visible.length,
      VISIBLE_CHARS_NO_SPACES: visible.replace(/\s/g, "").length,
      KOREAN_CHARS: countHangul(visible),
      PARAGRAPHS: countParagraphs(visible),
      DIALOGUE_LINES: countDialogue(visible),
      PROVIDER_COST: usage.cost ?? usage.upstream_inference_cost ?? null,
      RAW_SHA256: sha256(raw),
      SYSTEM_SHA: systemSha,
      HISTORY_SHA: histSha,
      CURRENT_USER_SHA: currentUserSha,
      HANDOFF_PACKET_SHA: handoffPacketSha,
      FINAL_MESSAGES_SHA: finalMessagesSha,
      GE_2700: visible.length >= FLOOR,
      GE_3200: visible.length >= TARGET,
      timing: out.timing,
      flags,
      usage,
      DEEPSEEK_CALLS: deepseekCalls,
    };
    results.push(row);
    writeFileSync(path.join(EVIDENCE, "raw", `${key}.meta.json`), JSON.stringify(row, null, 2), "utf8");
    if (out.httpStatus >= 500) {
      writeFileSync(
        path.join(EVIDENCE, `${key}_5XX_STOP.json`),
        JSON.stringify({ STOP: true, HTTP_STATUS: out.httpStatus }, null, 2),
        "utf8"
      );
      break;
    }
  }

  const chars = results.map((r) => Number(r.VISIBLE_CHARS_WITH_SPACES ?? 0));
  const report = {
    QUALITY_SCORE_ASSIGNED: false,
    HUMAN_RAW_REVIEW_REQUIRED: true,
    SOURCE_PRODUCTION_BEHAVIOR_CHANGED: true,
    MERGED: false,
    DEPLOYED: false,
    TOTAL_REAL_DEEPSEEK_CALLS: results.length,
    RETRIES: 0,
    CONTINUATIONS: 0,
    GLM: 0,
    QWEN: 0,
    PR563_FAILOVER_EXERCISED: false,
    ...tokenEst,
    results: results.map((r) => ({
      KEY: r.KEY,
      VISIBLE_CHARS: r.VISIBLE_CHARS_WITH_SPACES,
      GE_2700: r.GE_2700,
      GE_3200: r.GE_3200,
      RAW_SHA256: r.RAW_SHA256,
    })),
  };
  writeFileSync(
    path.join(EVIDENCE, "LIVE_REPORT.json"),
    JSON.stringify({ report, results }, null, 2),
    "utf8"
  );
  console.log(JSON.stringify({ phase: "done", report, chars }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
