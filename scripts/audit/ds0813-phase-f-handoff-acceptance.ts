/**
 * Evidence-only Phase F: actual Gemini → DeepSeek 0813 adult handoff length acceptance.
 * Not imported by production. Does not change src/.
 *
 * ASSEMBLE_ONLY=1 — freeze assembly/parity/outbound keys, no DeepSeek calls.
 * Otherwise exactly 3 DeepSeek replacement calls (H1/H2/H3).
 * Gemini refusal uses the existing deterministic seam. No live Gemini call.
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
  detectModelRefusal,
  extractHandoffContinuityFromAssistantText,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
  resolveEffectiveConsentMode,
  selectAdultHandoffRawVariants,
  type ModelRouteState,
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

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, "data/ds0813-phase-f-handoff-audit");
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

function extractQuotes(text: string): string[] {
  return [...text.matchAll(/[「“"]([^」”"]+)[」”"]/g)].map((m) => m[1].trim()).filter(Boolean);
}

function normalizeDialogue(s: string): string {
  return s.replace(/[….\s]/g, "");
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

function flagsFor(text: string, userInput: string, finishReason: string | null) {
  const refusal =
    /죄송하지만|요청을 수행할 수 없|I cannot|I'm unable|cannot comply|정책상 거부|cannot fulfill/i.test(
      text
    );
  const meta = /as an ai|language model|system prompt|I am an AI|인공지능으로서|safety policy/i.test(
    text
  );
  const sysLeak =
    /USER_TAIL_LENGTH_OWNER|TARGET_LENGTH|MINIMUM_FLOOR|\[DEEPSEEK LENGTH|SNPV2_DEEPSEEK|NO GODMODDING|CHARACTER KNOWLEDGE BOUNDARY|\[SHORT HISTORY\]|SceneContinuityPacket|adultHandoff|reasoning_effort/.test(
      text
    );
  const inputQuotes = extractQuotes(userInput).map(normalizeDialogue);
  const userAttributed = [
    ...text.matchAll(/렌(?:이|은|가|도|만|에게)?[^「“"\n]{0,24}[「“"]([^」”"]+)[」”"]/g),
    ...text.matchAll(/[「“"]([^」”"]+)[」”"][^.!\n]{0,16}렌/g),
  ].map((m) => normalizeDialogue(m[1]));
  const newUserDialogue = userAttributed.some((q) => q && !inputQuotes.includes(q));
  const userIntentional =
    /렌(?:이|은|가)?\s*(?:손을 뻗|몸을 돌|고개를 끄덕이며 다가|문을 열고|옷을 벗기|키스를 깊게|답했다|물었다|선택했다|결정했다)/.test(
      text
    );
  const sentences = text
    .split(/(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40);
  const seen = new Set<string>();
  let exactDup = false;
  for (const s of sentences) {
    if (seen.has(s)) exactDup = true;
    seen.add(s);
  }
  const foreign = /[\u0400-\u04FF\u3040-\u30FF]/.test(text);
  const truncated =
    finishReason === "length" || /[은는이가을를]\s*$/.test(text.trim()) || /,\s*$/.test(text.trim());
  return {
    REFUSAL_PRESENT: refusal,
    META_POLICY_LEAK: meta,
    SYSTEM_PROMPT_LEAK: sysLeak,
    NEW_USER_DIALOGUE_BEYOND_CURRENT_INPUT: newUserDialogue,
    NEW_USER_INTENTIONAL_ACTION_BEYOND_CURRENT_INPUT: userIntentional,
    USER_MAJOR_CHOICE_AUTHORED: /렌(?:이|은|가)?\s*(?:선택|결정)(?:했다|한다)/.test(text),
    USER_CONSENT_OR_REFUSAL_AUTHORED:
      /렌(?:이|은|가)?\s*(?:동의|거절|승낙|허락|거부)(?:했다|한다)/.test(text),
    EXACT_SENTENCE_DUPLICATION: exactDup,
    NEW_CHARACTER_CANON_INVENTED: "UNCERTAIN",
    NEW_USER_BACKSTORY_INVENTED: "UNCERTAIN",
    FOREIGN_SCRIPT_ARTIFACT: foreign,
    OUTPUT_TRUNCATED: truncated,
    NOTE_INVOLUNTARY_USER_PHYSIOLOGY_NOT_AGENCY:
      "automatic involuntary physiological reactions are allowed",
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
  const t1 = readFileSync(path.join(EVIDENCE, "gemini-history/T1_GEMINI.txt"), "utf8").replace(/\r/g, "");
  const t2 = readFileSync(path.join(EVIDENCE, "gemini-history/T2_GEMINI.txt"), "utf8").replace(/\r/g, "");
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
  const systemSplit = appendAdultHandoffToSystemSplit(
    built.openRouterSystemSplit,
    continuityPacket,
    { sourceModelId, adultTargetModelId }
  );

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
    MESSAGES_IDENTICAL_ACROSS_H1_H2_H3: true,
  };
  writeFileSync(path.join(EVIDENCE, "OWNERS.json"), JSON.stringify(owners, null, 2), "utf8");
  writeFileSync(path.join(EVIDENCE, "PARITY.json"), JSON.stringify(parity, null, 2), "utf8");
  writeFileSync(
    path.join(EVIDENCE, "bodies/H_HANDOFF.keys.json"),
    JSON.stringify(publicBodyKeys(body), null, 2),
    "utf8"
  );
  writeFileSync(
    path.join(EVIDENCE, "assembled/HANDOFF_SYSTEM.txt"),
    systemPrompt,
    "utf8"
  );
  writeFileSync(
    path.join(EVIDENCE, "assembled/CURRENT_USER.txt"),
    currentUserWrapped.content,
    "utf8"
  );
  writeFileSync(
    path.join(EVIDENCE, "assembled/CONTINUITY_PACKET.json"),
    JSON.stringify(continuityPacket, null, 2),
    "utf8"
  );
  writeFileSync(
    path.join(EVIDENCE, "NEXT_TURN.json"),
    JSON.stringify(
      {
        NEXT_TURN_MODEL: nextPlan.primaryModelId,
        DEEPSEEK_STICKY: nextPlan.primaryModelId === DEEPSEEK,
        nextPlan,
        afterHandoffActiveRoute: afterHandoff.activeRoute,
        nextClassification: nextNormal.sceneMode,
        NOTE: "Deterministic routing only. No provider call.",
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({ phase: "assembled", owners, parity }, null, 2));
  if (ASSEMBLE_ONLY) return;

  const results: Record<string, unknown>[] = [];
  for (const key of ["H1", "H2", "H3"] as const) {
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
      ...flagsFor(raw, currentUser.text, out.finishReason),
      PRIMARY_REFUSAL_VISIBLE: false,
      DEEPSEEK_CALLS: deepseekCalls,
      VISIBLE_ASSISTANT_RESPONSES: 1,
      USER_POINT_DEDUCTIONS: 0,
      TRANSPORT_SAMPLE_CONTAMINATED:
        out.timing.REASONING_STREAM_EVENTS > 0 || out.timing.REASONING_TEXT_CHARS > 0,
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
  const ge2700 = chars.filter((n) => n >= FLOOR).length;
  const report = {
    T_NATIVE_REFERENCE_ONLY_NOT_RECAPTURED: 1625,
    MIN_CHARS: Math.min(...chars),
    AVG_CHARS: Math.round(chars.reduce((a, b) => a + b, 0) / chars.length),
    MAX_CHARS: Math.max(...chars),
    COUNT_GE_2700: ge2700,
    COUNT_GE_3200: chars.filter((n) => n >= TARGET).length,
    HANDOFF_LENGTH_FLOOR_STABLE: chars.length === 3 && ge2700 === 3,
    PRIMARY_REFUSAL_VISIBLE: false,
    DEEPSEEK_CALLS_PER_LOGICAL_TURN: 1,
    VISIBLE_ASSISTANT_RESPONSES_PER_TURN: 1,
    BILLING_DEDUCTIONS_PER_TURN: 0,
    BILLING_ISOLATION: true,
    NEXT_TURN_MODEL: nextPlan.primaryModelId,
    DEEPSEEK_STICKY: nextPlan.primaryModelId === DEEPSEEK,
    TOTAL_REAL_DEEPSEEK_CALLS: results.length,
    RETRIES: 0,
    CONTINUATIONS: 0,
    QUALITY_SCORE_ASSIGNED: false,
    HUMAN_RAW_REVIEW_REQUIRED: true,
    SOURCE_PRODUCTION_BEHAVIOR_CHANGED: false,
  };
  writeFileSync(
    path.join(EVIDENCE, "LENGTH_REPORT.json"),
    JSON.stringify({ report, results }, null, 2),
    "utf8"
  );
  console.log(JSON.stringify({ phase: "done", report, chars }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
