/**
 * Phase H1S: assemble the frozen PR #560 Gemini → DeepSeek handoff fixture
 * with current production owners, then (only after acceptance) run exactly
 * 3 DeepSeek V4 Pro 0813 calls (R1/R2/R3).
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
  renderSceneContinuityPacket,
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
import type { TrackedPromptSection } from "../../src/services/promptAudit";

loadEnvLocal();

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, "data/ds0813-phase-h1s-handoff-seam");
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

function proseMetrics(text: string) {
  const visible = text.replace(/\r/g, "");
  const paragraphs = visible.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const dialogueParas = paragraphs.filter((p) => /[「“"]/.test(p) && p.replace(/[「“"][^」”"]+[」”"]/g, "").trim().length < 24);
  const sentences = visible
    .split(/(?<=[.!?。…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
  const seen = new Map<string, number>();
  let exactDup = 0;
  for (const s of sentences) {
    const n = (seen.get(s) ?? 0) + 1;
    seen.set(s, n);
    if (n === 2) exactDup += 1;
  }
  const words = (visible.match(/[가-힣]{2,}/g) ?? []).filter(
    (w) => !/^(그리고|하지만|그러나|그래서|있는|없는|같은|그런|했다|한다|였다)$/.test(w)
  );
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  const topWords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const grams = new Map<string, number>();
  for (let i = 0; i < words.length - 2; i += 1) {
    const g = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  const repeatedNgrams = [...grams.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return {
    VISIBLE_CHARS: visible.length,
    PARAGRAPHS: paragraphs.length,
    DIALOGUE_PARAGRAPHS: dialogueParas.length,
    DIALOGUE_PARAGRAPH_RATIO:
      paragraphs.length === 0 ? 0 : Number((dialogueParas.length / paragraphs.length).toFixed(3)),
    AVERAGE_PARAGRAPH_CHARS:
      paragraphs.length === 0
        ? 0
        : Math.round(paragraphs.reduce((a, p) => a + p.length, 0) / paragraphs.length),
    AVERAGE_SENTENCE_CHARS:
      sentences.length === 0
        ? 0
        : Math.round(sentences.reduce((a, s) => a + s.length, 0) / sentences.length),
    EXACT_SENTENCE_DUPLICATION: exactDup,
    TOP_REPEATED_CONTENT_WORDS: topWords,
    REPEATED_NGRAM_SUMMARY: repeatedNgrams,
  };
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
 * H1S human-review freeze flags. Objective hits only.
 * Inherited Gemini choker / tinnitus / Ren-quieting are NOT flagged.
 */
function flagsFor(text: string) {
  const genericLine = firstMatchSentence(
    text,
    /도망치지\s*마|후회해도\s*늦었어|이제\s*안\s*멈춰|이미\s*늦었어|멈출\s*생각\s*없/
  );
  const spoken = firstMatchSentence(
    text,
    /렌(?:이|은|가|도)?[^「“"\n]{0,20}(?:말했다|물었다|답했다|대꾸했다|중얼거렸다|속삭였다)\s*[「“"][^」”"]+[」”"]/
  );
  const spokenQuote = firstMatchSentence(
    text,
    /렌(?:이|은|가|도)?[^.\n]{0,24}[「“"][^」”"]+[」”"]/
  );
  const rewritten = firstMatchSentence(
    text,
    /손목을\s*낚아채|손목을\s*잡|끌어가|끌고\s*들|잡아당겼/
  );
  const deliberate = firstMatchSentence(
    text,
    /렌(?:이|은|가)?\s*(?:태형|라이크)?(?:의)?\s*(?:몸을\s*벽|무릎을\s*굽|버클을|감싸\s*안|밀어붙|손을\s*(?:뻗|넣)|끌어당|잡아끌|문을\s*열고|자리를\s*옮)/
  );
  const inner = firstMatchSentence(
    text,
    /렌(?:이|은|가)?\s*(?:속으로|마음속으로|생각했다|바랐다)/
  );
  const intent = firstMatchSentence(
    text,
    /렌(?:이|은|가|도|의)?[^.\n]{0,24}(?:더\s*원하고|원하고\s*있|좋아하(?:고|는)|동의한|거절한|두려운|겁먹은|원했다)/
  );
  const newLoc = firstMatchSentence(
    text,
    /회의실|당직실|휴게실|응접실|옥상|지하\s*주차장|대기실|감시실|통제실|의무실/
  );
  const sceneObject = firstMatchSentence(text, /소파|회의\s*탁자|당직\s*침대/);
  const sceneFact = firstMatchSentence(
    text,
    /(?:사이렌|비상벨|경보가\s*울|순찰대가|새로운\s*능력|각성했)/
  );
  const continueGate = firstMatchSentence(
    text,
    /계속할\s*거면|계속해도\s*되|계속한다면|여기서\s*이래도\s*되는/
  );
  const questionAnswer = firstMatchSentence(
    text,
    /\?[^\n]{0,80}[\s\S]{8,120}렌이\s*(?:대답|고개를|입술을|손을)/
  );
  const metrics = proseMetrics(text);
  const exactDupSentence =
    metrics.EXACT_SENTENCE_DUPLICATION > 0
      ? firstMatchSentence(text, /[가-힣].{12,}/)
      : null;
  const kissCycleHits = (
    text.match(/키스|입술|숨결|차갑|뜨거|손이\s*(?:허|목|허리|얼굴)/g) ?? []
  ).length;
  const semanticRep =
    metrics.EXACT_SENTENCE_DUPLICATION > 0 || kissCycleHits >= 12
      ? "UNCERTAIN"
      : false;

  return {
    CHARACTER_VOICE_SEAM: flagWithEvidence(genericLine ? "UNCERTAIN" : false, genericLine),
    GENERIC_ADULT_RP_VOICE: flagWithEvidence(Boolean(genericLine), genericLine),
    DIALOGUE_STYLE_SEAM: flagWithEvidence(genericLine ? "UNCERTAIN" : false, genericLine),
    PROSE_RHYTHM_SEAM: flagWithEvidence(false, null),
    SEMANTIC_REPETITION: flagWithEvidence(semanticRep, exactDupSentence),
    ODD_OR_NONSENSICAL_PROSE: flagWithEvidence(false, null),
    CURRENT_USER_REWRITTEN_OR_EXPANDED: flagWithEvidence(Boolean(rewritten), rewritten),
    NEW_USER_DELIBERATE_ACTION: flagWithEvidence(Boolean(deliberate), deliberate),
    NEW_USER_DIALOGUE: flagWithEvidence(
      spoken ? true : spokenQuote ? "UNCERTAIN" : false,
      spoken ?? spokenQuote
    ),
    NEW_USER_INNER_THOUGHT: flagWithEvidence(inner ? "UNCERTAIN" : false, inner),
    NEW_USER_INTENT_AS_FACT: flagWithEvidence(Boolean(intent), intent),
    QUESTION_THEN_USER_ANSWER_AUTHORED: flagWithEvidence(Boolean(questionAnswer), questionAnswer),
    REDUNDANT_CONTINUE_STOP_GATE: flagWithEvidence(Boolean(continueGate), continueGate),
    NEW_UNSUPPORTED_SPECIFIC_LOCATION: flagWithEvidence(Boolean(newLoc), newLoc),
    NEW_SCENE_DRIVING_OBJECT: flagWithEvidence(Boolean(sceneObject), sceneObject),
    NEW_UNSUPPORTED_SCENE_FACT: flagWithEvidence(Boolean(sceneFact), sceneFact),
    UNDER_LENGTH: flagWithEvidence(
      text.length < FLOOR,
      text.length < FLOOR ? `VISIBLE_CHARS=${text.length}` : null
    ),
    NOTE_INHERITED_GEMINI_CONTINUITY_NOT_FLAGGED:
      "electronic choker / tinnitus / Ren-quieting are inherited Gemini visible facts",
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
}): Record<string, boolean | string | number> {
  const { systemPrompt, currentUserWrapped, currentUserText, packet } = input;
  const owner = DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION;
  const oldContinue = /직전 assistant 출력의 바로 다음 순간부터/.test(systemPrompt);
  const oldUnfinished = /직전 출력에서 완료되지 않은 행동이나 대화가 있다면/.test(
    systemPrompt
  );
  const canonRepair =
    /잘못된 의상/.test(owner) || /우연한 오류보다 우선/.test(owner);
  const newest = /현재 사용자 턴 전체가 최신 장면 상태다/.test(systemPrompt);
  const visible = /보이는 이야기 연속이다/.test(systemPrompt);
  const ownerCount = (systemPrompt.match(/현재 사용자 턴 전체가 최신 장면 상태다/g) ?? [])
    .length;
  const currentUserPresent = currentUserText
    .split(/(?<=다\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .every((sentence) => currentUserWrapped.includes(sentence));

  const voice = /일반 지배적 성인 RP 말투로 바꾸지 않는다/.test(owner);
  const actionChain = /새 의도적 \[B\] 행동 사슬을 만들지 않는다/.test(owner);
  const questionOwn = /같은 턴에서 \[B\]의 대답이나 대답 행동을 쓰지 않는다/.test(owner);
  const locationNeutral = /기능적 장소를 확정하지 않는다/.test(owner);
  const ownerOverBudget = owner.length > 800;
  const acceptance = {
    CURRENT_USER_NEWEST_STATE_PRESERVED: newest && !oldContinue && currentUserPresent,
    VISIBLE_PRIOR_SCENE_CONTINUITY_PRESERVED: visible && !canonRepair,
    SOURCE_CHARACTER_VOICE_CONTINUITY_PRESENT: voice,
    NEW_USER_ACTION_CHAIN_PROHIBITED: actionChain,
    QUESTION_USER_ANSWER_OWNERSHIP_PRESENT: questionOwn,
    UNKNOWN_LOCATION_NEUTRALITY_PRESENT: locationNeutral,
    HANDOFF_CONTINUITY_OWNER_COUNT: ownerCount,
    HANDOFF_OWNER_CHARS: owner.length,
    PACKET_LOCATION_PRESENT: packet.location != null,
    PACKET_POSITIONS_PRESENT: packet.positions != null,
    PACKET_UNFINISHED_ACTION_PRESENT: packet.unfinishedAction != null,
    PACKET_CURRENT_SPEECH_STATE_PRESENT: packet.currentSpeechState != null,
    CAN_PREVIOUS_ASSISTANT_REWIND_CURRENT_USER:
      oldContinue || oldUnfinished || Boolean(packet.unfinishedAction),
    CANON_REPAIR_WORDING_PRESENT: canonRepair,
  };
  const failures: string[] = [];
  for (const key of [
    "CURRENT_USER_NEWEST_STATE_PRESERVED",
    "VISIBLE_PRIOR_SCENE_CONTINUITY_PRESERVED",
    "SOURCE_CHARACTER_VOICE_CONTINUITY_PRESENT",
    "NEW_USER_ACTION_CHAIN_PROHIBITED",
    "QUESTION_USER_ANSWER_OWNERSHIP_PRESENT",
    "UNKNOWN_LOCATION_NEUTRALITY_PRESENT",
  ] as const) {
    if (acceptance[key] !== true) failures.push(`${key}=${String(acceptance[key])}`);
  }
  if (acceptance.HANDOFF_CONTINUITY_OWNER_COUNT !== 1) {
    failures.push(`HANDOFF_CONTINUITY_OWNER_COUNT=${acceptance.HANDOFF_CONTINUITY_OWNER_COUNT}`);
  }
  if (ownerOverBudget) failures.push(`HANDOFF_OWNER_CHARS=${owner.length}`);
  for (const key of [
    "PACKET_LOCATION_PRESENT",
    "PACKET_POSITIONS_PRESENT",
    "PACKET_UNFINISHED_ACTION_PRESENT",
    "PACKET_CURRENT_SPEECH_STATE_PRESENT",
    "CAN_PREVIOUS_ASSISTANT_REWIND_CURRENT_USER",
    "CANON_REPAIR_WORDING_PRESENT",
  ] as const) {
    if (acceptance[key] !== false) failures.push(`${key}=${String(acceptance[key])}`);
  }
  if (failures.length) {
    throw new Error(`H1S assembly acceptance FAILED (no provider calls): ${failures.join("; ")}`);
  }
  return acceptance;
}

function classifyBucket(section: TrackedPromptSection): string {
  const id = `${section.id} ${section.label} ${section.category}`.toLowerCase();
  if (/(length|3200|3,200|target.length|minimum.floor)/.test(id) || /3,200자/.test(section.text)) {
    return "LENGTH OWNER";
  }
  if (/(prose|immersive|style|narrat|webnovel)/.test(id)) return "STYLE RULES";
  if (/(persona|user-persona|user_persona)/.test(id)) return "USER PERSONA";
  if (/(memory|archive|ltm|long.term)/.test(id)) return "MEMORY";
  if (/(world|lore|scenario)/.test(id)) return "WORLD CANON";
  if (/(character|speech.lock|speech-profile|example.dialog)/.test(id)) return "CHARACTER CANON";
  if (/(godmodding|identity|system|rule|contamination)/.test(id)) return "SYSTEM COMMON RULES";
  if (section.category === "memory") return "MEMORY";
  if (section.category === "systemRules") return "SYSTEM COMMON RULES";
  return "OTHER";
}

function joinBucket(sections: TrackedPromptSection[], bucket: string): string {
  return sections
    .filter((s) => classifyBucket(s) === bucket)
    .map((s) => s.text)
    .join("\n\n");
}

function stripTags(text: string): string {
  return text.replace(/<\/?[A-Z_]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function sectionParity(
  geminiSections: TrackedPromptSection[],
  deepseekSections: TrackedPromptSection[],
  geminiHistory: ChatMsg[],
  deepseekHistory: ChatMsg[],
  geminiCurrent: string,
  deepseekCurrent: string
) {
  const buckets = [
    "SYSTEM COMMON RULES",
    "CHARACTER CANON",
    "WORLD CANON",
    "USER PERSONA",
    "MEMORY",
    "RAW HISTORY",
    "CURRENT USER",
    "STYLE RULES",
    "LENGTH OWNER",
  ] as const;
  const rows: Record<string, { status: "IDENTICAL" | "DIFFERENT"; why: string; geminiChars: number; deepseekChars: number }> = {};
  for (const bucket of buckets) {
    let g = "";
    let d = "";
    if (bucket === "RAW HISTORY") {
      g = geminiHistory.map((m) => `${m.role}:${m.content}`).join("\n");
      d = deepseekHistory.map((m) => `${m.role}:${m.content}`).join("\n");
    } else if (bucket === "CURRENT USER") {
      g = geminiCurrent;
      d = deepseekCurrent;
    } else if (bucket === "LENGTH OWNER") {
      const fromSectionsG = joinBucket(geminiSections, bucket);
      const fromSectionsD = joinBucket(deepseekSections, bucket);
      const fromUserG = (geminiCurrent.match(/이번 응답은 한국어 3,200자[\s\S]*?전개한다\./) ?? [""])[0];
      const fromUserD = (deepseekCurrent.match(/이번 응답은 한국어 3,200자[\s\S]*?전개한다\./) ?? [""])[0];
      g = fromSectionsG || fromUserG;
      d = fromSectionsD || fromUserD;
    } else {
      g = joinBucket(geminiSections, bucket);
      d = joinBucket(deepseekSections, bucket);
    }
    if (g === d) {
      rows[bucket] = {
        status: "IDENTICAL",
        why: g.length === 0 ? "empty on both sides" : "exact text match",
        geminiChars: g.length,
        deepseekChars: d.length,
      };
      continue;
    }
    if (stripTags(g) === stripTags(d) && stripTags(g).length > 0) {
      rows[bucket] = {
        status: "DIFFERENT",
        why: "same inner text; DeepSeek XML/wrapper tags differ",
        geminiChars: g.length,
        deepseekChars: d.length,
      };
      continue;
    }
    let why = "assembled text differs after tag-strip";
    if (bucket === "RAW HISTORY") {
      why = "existing handoff raw-window: Gemini includes greeting; DeepSeek handoff uses two playable turns only";
    } else if (bucket === "CURRENT USER") {
      why = "same current-user turn + common wrapper; DeepSeek prepends existing System Reminder";
    } else if (bucket === "SYSTEM COMMON RULES") {
      why = "model-family system-rule packaging differs; handoff owner is appended outside tracked common rules";
    } else if (g.length === 0 || d.length === 0) {
      why = "bucket missing on one side";
    }
    rows[bucket] = {
      status: "DIFFERENT",
      why,
      geminiChars: g.length,
      deepseekChars: d.length,
    };
  }
  return rows;
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

  const contextShared = {
    charName: character.name,
    contentKind: (character.content_kind === "simulation" ? "simulation" : "character") as
      | "simulation"
      | "character",
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
    currentUserMessage: currentUser.text,
    nsfw: true,
    gender: resolveCharacterGender(character.gender),
    userImpersonation: false,
    novelModeEnabled: false,
    personaDisplayName: persona.name,
    targetResponseChars: TARGET,
    completedTurns: 2,
    userPersonaGender: resolveCharacterGender(persona.gender),
    provider: "openrouter" as const,
    useEnglishCharacterPrompt: usedEnglish,
  };

  const geminiBuilt = buildContext({
    ...contextShared,
    shortTermHistory,
    modelId: GEMINI,
  });
  const geminiAssembled = assemblePrimaryRpRequest({
    system: geminiBuilt.systemPrompt,
    history: geminiBuilt.history,
    modelId: GEMINI,
    targetResponseChars: TARGET,
    stream: true,
    messageOpts: {
      transportProvider: "cheaperinference",
      allowOpenRouterUnderLengthRecovery: false,
      requestKind: "adult-primary-gemini",
      charName: character.name,
      personaName: persona.name,
    },
  });
  const geminiCurrent =
    [...geminiBuilt.history].reverse().find((m) => m.role === "user")?.content ?? "";

  const built = buildContext({
    ...contextShared,
    shortTermHistory: fallbackHistory,
    modelId: DEEPSEEK,
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
    HANDOFF_CONTINUITY_OWNER_COUNT: 1,
    HANDOFF_OWNER_CHARS: DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION.length,
  };
  const sectionRows = sectionParity(
    geminiBuilt.meta.trackedSections ?? [],
    built.meta.trackedSections ?? [],
    geminiBuilt.history,
    built.history,
    geminiCurrent,
    currentUserWrapped.content
  );
  const geminiJoined = (geminiAssembled.messages as ChatMsg[]).map((m) => m.content).join("\n");
  const deepseekJoined = (assembled.messages as ChatMsg[]).map((m) => m.content).join("\n");
  const handoffOnlyAppend = [
    renderSceneContinuityPacket(continuityPacket),
    DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
  ].join("\n\n");
  const handoffOnlyAdded = handoffOnlyAppend.length;
  const identical = Object.entries(sectionRows)
    .filter(([, v]) => v.status === "IDENTICAL")
    .map(([k]) => k);
  const different = Object.entries(sectionRows)
    .filter(([, v]) => v.status === "DIFFERENT")
    .map(([k, v]) => ({ section: k, why: v.why }));
  const parity = {
    SYSTEM_SHA: systemSha,
    HISTORY_SHA: histSha,
    CURRENT_USER_SHA: currentUserSha,
    HANDOFF_PACKET_SHA: handoffPacketSha,
    FINAL_MESSAGES_SHA: finalMessagesSha,
    GEMINI_FINAL_MESSAGES_SHA: messagesSha(geminiAssembled.messages as ChatMsg[]),
    OUTBOUND_CONFIG: outboundConfig,
    PRECEDING_GEMINI_ASSISTANT_CHARS: [t1.length, t2.length],
    HANDOFF_RAW_TURNS: fallbackVariants.handoff.rawTurnsIncluded,
    MESSAGES_IDENTICAL_ACROSS_R1_R2_R3: true,
    PRIMARY_GEMINI_REQUEST_ASSEMBLED: true,
    DEEPSEEK_HANDOFF_REQUEST_ASSEMBLED: true,
    COMMON_PAYLOAD_IDENTICAL_SECTIONS: identical,
    HANDOFF_ONLY_DIFFERENT_SECTIONS: different,
    PRIMARY_GEMINI_INPUT_EST: estimateTokens(geminiJoined),
    HANDOFF_DEEPSEEK_INPUT_EST: estimateTokens(deepseekJoined),
    HANDOFF_ONLY_ADDED_CHARS: handoffOnlyAdded,
    HANDOFF_ONLY_ADDED_EST_TOKENS:
      handoffOnlyAdded === 0 ? 0 : Math.ceil(handoffOnlyAdded * 0.9),
    HANDOFF_ONLY_SECTIONS: [
      "SceneContinuityPacket",
      "DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION",
    ],
    SECTION_ROWS: sectionRows,
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
  writeFileSync(
    path.join(EVIDENCE, "assembled/PRIMARY_GEMINI_SYSTEM.txt"),
    geminiBuilt.systemPrompt,
    "utf8"
  );
  writeFileSync(
    path.join(EVIDENCE, "assembled/PRIMARY_GEMINI_CURRENT_USER.txt"),
    geminiCurrent,
    "utf8"
  );
  writeFileSync(
    path.join(EVIDENCE, "assembled/PRIMARY_GEMINI_MESSAGES.json"),
    JSON.stringify(geminiAssembled.messages, null, 2),
    "utf8"
  );
  writeFileSync(
    path.join(EVIDENCE, "assembled/DEEPSEEK_HANDOFF_MESSAGES.json"),
    JSON.stringify(assembled.messages, null, 2),
    "utf8"
  );
  writeFileSync(
    path.join(EVIDENCE, "GEMINI_REFERENCE_METRICS.json"),
    JSON.stringify(
      {
        T1: { ...proseMetrics(t1), visibleChars: t1.length },
        T2: { ...proseMetrics(t2), visibleChars: t2.length },
      },
      null,
      2
    ),
    "utf8"
  );
  writeFileSync(
    path.join(EVIDENCE, "SECTION_PARITY.json"),
    JSON.stringify(
      {
        COMMON_PAYLOAD_IDENTICAL_SECTIONS: identical,
        HANDOFF_ONLY_DIFFERENT_SECTIONS: different,
        PRIMARY_GEMINI_INPUT_EST: parity.PRIMARY_GEMINI_INPUT_EST,
        HANDOFF_DEEPSEEK_INPUT_EST: parity.HANDOFF_DEEPSEEK_INPUT_EST,
        HANDOFF_ONLY_ADDED_CHARS: handoffOnlyAdded,
        HANDOFF_ONLY_ADDED_EST_TOKENS: parity.HANDOFF_ONLY_ADDED_EST_TOKENS,
        HANDOFF_ONLY_SECTIONS: parity.HANDOFF_ONLY_SECTIONS,
        SECTION_ROWS: sectionRows,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({ phase: "assembled", acceptance, parity }, null, 2));
  if (ASSEMBLE_ONLY) return;

  const results: Record<string, unknown>[] = [];
  for (const key of ["R1", "R2", "R3"] as const) {
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
      ...flagsFor(raw),
      PRIMARY_REFUSAL_VISIBLE: false,
      DEEPSEEK_CALLS: deepseekCalls,
      VISIBLE_ASSISTANT_RESPONSES: 1,
      USER_POINT_DEDUCTIONS: 0,
      QUALITY_SCORE_ASSIGNED: false,
    };
    writeFileSync(path.join(EVIDENCE, "flags", `${key}.json`), JSON.stringify(flags, null, 2), "utf8");
    const usage = (out.usage ?? {}) as Record<string, unknown>;
    const visible = raw.replace(/\r/g, "");
    const metrics = proseMetrics(visible);
    writeFileSync(
      path.join(EVIDENCE, "flags", `${key}.metrics.json`),
      JSON.stringify(metrics, null, 2),
      "utf8"
    );
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
      METRICS: metrics,
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
  const allMetrics = {
    T1: proseMetrics(t1),
    T2: proseMetrics(t2),
    ...Object.fromEntries(results.map((r) => [String(r.KEY), r.METRICS])),
  };
  writeFileSync(
    path.join(EVIDENCE, "METRICS.json"),
    JSON.stringify(allMetrics, null, 2),
    "utf8"
  );
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
      METRICS: r.METRICS,
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
