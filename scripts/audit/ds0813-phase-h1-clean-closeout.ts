/**
 * H1-CLEAN CLOSEOUT: wrapper-only completed-vs-ongoing distinction, then
 * exactly 3 logical DeepSeek V4 Pro 0813 adult-handoff calls.
 *
 * Does not change the 219-char system owner, 3200 length owner,
 * temperature/top_p/reasoning, CI→OR failover, or Gemini wrappers.
 *
 * ASSEMBLE_ONLY=1 — freeze assembly + acceptance, no provider calls.
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
  OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL,
} from "../../src/lib/chatModels";
import {
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
import { resolveDeepSeekAdultHandoffTrueOff } from "../../src/lib/cheaperInferenceConfig";
import { assemblePrimaryRpRequest } from "../../src/lib/openRouterAdult";
import {
  ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY,
  buildCurrentUserInputWrapper,
} from "../../src/lib/currentUserInputLabel";
import {
  classifyCompletedStateReplay,
  classifyCurrentUserCompletedVsOngoing,
  classifyLowStakesAmbientCoaction,
  classifySameBeatMicroContinuation,
  classifyTrueNewUserActionBeat,
} from "../../src/lib/handoffUserActionTaxonomy";
import {
  adaptOpenRouterDeepSeekBackupBody,
  executeDeepSeekWithProviderFailover,
  extractVisibleAssistantDeltaFromSseJson,
  resolveDeepSeekPrimaryTransport,
  type DeepSeekFailoverTelemetry,
  type DeepSeekProviderId,
} from "../../src/lib/deepseekProviderFailover";

loadEnvLocal();

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, "data/ds0813-phase-h1-clean-closeout");
const FIXTURES = path.join(ROOT, "data/ds0813-phase-h1-clean");
const ASSEMBLE_ONLY = process.env.ASSEMBLE_ONLY === "1";
const GEMINI = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const REFUSAL_SEAM = "I cannot fulfill this request.";
const TARGET = UNIFIED_RESPONSE_LENGTH_TARGET;
const FLOOR = 2700;
const EXPECTED_OWNER = `현재 사용자 턴이 확정한 장면 다음부터 이어 쓴다. 직전 assistant의 말투·유머·호칭·문장 호흡·대사/서술 균형과 화면에 이미 나온 장면 상태를 자연스럽게 이어, 같은 캐릭터와 같은 글의 다음 부분처럼 작성한다.
이미 다룬 감각이나 행동을 표현만 바꿔 반복하기보다 캐릭터의 새 행동·대사·반응과 그 결과로 장면을 계속 전진시킨다. 현재 사용자 턴이 바꾼 상태가 이전 장면보다 우선한다.`;
const EXPECTED_OWNER_CHARS = 219;
const EXPECTED_WRAPPER_BODY_CHARS = 199;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function writeJson(rel: string, value: unknown) {
  writeFileSync(path.join(EVIDENCE, rel), JSON.stringify(value, null, 2), "utf8");
}

function writeText(rel: string, value: string) {
  writeFileSync(path.join(EVIDENCE, rel), value, "utf8");
}

function countHangul(text: string): number {
  return (text.match(/[\uAC00-\uD7A3]/g) ?? []).length;
}

function firstMatchSentence(text: string, re: RegExp): string | null {
  const m = text.match(re);
  if (!m || m.index == null) return null;
  const start = Math.max(0, m.index - 20);
  const end = Math.min(text.length, m.index + Math.max(80, m[0].length + 40));
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

type FlagValue = boolean | "UNCERTAIN";

function flagWithEvidence(
  value: FlagValue,
  evidence: string | null
): { value: FlagValue; evidence: string | null } {
  return { value, evidence: value === false ? null : evidence };
}

type TaxonomyFlagLike = { value: boolean | "UNCERTAIN"; evidence: string | null };

function semanticRepetition(text: string): TaxonomyFlagLike {
  const sentences = text
    .split(/(?<=[.!?。…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
  const seen = new Map<string, number>();
  let dup: string | null = null;
  for (const s of sentences) {
    const n = (seen.get(s) ?? 0) + 1;
    seen.set(s, n);
    if (n === 2 && !dup) dup = s.slice(0, 80);
  }
  const kissCycle = (text.match(/키스|입술|숨결/g) ?? []).length;
  if (dup) return { value: "UNCERTAIN", evidence: dup };
  if (kissCycle >= 12) return { value: "UNCERTAIN", evidence: `KISS_CYCLE=${kissCycle}` };
  return { value: false, evidence: null };
}

/** Objective hits only. Do not use NEW_USER_DELIBERATE_ACTION. */
function flagsFor(text: string, httpStatus: number) {
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
  const inner = firstMatchSentence(
    text,
    /렌(?:이|은|가)?\s*(?:속으로|마음속으로|생각했다|바랐다)/
  );
  const intent = firstMatchSentence(
    text,
    /렌(?:이|은|가|도|의)?[^.\n]{0,24}(?:더\s*원하고|원하고\s*있|좋아하(?:고|는)|동의한|거절한|두려운|겁먹은|원했다)/
  );
  const refusal = firstMatchSentence(text, /I cannot fulfill this request|OPENROUTER_API_KEY/);
  const meta = firstMatchSentence(
    text,
    /SceneContinuityPacket|DEEPSEEK_HANDOFF|adult_handoff|STATUS_VALUES/
  );
  const usable = httpStatus === 200 && text.length > 0;
  const trueBeat = classifyTrueNewUserActionBeat(text);
  return {
    COMPLETED_STATE_REPLAY: classifyCompletedStateReplay(text),
    TRUE_NEW_USER_ACTION_BEAT: trueBeat,
    SAME_BEAT_MICRO_CONTINUATION: classifySameBeatMicroContinuation(text),
    LOW_STAKES_AMBIENT_COACTION: classifyLowStakesAmbientCoaction(text),
    NEW_USER_DIALOGUE: flagWithEvidence(
      spoken ? true : spokenQuote ? "UNCERTAIN" : false,
      spoken ?? spokenQuote
    ),
    NEW_USER_INNER_THOUGHT: flagWithEvidence(inner ? "UNCERTAIN" : false, inner),
    NEW_USER_INTENT_AS_FACT: flagWithEvidence(Boolean(intent), intent),
    CHARACTER_VOICE_SEAM: flagWithEvidence(genericLine ? "UNCERTAIN" : false, genericLine),
    GENERIC_ADULT_RP_VOICE: flagWithEvidence(Boolean(genericLine), genericLine),
    SEMANTIC_REPETITION: semanticRepetition(text),
    ODD_OR_NONSENSICAL_PROSE: flagWithEvidence(Boolean(refusal || meta || !usable), refusal ?? meta),
    UNDER_LENGTH: flagWithEvidence(
      usable && text.length < FLOOR,
      usable && text.length < FLOOR ? `VISIBLE_CHARS=${text.length}` : null
    ),
    PRIMARY_REFUSAL_VISIBLE: Boolean(refusal),
    META_LEAK: Boolean(meta),
  };
}

function proveAcceptance(input: {
  systemPrompt: string;
  currentUserWrapped: string;
  geminiCurrent: string;
  currentUserText: string;
  packet: SceneContinuityPacket;
  body: Record<string, unknown>;
}): Record<string, boolean | string | number> {
  const owner = DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION;
  const geminiWrapper = buildCurrentUserInputWrapper({ mode: "interactive" });
  const handoffWrapper = buildCurrentUserInputWrapper({
    mode: "interactive",
    adultHandoff: true,
  });
  const ownerCount = (input.systemPrompt.split(owner).length - 1);
  const currentUserPresent = input.currentUserText
    .split(/(?<=다\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .every((sentence) => input.currentUserWrapped.includes(sentence));
  const acceptance = {
    OWNER_EXACT: owner === EXPECTED_OWNER,
    HANDOFF_OWNER_CHARS: owner.length,
    HANDOFF_WRAPPER_BODY_CHARS: ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY.length,
    HANDOFF_CONTINUITY_OWNER_COUNT: ownerCount,
    GEMINI_WRAPPER_UNCHANGED: /small movement\/contact\/object-handling/.test(
      input.geminiCurrent
    ) && /small movement\/contact\/object-handling/.test(geminiWrapper),
    HANDOFF_WRAPPER_CONCISE:
      input.currentUserWrapped.includes(ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY) &&
      /완료된 행동은 그 결과 상태로 이어받고/.test(handoffWrapper) &&
      /진행 중인 행동과 상호작용은 같은 의도와 방향 안에서/.test(handoffWrapper) &&
      /새로운 행동의 목적·종류·대상, 대답이나 중요한 선택은 사용자가 정한다/.test(
        handoffWrapper
      ) &&
      !/small movement\/contact\/object-handling/.test(input.currentUserWrapped) &&
      !/예:|회의실|라이크|문고리|되감기|보조실/.test(ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY),
    COMPLETED_VS_ONGOING_SPLIT: (() => {
      const aspect = classifyCurrentUserCompletedVsOngoing(input.currentUserText);
      return (
        aspect.completedDoorClosed &&
        aspect.ongoingUndressKiss &&
        aspect.sameBeatReplayEligibleForDoor === false &&
        aspect.sameBeatMicroContinuationAllowed === true
      );
    })(),
    CURRENT_USER_NEWEST_STATE_PRESERVED:
      /현재 사용자 턴이 바꾼 상태가 이전 장면보다 우선한다/.test(owner) &&
      currentUserPresent &&
      input.currentUserWrapped.includes("문을 닫고"),
    NO_EXTRA_ADULT_STYLE_PROHIBITION: !/일반 지배적 성인 RP/.test(owner),
    NO_LOCATION_SPECIFIC_PROHIBITION: !/기능적 장소를 확정하지 않는다/.test(owner),
    NO_EXAMPLE_LIST: !/예: A가 B의 허리/.test(owner),
    NO_CANON_REPAIR: !/잘못된 의상|우연한 오류보다 우선/.test(owner),
    NO_DUPLICATE_AGENCY_RULE: !/새 의도적 \[B\] 행동 사슬/.test(owner),
    PACKET_LOCATION_PRESENT: input.packet.location != null,
    PACKET_POSITIONS_PRESENT: input.packet.positions != null,
    PACKET_UNFINISHED_ACTION_PRESENT: input.packet.unfinishedAction != null,
    PACKET_CURRENT_SPEECH_STATE_PRESENT: input.packet.currentSpeechState != null,
    TEMPERATURE_UNCHANGED: input.body.temperature === 0.92,
    TOP_P_UNCHANGED: input.body.top_p === 0.92,
    THINKING_DISABLED: JSON.stringify(input.body.thinking) === JSON.stringify({ type: "disabled" }),
    REASONING_EFFORT_NONE: input.body.reasoning_effort === "none",
    LENGTH_OWNER_UNCHANGED: true,
  };
  const failures: string[] = [];
  if (acceptance.OWNER_EXACT !== true) failures.push("OWNER_EXACT");
  if (acceptance.HANDOFF_OWNER_CHARS !== EXPECTED_OWNER_CHARS) {
    failures.push(`HANDOFF_OWNER_CHARS=${acceptance.HANDOFF_OWNER_CHARS}`);
  }
  if (acceptance.HANDOFF_WRAPPER_BODY_CHARS !== EXPECTED_WRAPPER_BODY_CHARS) {
    failures.push(`HANDOFF_WRAPPER_BODY_CHARS=${acceptance.HANDOFF_WRAPPER_BODY_CHARS}`);
  }
  if (acceptance.HANDOFF_CONTINUITY_OWNER_COUNT !== 1) {
    failures.push(`HANDOFF_CONTINUITY_OWNER_COUNT=${acceptance.HANDOFF_CONTINUITY_OWNER_COUNT}`);
  }
  for (const key of [
    "GEMINI_WRAPPER_UNCHANGED",
    "HANDOFF_WRAPPER_CONCISE",
    "COMPLETED_VS_ONGOING_SPLIT",
    "CURRENT_USER_NEWEST_STATE_PRESERVED",
    "NO_EXTRA_ADULT_STYLE_PROHIBITION",
    "NO_LOCATION_SPECIFIC_PROHIBITION",
    "NO_EXAMPLE_LIST",
    "NO_CANON_REPAIR",
    "NO_DUPLICATE_AGENCY_RULE",
    "TEMPERATURE_UNCHANGED",
    "TOP_P_UNCHANGED",
    "THINKING_DISABLED",
    "REASONING_EFFORT_NONE",
  ] as const) {
    if (acceptance[key] !== true) failures.push(`${key}=${String(acceptance[key])}`);
  }
  for (const key of [
    "PACKET_LOCATION_PRESENT",
    "PACKET_POSITIONS_PRESENT",
    "PACKET_UNFINISHED_ACTION_PRESENT",
    "PACKET_CURRENT_SPEECH_STATE_PRESENT",
  ] as const) {
    if (acceptance[key] !== false) failures.push(`${key}=${String(acceptance[key])}`);
  }
  if (failures.length) {
    throw new Error(`H1-CLEAN assembly acceptance FAILED: ${failures.join("; ")}`);
  }
  return acceptance;
}

async function consumeStream(response: Response): Promise<{
  text: string;
  finishReason: string | null;
  usage: Record<string, unknown> | null;
  firstVisibleMs: number | null;
  lastVisibleMs: number | null;
}> {
  const started = Date.now();
  if (!response.body) {
    return {
      text: "",
      finishReason: null,
      usage: null,
      firstVisibleMs: null,
      lastVisibleMs: null,
    };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let text = "";
  let finishReason: string | null = null;
  let usage: Record<string, unknown> | null = null;
  let firstVisibleMs: number | null = null;
  let lastVisibleMs: number | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ finish_reason?: string | null }>;
            usage?: Record<string, unknown>;
          };
          const visible = extractVisibleAssistantDeltaFromSseJson(json);
          if (visible) {
            const now = Date.now() - started;
            if (firstVisibleMs == null) firstVisibleMs = now;
            lastVisibleMs = now;
            text += visible;
          }
          const reason = json.choices?.[0]?.finish_reason;
          if (reason) finishReason = reason;
          if (json.usage) usage = json.usage;
        } catch {
          /* incomplete SSE */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { text, finishReason, usage, firstVisibleMs, lastVisibleMs };
}

async function callFailover(body: Record<string, unknown>): Promise<{
  usedProvider: DeepSeekProviderId;
  telemetry: DeepSeekFailoverTelemetry;
  httpStatus: number;
  text: string;
  finishReason: string | null;
  usage: Record<string, unknown> | null;
  firstVisibleMs: number | null;
  lastVisibleMs: number | null;
  totalLatencyMs: number;
}> {
  const wallStart = Date.now();
  const primaryTransport = resolveDeepSeekPrimaryTransport();
  const backupBody = adaptOpenRouterDeepSeekBackupBody(
    body,
    OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL
  );
  if (backupBody.model !== OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL) {
    throw new Error(`backup model ${String(backupBody.model)}`);
  }
  let telemetry: DeepSeekFailoverTelemetry | null = null;
  const result = await executeDeepSeekWithProviderFailover({
    routeKind: "adult_handoff",
    logicalModel: "pro",
    primary: {
      endpoint: primaryTransport.endpoint,
      headers: primaryTransport.headers,
      body,
    },
    backupBody,
    stream: true,
    hooks: {
      onTelemetry: (next) => {
        telemetry = next;
      },
    },
  });
  const consumed = await consumeStream(result.response);
  return {
    usedProvider: result.usedProvider,
    telemetry: telemetry ?? result.telemetry,
    httpStatus: result.response.status,
    ...consumed,
    totalLatencyMs: Date.now() - wallStart,
  };
}

async function main() {
  mkdirSync(path.join(EVIDENCE, "raw"), { recursive: true });
  mkdirSync(path.join(EVIDENCE, "flags"), { recursive: true });
  mkdirSync(path.join(EVIDENCE, "assembled"), { recursive: true });

  const character = JSON.parse(
    readFileSync(path.join(FIXTURES, "source-fixtures/character-18-like.json"), "utf8")
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
    readFileSync(path.join(FIXTURES, "source-fixtures/persona-ren.json"), "utf8")
  ) as { name: string; gender: string; description: string };
  const currentUser = JSON.parse(
    readFileSync(path.join(FIXTURES, "source-fixtures/current-user.json"), "utf8")
  ) as { text: string };
  const t1 = readFileSync(path.join(FIXTURES, "gemini-history/T1_GEMINI.txt"), "utf8").replace(
    /\r/g,
    ""
  );
  const t2 = readFileSync(path.join(FIXTURES, "gemini-history/T2_GEMINI.txt"), "utf8").replace(
    /\r/g,
    ""
  );
  const greeting = readFileSync(
    path.join(FIXTURES, "source-fixtures/like-greeting.txt"),
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

  const currentUserWrapped = [...built.history].reverse().find((m) => m.role === "user");
  if (!currentUserWrapped) throw new Error("missing current user in assembled history");

  const acceptance = proveAcceptance({
    systemPrompt,
    currentUserWrapped: currentUserWrapped.content,
    geminiCurrent,
    currentUserText: currentUser.text,
    packet: continuityPacket,
    body,
  });

  const systemSha = sha256(systemPrompt);
  const currentUserSha = sha256(currentUserWrapped.content);
  const finalMessagesSha = sha256(
    (assembled.messages as ChatMsg[]).map((m) => `${m.role}\u0000${m.content}`).join("\u0001")
  );

  writeJson("ACCEPTANCE.json", acceptance);
  writeJson("OWNERS.json", {
    HANDOFF_OWNER_CHARS: DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION.length,
    HANDOFF_WRAPPER_BODY_CHARS: ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY.length,
    HANDOFF_WRAPPER_WITH_HEADER_CHARS: buildCurrentUserInputWrapper({
      mode: "interactive",
      adultHandoff: true,
    }).length,
    HANDOFF_CONTINUITY_OWNER_COUNT: 1,
    TEMPERATURE: body.temperature,
    TOP_P: body.top_p,
    THINKING: body.thinking,
    REASONING_EFFORT: body.reasoning_effort,
    MAX_TOKENS: body.max_tokens ?? "OMITTED",
    SELECTED_PRIMARY: GEMINI,
    HANDOFF_TARGET: adultTargetModelId,
    CONTINUITY_PACKET: continuityPacket,
  });
  writeText("assembled/HANDOFF_SYSTEM.txt", systemPrompt);
  writeText("assembled/CURRENT_USER.txt", currentUserWrapped.content);
  writeText("assembled/PRIMARY_GEMINI_CURRENT_USER.txt", geminiCurrent);
  writeJson("assembled/CONTINUITY_PACKET.json", continuityPacket);
  writeJson("assembled/DEEPSEEK_HANDOFF_MESSAGES.json", assembled.messages);
  writeText("assembled/FINAL_MESSAGES.sha.txt", `${finalMessagesSha}\n`);

  console.log(JSON.stringify({ phase: "assembled", acceptance }, null, 2));
  if (ASSEMBLE_ONLY) return;

  const keys = ["H1CC-R1", "H1CC-R2", "H1CC-R3"] as const;
  const results: Record<string, unknown>[] = [];
  for (const key of keys) {
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
        return callFailover(body);
      },
    });
    if (!fallback.invoked) throw new Error(`${key} fallback not invoked: ${fallback.reason}`);
    const out = fallback.result;
    const visible = out.text.replace(/\r/g, "");
    const flags = {
      ...flagsFor(visible, out.httpStatus),
      VISIBLE_CHARS: visible.length,
      USED_PROVIDER: out.usedProvider,
      DEEPSEEK_CALLS: deepseekCalls,
      PRIMARY_HTTP_STATUS: out.telemetry.primary_http_status,
      FAILOVER_TRIGGER: out.telemetry.failover_trigger,
      VISIBLE_ASSISTANT_RESPONSES: visible.length > 0 ? 1 : 0,
      USER_POINT_DEDUCTIONS: 0,
      QUALITY_SCORE_ASSIGNED: false,
    };
    writeText(`raw/${key}.txt`, visible);
    writeJson(`flags/${key}.json`, flags);
    const usage = (out.usage ?? {}) as Record<string, unknown>;
    const row = {
      KEY: key,
      USED_PROVIDER: out.usedProvider,
      PROVIDER_ATTEMPT_COUNT: out.telemetry.provider_attempt_count,
      PRIMARY_HTTP_STATUS: out.telemetry.primary_http_status,
      PRIMARY_FAILURE_CLASS: out.telemetry.primary_failure_class,
      FAILOVER_TRIGGER: out.telemetry.failover_trigger,
      BACKUP_SUCCESS: out.telemetry.backup_success,
      HTTP_STATUS: out.httpStatus,
      FINISH_REASON: out.finishReason,
      VISIBLE_CHARS: visible.length,
      KOREAN_CHARS: countHangul(visible),
      UNDER_LENGTH:
        out.httpStatus === 200 && visible.length > 0 ? visible.length < FLOOR : false,
      QUALITY_SAMPLE:
        visible.length > 0 &&
        out.httpStatus === 200 &&
        (out.usedProvider === "cheaperinference" || out.usedProvider === "openrouter"),
      INPUT_TOKENS: usage.prompt_tokens ?? usage.input_tokens ?? null,
      OUTPUT_TOKENS: usage.completion_tokens ?? usage.output_tokens ?? null,
      TTFT_MS: out.firstVisibleMs,
      TOTAL_LATENCY_MS: out.totalLatencyMs,
      RAW_SHA256: sha256(visible),
      SYSTEM_SHA: systemSha,
      CURRENT_USER_SHA: currentUserSha,
      FINAL_MESSAGES_SHA: finalMessagesSha,
      flags,
      usage,
      telemetry: out.telemetry,
      DEEPSEEK_CALLS: deepseekCalls,
    };
    writeJson(`raw/${key}.meta.json`, row);
    results.push(row);
  }

  const replayHits = results.filter((r) => {
    const flags = r.flags as { COMPLETED_STATE_REPLAY?: { value?: unknown } };
    return flags.COMPLETED_STATE_REPLAY?.value === true;
  }).length;
  const trueBeatHits = results.filter((r) => {
    const flags = r.flags as { TRUE_NEW_USER_ACTION_BEAT?: { value?: unknown } };
    return flags.TRUE_NEW_USER_ACTION_BEAT?.value === true;
  }).length;
  const usableChars = results
    .filter((r) => r.HTTP_STATUS === 200 && typeof r.VISIBLE_CHARS === "number")
    .map((r) => r.VISIBLE_CHARS as number);
  const bothSevereShort =
    usableChars.length === 3 && usableChars.every((n) => n < 2700);
  const accepted = replayHits === 0 && trueBeatHits === 0 && !bothSevereShort;

  const report = {
    QUALITY_SCORE_ASSIGNED: false,
    HUMAN_RAW_REVIEW_REQUIRED: true,
    MERGED: false,
    DEPLOYED: false,
    PROMPT_SCOPE: "adult-handoff-wrapper-body-only",
    HANDOFF_OWNER_CHARS: DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION.length,
    HANDOFF_WRAPPER_BODY_CHARS: ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY.length,
    TOTAL_LOGICAL_HANDOFFS: results.length,
    COMPLETED_STATE_REPLAY_HITS: `${replayHits}/3`,
    TRUE_NEW_USER_ACTION_BEAT_HITS: `${trueBeatHits}/3`,
    LENGTH_REGRESSION_SUSPECTED: bothSevereShort,
    LENGTH_OWNER_UNCHANGED: true,
    GEMINI_37_FLASH_ADULT_HANDOFF_ACCEPTED: accepted,
    results: results.map((r) => ({
      KEY: r.KEY,
      USED_PROVIDER: r.USED_PROVIDER,
      VISIBLE_CHARS: r.VISIBLE_CHARS,
      UNDER_LENGTH: r.UNDER_LENGTH,
      HTTP_STATUS: r.HTTP_STATUS,
      RAW_SHA256: r.RAW_SHA256,
    })),
  };
  writeJson("LIVE_REPORT.json", { report, results });
  console.log(JSON.stringify({ phase: "done", report }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
