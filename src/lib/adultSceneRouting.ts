import type { ChatMsg } from "@/lib/ai";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  normalizeDeepSeekV4ProModelId,
} from "@/lib/chatModels";
import { appendSourceSpecificQwenAdapter } from "@/lib/adultHandoffSourceRouting";
import {
  classifyChatOocIntent,
  extractOocRoutingText,
  type ChatOocIntent,
} from "@/lib/chatOocPriority";
import { estimateTokens } from "@/lib/tokenEstimate";

export type SceneMode =
  | "normal"
  | "romantic"
  | "tension"
  | "explicit_dialogue"
  | "intimate_transition"
  | "explicit"
  | "aftercare";

export type ActiveModelRoute = "general" | "adult";

export type AdultDialogueProfile =
  | "auto"
  | "none"
  | "suggestive"
  | "explicit_rare"
  | "explicit_frequent";

export type AdultConsentMode = "standard" | "power_play" | "cnc_opt_in";

export type AdultStatus = "unknown" | "confirmed" | "minor" | "conflict";

export interface ModelRouteState {
  activeRoute: ActiveModelRoute;
  currentSceneMode: SceneMode;
  adultRouteMinimumTurnsRemaining: number;
  safeSceneStreak: number;
  routeTriggerReason?: string;
  activeConsentMode: AdultConsentMode;
  sexualContextActive?: boolean;
  generalRouteBridge?: GeneralRouteBridge;
  adultHandoffSourceModelId?: string;
  adultHandoffTargetModelId?: string;
}

export interface GeneralRouteBridge {
  relationshipChange?: string;
  emotionalAftermath?: string;
  promisesOrConflict?: string;
  currentLocation?: string;
  currentTime?: string;
  physicalState?: string;
  clothingState?: string;
  injuryState?: string;
  importantItems?: string[];
  nextSceneRelevantFacts?: string[];
}

export interface SceneContinuityPacket {
  location?: string;
  time?: string;
  charactersPresent?: string[];
  currentPov?: string;
  positions?: string;
  unfinishedAction?: string;
  emotionalBalance?: string;
  currentSpeechState?: string;
  relationshipChange?: string;
  /** Actor who performed the last contact/action (must not invert on handoff). */
  previousActionActor?: string;
  /** Target of the last contact/action (must not invert on handoff). */
  previousActionTarget?: string;
  /** Contact direction summary, e.g. "A → B waist wrap". */
  contactDirection?: string;
  previousSceneMode: SceneMode;
  sexualContextActive?: boolean;
  activeConsentMode?: AdultConsentMode;
  /** True when OOC starts a new episode; previous physical continuity must not carry. */
  sceneReset?: boolean;
}

export interface ParticipantAdultMetadata {
  age?: number | null;
  isAdult?: boolean | number | null;
  ageGroup?: string | null;
  adultStatus?: string | null;
  currentSchool?: string | null;
  description?: string | null;
  isRealPerson?: boolean;
  /** Selected persona owned by the already adult-verified account. */
  isVerifiedAdultUserPersona?: boolean;
}

export type AdultEligibilityBlockReason =
  | "user_not_verified"
  | "adult_visibility_off"
  | "character_adult_disabled"
  | "participant_minor"
  | "participant_conflict"
  | "participant_unknown"
  | "real_person"
  /** @deprecated never emitted — coercion / non-consent is not a block reason */
  | "actual_nonconsent";

export interface AdultEligibilityResult {
  eligible: boolean;
  allowedByAdultContentPolicy: boolean;
  blockReason?: AdultEligibilityBlockReason;
}

export interface RefusalResult {
  refused: boolean;
  reason:
    | "provider_refusal"
    | "safety_block"
    | "empty_safety_response"
    | "content_filter"
    | "unknown";
}

export interface AdultRoutingConfig {
  enabled: boolean;
  adultModelId: string;
  providerOrder: string[];
  providerOnly: string[];
  allowProviderFallbacks: boolean;
  requireParameters: boolean;
  quantizations: string[];
  /** Always-preserved latest complete user+assistant exchanges. */
  baseRawExchanges: number;
  /** Base plus nearest older complete exchanges, capped by this target. */
  handoffTargetRawExchanges: number;
  /** Token budget for exchanges added before the base; never trims the base. */
  handoffExtraRawTokens: number;
  /** @deprecated compatibility alias for handoffTargetRawExchanges. */
  handoffRawTurns: number;
  /** @deprecated compatibility alias; now means additional RAW token budget. */
  handoffMaxTokens: number;
  minimumRouteTurns: number;
  returnSafeTurns: number;
  silentRefusalFallback: boolean;
  initialStreamBufferChars: number;
  providerCapabilities: Record<string, SceneMode>;
}

export interface AdultProviderRoutingRequest {
  order?: string[];
  only?: string[];
  allow_fallbacks: boolean;
  require_parameters: boolean;
  quantizations?: string[];
}

export const DEFAULT_MODEL_ROUTE_STATE: ModelRouteState = {
  activeRoute: "general",
  currentSceneMode: "normal",
  adultRouteMinimumTurnsRemaining: 0,
  safeSceneStreak: 0,
  activeConsentMode: "standard",
  sexualContextActive: false,
};

const DEFAULT_PROVIDER_CAPABILITIES: Record<string, SceneMode> = {
  anthropic: "tension",
  google: "tension",
  openai: "tension",
  deepseek: "explicit",
};

const SCENE_RANK: Record<SceneMode, number> = {
  normal: 0,
  romantic: 1,
  tension: 2,
  aftercare: 3,
  intimate_transition: 4,
  explicit_dialogue: 5,
  explicit: 6,
};

const EXPLICIT_SCENE_MODES = new Set<SceneMode>([
  "explicit_dialogue",
  "intimate_transition",
  "explicit",
]);

const ADULT_SIGNAL =
  /(?:\b(?:19|2[0-9]|[3-9][0-9])\s*(?:세|살)(?!\d)|성인(?:\s*(?:남성|여성))?|adult|대학생|직장인|현역\s*군인)/i;
const REAL_PERSON_SIGNAL =
  /(?:실존\s*인물|실제\s*연예인|actual\s+person|real\s+person|celebrity)/i;

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || !value.trim()) return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function envInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function envList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseProviderCapabilities(value: string | undefined): Record<string, SceneMode> {
  if (!value?.trim()) return { ...DEFAULT_PROVIDER_CAPABILITIES };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const result = { ...DEFAULT_PROVIDER_CAPABILITIES };
    for (const [key, mode] of Object.entries(parsed)) {
      if (isSceneMode(mode)) result[key.toLowerCase()] = mode;
    }
    return result;
  } catch {
    return { ...DEFAULT_PROVIDER_CAPABILITIES };
  }
}

export function resolveAdultRoutingConfig(
  env: NodeJS.ProcessEnv = process.env
): AdultRoutingConfig {
  const baseRawExchanges = envInt(
    env.ADULT_SCENE_BASE_RAW_EXCHANGES,
    4,
    2,
    8
  );
  const handoffTargetRawExchanges = Math.max(
    baseRawExchanges,
    envInt(
      env.ADULT_SCENE_HANDOFF_TARGET_RAW_EXCHANGES ??
        env.ADULT_SCENE_HANDOFF_RAW_TURNS,
      6,
      baseRawExchanges,
      12
    )
  );
  // Legacy MAX_TOKENS is accepted as the extra-history budget. It no longer
  // has authority to trim the always-preserved base RAW exchanges.
  const handoffExtraRawTokens = envInt(
    env.ADULT_SCENE_HANDOFF_EXTRA_RAW_TOKENS ??
      env.ADULT_SCENE_HANDOFF_MAX_TOKENS,
    4_000,
    0,
    20_000
  );
  return {
    enabled: envBool(env.ADULT_SCENE_ROUTING_ENABLED, true),
    adultModelId: normalizeDeepSeekV4ProModelId(
      env.ADULT_MODEL_ID?.trim() || CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    ),
    providerOrder: envList(env.ADULT_MODEL_PROVIDER_ORDER),
    providerOnly: envList(env.ADULT_MODEL_PROVIDER_ONLY),
    allowProviderFallbacks: envBool(
      env.ADULT_MODEL_ALLOW_PROVIDER_FALLBACKS,
      false
    ),
    requireParameters: envBool(env.ADULT_MODEL_REQUIRE_PARAMETERS, true),
    quantizations: envList(env.ADULT_MODEL_QUANTIZATIONS),
    baseRawExchanges,
    handoffTargetRawExchanges,
    handoffExtraRawTokens,
    handoffRawTurns: handoffTargetRawExchanges,
    handoffMaxTokens: handoffExtraRawTokens,
    minimumRouteTurns: envInt(
      env.ADULT_SCENE_MINIMUM_ROUTE_TURNS,
      3,
      1,
      12
    ),
    returnSafeTurns: envInt(env.ADULT_SCENE_RETURN_SAFE_TURNS, 2, 1, 8),
    silentRefusalFallback: envBool(
      env.ADULT_SCENE_SILENT_REFUSAL_FALLBACK,
      true
    ),
    initialStreamBufferChars: envInt(
      env.ADULT_SCENE_INITIAL_STREAM_BUFFER_CHARS,
      400,
      0,
      2_000
    ),
    providerCapabilities: parseProviderCapabilities(
      env.ADULT_SCENE_PROVIDER_CAPABILITIES_JSON
    ),
  };
}

export function buildAdultProviderRoutingRequest(
  config: AdultRoutingConfig
): AdultProviderRoutingRequest {
  return {
    ...(config.providerOrder.length ? { order: config.providerOrder } : {}),
    ...(config.providerOnly.length ? { only: config.providerOnly } : {}),
    allow_fallbacks: config.allowProviderFallbacks,
    require_parameters: config.requireParameters,
    ...(config.quantizations.length
      ? { quantizations: config.quantizations }
      : {}),
  };
}

export function isSceneMode(value: unknown): value is SceneMode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SCENE_RANK, value)
  );
}

export function parseModelRouteState(value: unknown): ModelRouteState {
  let parsed: Record<string, unknown> = {};
  try {
    parsed =
      typeof value === "string"
        ? (JSON.parse(value || "{}") as Record<string, unknown>)
        : value && typeof value === "object"
          ? (value as Record<string, unknown>)
          : {};
  } catch {
    parsed = {};
  }
  const activeRoute = parsed.activeModelRoute ?? parsed.activeRoute;
  const sceneMode = parsed.currentSceneMode;
  const consentMode = parsed.activeConsentMode;
  return {
    activeRoute: activeRoute === "adult" ? "adult" : "general",
    currentSceneMode: isSceneMode(sceneMode) ? sceneMode : "normal",
    adultRouteMinimumTurnsRemaining: Math.max(
      0,
      Number(parsed.adultRouteMinimumTurnsRemaining) || 0
    ),
    safeSceneStreak: Math.max(0, Number(parsed.safeSceneStreak) || 0),
    routeTriggerReason:
      typeof parsed.routeTriggerReason === "string"
        ? parsed.routeTriggerReason
        : undefined,
    activeConsentMode: isAdultConsentMode(consentMode)
      ? consentMode
      : "standard",
    sexualContextActive: parsed.sexualContextActive === true,
    generalRouteBridge:
      parsed.generalRouteBridge &&
      typeof parsed.generalRouteBridge === "object"
        ? sanitizeGeneralRouteBridge(
            parsed.generalRouteBridge as GeneralRouteBridge
          )
        : undefined,
    adultHandoffSourceModelId:
      typeof parsed.adultHandoffSourceModelId === "string" &&
      parsed.adultHandoffSourceModelId.trim()
        ? parsed.adultHandoffSourceModelId.trim()
        : undefined,
    adultHandoffTargetModelId:
      typeof parsed.adultHandoffTargetModelId === "string" &&
      parsed.adultHandoffTargetModelId.trim()
        ? parsed.adultHandoffTargetModelId.trim()
        : undefined,
  };
}

export function serializeModelRouteState(state: ModelRouteState): string {
  return JSON.stringify({
    activeModelRoute: state.activeRoute,
    currentSceneMode: state.currentSceneMode,
    adultRouteMinimumTurnsRemaining: Math.max(
      0,
      Math.trunc(state.adultRouteMinimumTurnsRemaining)
    ),
    safeSceneStreak: Math.max(0, Math.trunc(state.safeSceneStreak)),
    ...(state.routeTriggerReason
      ? { routeTriggerReason: state.routeTriggerReason }
      : {}),
    activeConsentMode: state.activeConsentMode,
    sexualContextActive: state.sexualContextActive === true,
    ...(state.generalRouteBridge
      ? { generalRouteBridge: sanitizeGeneralRouteBridge(state.generalRouteBridge) }
      : {}),
    ...(state.adultHandoffSourceModelId
      ? { adultHandoffSourceModelId: state.adultHandoffSourceModelId }
      : {}),
    ...(state.adultHandoffTargetModelId
      ? { adultHandoffTargetModelId: state.adultHandoffTargetModelId }
      : {}),
  });
}

export function isAdultConsentMode(value: unknown): value is AdultConsentMode {
  return (
    value === "standard" || value === "power_play" || value === "cnc_opt_in"
  );
}

export function normalizeAdultDialogueProfile(
  value: unknown
): AdultDialogueProfile {
  return value === "none" ||
    value === "suggestive" ||
    value === "explicit_rare" ||
    value === "explicit_frequent"
    ? value
    : "auto";
}

export function inferAdultStatusFromLegacyText(text: string): AdultStatus {
  const normalized = text.trim();
  if (!normalized) return "unknown";
  const minor =
    hasCurrentMinorKeyword(normalized) || findCurrentNumericMinorAge(normalized);
  const adult = ADULT_SIGNAL.test(normalized);
  if (minor && adult) return "conflict";
  if (minor) return "minor";
  if (adult) return "confirmed";
  return "unknown";
}

/** Age/school mention refers to the past, not the participant's current status. */
const HISTORICAL_AGE_AFTER =
  /^\s*(?:(?:이(?:었|던|였)(?:을|던)?|였(?:을|던)?)(?:\s*(?:때|무렵|적|시절|당시|에(?:서|선)?|경|부터|이전(?:까지)?|전(?:까지|에)?))?(?=\s|$|[,.])|(?:때|무렵|적|시절|당시|에(?:서|선)?|경|당시|부터|was|when|ago|back\s+when|in\s+(?:the\s+)?past|at\s+that\s+time|years?\s+ago|이전(?:까지)?|전(?:까지|에)?)(?=\s|$|[,.]))/i;

const HISTORICAL_AGE_BEFORE =
  /(?:과거|어릴|어린|childhood|past|former|예전|\*\*과거\*\*)(?:\s*[:：])?\s*$/i;

const CURRENT_AGE_BEFORE =
  /(?:현재|지금|now|currently)\s*$/i;

const MINOR_KEYWORD_PATTERN = /(?:미성년자|미성년)/g;

const SCHOOL_ROLE_PATTERN =
  /(?:중학생|고등학생|초등학생|middle\s*school|high\s*school)/gi;

export function buildCharacterParticipantIdentityDescription(input: {
  adultStatus?: string | null;
  description?: string | null;
  systemPrompt?: string | null;
  world?: string | null;
  simulationCast?: string | null;
}): string {
  return [input.adultStatus, input.description].filter(Boolean).join("\n");
}

function isHistoricalAgeMention(
  text: string,
  matchIndex: number,
  matchLength: number
): boolean {
  const after = text.slice(matchIndex + matchLength, matchIndex + matchLength + 32);
  if (HISTORICAL_AGE_AFTER.test(after)) return true;
  const before = text.slice(Math.max(0, matchIndex - 24), matchIndex);
  if (HISTORICAL_AGE_BEFORE.test(before)) return true;
  return false;
}

function isCurrentAgeMention(
  text: string,
  matchIndex: number,
  matchLength: number
): boolean {
  const before = text.slice(Math.max(0, matchIndex - 12), matchIndex);
  if (CURRENT_AGE_BEFORE.test(before)) return true;
  const after = text.slice(matchIndex + matchLength, matchIndex + matchLength + 16);
  if (/^\s*(?:이다|입니다|임|캐릭터|설정)(?=\s|$|[,.])/i.test(after)) return true;
  return false;
}

function findCurrentNumericMinorAge(text: string): boolean {
  for (const match of text.matchAll(/나이\s*[:：]\s*(\d{1,2})\s*(?:세|살)(?!\d)/gi)) {
    const age = Number(match[1]);
    if (age > 0 && age < 19) return true;
  }

  for (const match of text.matchAll(/(?<![0-9])(\d{1,2})\s*(?:세|살)(?!\d)/g)) {
    const age = Number(match[1]);
    if (age <= 0 || age >= 19) continue;
    const idx = match.index ?? 0;
    const len = match[0].length;
    if (isCurrentAgeMention(text, idx, len)) return true;
    if (isHistoricalAgeMention(text, idx, len)) continue;
    const after = text.slice(idx + len, idx + len + 24);
    if (/^\s*(?:고등학생|중학생|초등학생|미성년)/i.test(after)) return true;
    if (!HISTORICAL_AGE_AFTER.test(after)) return true;
  }
  return false;
}

function hasCurrentMinorKeyword(text: string): boolean {
  for (const match of text.matchAll(MINOR_KEYWORD_PATTERN)) {
    const idx = match.index ?? 0;
    const len = match[0].length;
    if (isCurrentAgeMention(text, idx, len)) return true;
    if (isHistoricalAgeMention(text, idx, len)) continue;
    return true;
  }

  if (/\b(?:minor|underage)\b/i.test(text)) {
    for (const match of text.matchAll(/\b(?:minor|underage)\b/gi)) {
      const idx = match.index ?? 0;
      const len = match[0].length;
      if (isHistoricalAgeMention(text, idx, len)) continue;
      return true;
    }
  }

  for (const match of text.matchAll(SCHOOL_ROLE_PATTERN)) {
    const idx = match.index ?? 0;
    const len = match[0].length;
    if (isCurrentAgeMention(text, idx, len)) return true;
    if (isHistoricalAgeMention(text, idx, len)) continue;
    return true;
  }

  for (const match of text.matchAll(/(?:어린이|어린아이)/g)) {
    const idx = match.index ?? 0;
    const len = match[0].length;
    const before = text.slice(Math.max(0, idx - 12), idx);
    const after = text.slice(idx + len, idx + len + 16);
    if (/어린\s*$/i.test(before)) continue;
    if (/(?:시절|적|때)\s*$/i.test(before)) continue;
    if (/^\s*(?:였|이었|였던|구조|를|을|의|가\s)/i.test(after)) continue;
    if (/^\s*구조/i.test(after)) continue;
    if (isHistoricalAgeMention(text, idx, len)) continue;
    return true;
  }

  if (/\bchild\b/i.test(text)) {
    for (const match of text.matchAll(/\bchild\b/gi)) {
      const idx = match.index ?? 0;
      const len = match[0].length;
      const after = text.slice(idx + len, idx + len + 16);
      if (/^\s*(?:ren|hood|ren's)\b/i.test(after)) continue;
      if (isHistoricalAgeMention(text, idx, len)) continue;
      return true;
    }
  }

  return false;
}

export function assessParticipantAdultStatus(
  participant: ParticipantAdultMetadata
): AdultStatus | "real_person" {
  const identityDescription = [
    participant.description,
    participant.currentSchool,
    participant.ageGroup,
  ]
    .filter(Boolean)
    .join("\n");
  const structuredAdultStatus = participant.adultStatus?.trim() ?? "";
  const structuredAgeGroup = participant.ageGroup?.trim() ?? "";

  if (participant.isRealPerson || REAL_PERSON_SIGNAL.test(identityDescription)) {
    return "real_person";
  }

  const numericAge =
    typeof participant.age === "number" && Number.isFinite(participant.age)
      ? participant.age
      : null;

  // Structured authoring age outranks free-text lore inference (Patch 3).
  if (numericAge != null) {
    if (numericAge < 19) return "minor";
    return "confirmed";
  }

  const textMinor =
    hasCurrentMinorKeyword(identityDescription) ||
    findCurrentNumericMinorAge(identityDescription);
  const textAdult = ADULT_SIGNAL.test(identityDescription);

  if (/^(minor|underage|child)$/i.test(structuredAdultStatus)) {
    if (textAdult) return "conflict";
    return "minor";
  }
  if (/^(confirmed|adult)$/i.test(structuredAdultStatus)) {
    if (textMinor) return "conflict";
    return "confirmed";
  }
  if (structuredAdultStatus === "conflict") return "conflict";

  const structuredMinor =
    /^(minor|underage|child)$/i.test(structuredAgeGroup);
  const structuredAdult =
    participant.isAdult === true ||
    participant.isAdult === 1 ||
    /^(adult)$/i.test(structuredAgeGroup);

  const explicitMinor = structuredMinor || textMinor;
  const explicitAdult = structuredAdult || textAdult;

  if (explicitMinor && explicitAdult) return "conflict";
  if (explicitMinor) return "minor";
  if (explicitAdult) return "confirmed";
  if (participant.isVerifiedAdultUserPersona) return "confirmed";
  return "unknown";
}

/**
 * Central adult / adult-handoff eligibility.
 *
 * Operational handoff gate = chat-room 「성인모드」
 * (`chats.adult_handoff_enabled` / `adultContentVisibilityEnabled`).
 * Home/header 「성인 캐릭터 표시」 (`users.nsfw_on`) only controls listing
 * visibility and must not be passed here.
 *
 * `SKIP_ADULT_VERIFICATION` may make `userAdultVerified` effective-true;
 * chat-room adult mode OFF must still disable adult model handoff.
 *
 * Coercion / non-consent is not an eligibility block. Minors and real
 * people remain blocked.
 */
export function resolveAdultEligibility(input: {
  userAdultVerified: boolean;
  /**
   * Chat-room 「성인모드」 / adult model handoff on/off.
   * Omit/undefined treated as ON only for legacy unit fixtures;
   * production chat must pass the real chat-room preference.
   */
  adultContentVisibilityEnabled?: boolean;
  characterAdultContentEnabled: boolean;
  participants: ParticipantAdultMetadata[];
  /** Ignored. Coercion / non-consent is not an eligibility block. */
  actualNonConsent?: boolean;
}): AdultEligibilityResult {
  if (!input.userAdultVerified) {
    return {
      eligible: false,
      allowedByAdultContentPolicy: false,
      blockReason: "user_not_verified",
    };
  }
  // Chat-room adult mode OFF disables handoff only.
  // Do not hard-block the turn (allowedByAdultContentPolicy stays true) so
  // the user keeps their selected general RP model instead of a 400.
  if (input.adultContentVisibilityEnabled === false) {
    return {
      eligible: false,
      allowedByAdultContentPolicy: true,
      blockReason: "adult_visibility_off",
    };
  }
  if (!input.characterAdultContentEnabled) {
    return {
      eligible: false,
      allowedByAdultContentPolicy: false,
      blockReason: "character_adult_disabled",
    };
  }
  for (const participant of input.participants) {
    const status = assessParticipantAdultStatus(participant);
    if (status === "real_person") {
      return {
        eligible: false,
        allowedByAdultContentPolicy: false,
        blockReason: "real_person",
      };
    }
    if (status === "minor") {
      return {
        eligible: false,
        allowedByAdultContentPolicy: false,
        blockReason: "participant_minor",
      };
    }
    if (status === "conflict") {
      return {
        eligible: false,
        allowedByAdultContentPolicy: false,
        blockReason: "participant_conflict",
      };
    }
    if (status !== "confirmed") {
      return {
        eligible: false,
        allowedByAdultContentPolicy: false,
        blockReason: "participant_unknown",
      };
    }
  }
  return { eligible: true, allowedByAdultContentPolicy: true };
}

const EXPLICIT_RP_STOP =
  /(?:괄호\s*밖|롤플레(?:이|잉)\s*(?:중단|종료)|장면\s*(?:중단|종료)|그만\s*하자|여기서\s*멈춰|stop\s+(?:the\s+)?scene|end\s+(?:the\s+)?scene)/i;
const CNC_OPT_IN =
  /(?:(?:OOC|합의|사전\s*동의|안전어|세이프워드).{0,40}(?:CNC|강압\s*역할극|비동의\s*역할극|강간\s*역할극)|(?:CNC|consensual\s+non[- ]?consent).{0,40}(?:동의|opt[- ]?in|safe\s*word))/i;
const MEDICAL_OR_COMBAT =
  /(?:진찰|검사|수술|응급|치료|상처|붕대|소독|출혈|전투|격투|공격|방어|훈련|구조|심폐소생|목욕시키|씻겨|갈아입혀)/i;
const SEXUAL_CONTEXT =
  /(?:키스|입맞춤|유혹|흥분|욕정|애무|침대|속옷|옷을\s*벗|몸을\s*밀착|성적|관계하|밤을\s*보내|더티\s*토크|dirty\s*talk|arous|kiss|seduc|intimat)/i;
const ROMANTIC_CONTEXT =
  /(?:사랑|좋아해|연인|데이트|고백|손을\s*잡|포옹|껴안|설렘|두근|romance|date|confess|hug)/i;
const TENSION_CONTEXT =
  /(?:키스|입맞춤|유혹|숨결|귓가|목덜미|허리.{0,8}(?:감싸|끌어)|벽으로\s*몰|가까이\s*다가|밀착|kiss|seduc)/i;
const INTIMATE_TRANSITION =
  /(?:(?:침실|침대|호텔|방으로).{0,24}(?:가|데려|이동|들어)|옷을\s*(?:벗|내리)|계속해|더\s*해|다음으로\s*넘어|끝까지|명시적(?:인)?\s*장면|성인\s*(?:장면|에피소드)|adult\s+episode|have\s+sex|make\s+love)/i;
const EXPLICIT_ANATOMY =
  /(?:성기|음경|질\b|클리토리스|유두|정액|삽입|penetrat|genital|penis|vagina|clitoris)/i;
const EXPLICIT_ACTION =
  /(?:삽입|박아|핥아|빨아|사정|오르가슴|성교|sex\b|penetrat|ejaculat|orgasm)/i;
const EXPLICIT_DIALOGUE =
  /(?:더티\s*토크|노골적(?:인)?\s*(?:성적\s*)?대사|구체적(?:인)?\s*성적\s*명령|야한\s*말을\s*해|어떻게\s*해\s*달라.{0,16}말해|dirty\s*talk|explicit\s+sexual\s+dialogue)/i;
const AFTERCARE =
  /(?:애프터케어|aftercare|끝난\s*뒤|관계\s*후|숨을\s*고르|담요|물을\s*건네|씻고\s*나서|품에\s*안아\s*달래)/i;
const TIME_OR_PLACE_JUMP =
  /(?:며칠\s*후|몇\s*시간\s*후|다음\s*날|그날\s*아침|장소를\s*옮|밖으로\s*나가|새로운\s*사건|한편,|time\s*skip|later\s+that|next\s+day)/i;
const OOC_RP_DIRECTIVE =
  /(?:반응|출력|연출|묘사|진행|장면|에피소드|상황|어떻게\s*하는지|행동|대사|portray|react|output|describe|continue)/i;
const MEDICAL_NO_SEXUAL =
  /성적\s*묘사(?:는|를)?\s*(?:하지\s*마|금지|없|말아)/i;

export function detectExplicitRpStop(text: string): boolean {
  return EXPLICIT_RP_STOP.test(text);
}

/** @deprecated use detectOocHardStop — OOC marker itself is not a stop. */
export function detectOocSceneStop(text: string): boolean {
  return classifyChatOocIntent(text) === "rp_hard_stop";
}

export function detectOocHardStop(text: string): boolean {
  return classifyChatOocIntent(text) === "rp_hard_stop";
}

/** Coercion / non-consent is not an app or prompt block. */
export function detectActualNonConsent(_text: string): boolean {
  return false;
}

export function hasExplicitCncOptIn(text: string): boolean {
  return CNC_OPT_IN.test(text);
}

export function resolveRequestedConsentMode(
  requested: unknown,
  previous: AdultConsentMode,
  currentInput: string
): AdultConsentMode {
  if (detectOocHardStop(currentInput)) return "standard";
  if (requested === "power_play") return "power_play";
  if (
    requested === "cnc_opt_in" &&
    hasExplicitCncOptIn(currentInput)
  ) {
    return "cnc_opt_in";
  }
  if (requested === "standard") return "standard";
  return previous;
}

export interface SceneClassification {
  sceneMode: SceneMode;
  sexualContextActive: boolean;
  currentInputExplicitIntent: boolean;
  requiresAdultCapableModel: boolean;
  /**
   * One-turn adult-capable model for OOC explicit-anatomy reaction.
   * Not the same as requiresAdultCapableModel — real sexual scenes stay sticky.
   */
  transientAdultCapableRoute: boolean;
  actualNonConsent: boolean;
  oocIntent: ChatOocIntent;
  sceneReset: boolean;
  hardStop: boolean;
  /** @deprecated use hardStop — OOC marker itself is not a stop. */
  oocStop: boolean;
  clearSceneTransition: boolean;
  reason: string;
}

export function isTransientAdultCapableRoute(input: {
  oocIntent: ChatOocIntent;
  reason: string;
  sexualContextActive: boolean;
}): boolean {
  return (
    (input.oocIntent === "rp_scene_reset" ||
      input.oocIntent === "rp_continuing") &&
    input.reason === "ooc_explicit_anatomy_reaction" &&
    input.sexualContextActive === false
  );
}

export function hasNewlyEstablishedSexualContext(
  classification: SceneClassification
): boolean {
  if (classification.transientAdultCapableRoute) return false;
  return (
    classification.sexualContextActive === true &&
    (classification.sceneMode === "explicit" ||
      classification.sceneMode === "explicit_dialogue" ||
      classification.sceneMode === "intimate_transition")
  );
}

function withOocFields(
  base: Omit<
    SceneClassification,
    | "oocIntent"
    | "sceneReset"
    | "hardStop"
    | "oocStop"
    | "requiresAdultCapableModel"
    | "transientAdultCapableRoute"
  > &
    Partial<
      Pick<
        SceneClassification,
        | "oocIntent"
        | "sceneReset"
        | "hardStop"
        | "requiresAdultCapableModel"
        | "transientAdultCapableRoute"
      >
    >
): SceneClassification {
  const hardStop = base.hardStop === true;
  const sceneReset = base.sceneReset === true;
  const requiresAdultCapableModel =
    base.requiresAdultCapableModel === true ||
    base.currentInputExplicitIntent ||
    EXPLICIT_SCENE_MODES.has(base.sceneMode);
  const oocIntent = base.oocIntent ?? "none";
  const transientAdultCapableRoute = isTransientAdultCapableRoute({
    oocIntent,
    reason: base.reason,
    sexualContextActive: base.sexualContextActive,
  });
  return {
    ...base,
    requiresAdultCapableModel,
    transientAdultCapableRoute,
    oocIntent,
    sceneReset,
    hardStop,
    oocStop: hardStop,
  };
}

export function classifySceneMode(input: {
  currentInput: string;
  previousSceneMode?: SceneMode;
  recentRawText?: string;
  adultDialogueProfile?: AdultDialogueProfile;
  activeConsentMode?: AdultConsentMode;
}): SceneClassification {
  const current = input.currentInput.trim();
  const oocIntent = classifyChatOocIntent(current);
  const sceneReset = oocIntent === "rp_scene_reset";
  const hardStop = oocIntent === "rp_hard_stop";
  const routingText = oocIntent === "none" ? current : extractOocRoutingText(current);
  const previous = sceneReset ? "normal" : (input.previousSceneMode ?? "normal");
  const recent = sceneReset ? "" : (input.recentRawText?.slice(-6_000) ?? "");
  const combined = `${recent}\n${routingText}`;
  const actualNonConsent = detectActualNonConsent(routingText);
  const clearSceneTransition = TIME_OR_PLACE_JUMP.test(routingText);

  if (hardStop) {
    return withOocFields({
      sceneMode: "normal",
      sexualContextActive: false,
      currentInputExplicitIntent: false,
      requiresAdultCapableModel: false,
      actualNonConsent,
      oocIntent,
      sceneReset: false,
      hardStop: true,
      clearSceneTransition,
      reason: "ooc_hard_stop",
    });
  }

  if (oocIntent === "none" && clearSceneTransition) {
    return withOocFields({
      sceneMode: "normal",
      sexualContextActive: false,
      currentInputExplicitIntent: false,
      requiresAdultCapableModel: false,
      actualNonConsent,
      oocIntent,
      sceneReset: false,
      hardStop: false,
      clearSceneTransition,
      reason: "clear_scene_transition",
    });
  }

  const contextualSexualSignal =
    !sceneReset &&
    (SEXUAL_CONTEXT.test(routingText) ||
      SEXUAL_CONTEXT.test(recent) ||
      EXPLICIT_SCENE_MODES.has(previous) ||
      previous === "tension" ||
      previous === "aftercare");
  const medicalOrCombat = MEDICAL_OR_COMBAT.test(routingText);
  const medicalFalsePositive =
    medicalOrCombat &&
    (MEDICAL_NO_SEXUAL.test(routingText) || !EXPLICIT_ANATOMY.test(routingText)) &&
    !EXPLICIT_ACTION.test(routingText) &&
    !EXPLICIT_DIALOGUE.test(routingText);
  const oocExplicitAnatomyReaction =
    oocIntent !== "none" &&
    oocIntent !== "rp_unrelated" &&
    EXPLICIT_ANATOMY.test(routingText) &&
    OOC_RP_DIRECTIVE.test(routingText) &&
    !medicalFalsePositive;
  const explicitAction =
    EXPLICIT_ACTION.test(routingText) ||
    oocExplicitAnatomyReaction ||
    (EXPLICIT_ANATOMY.test(routingText) &&
      (EXPLICIT_ACTION.test(combined) || contextualSexualSignal));
  const explicitDialogue =
    EXPLICIT_DIALOGUE.test(routingText) ||
    (EXPLICIT_ANATOMY.test(routingText) &&
      /(?:말해|대사|명령|속삭|외쳐|describe|say|tell)/i.test(routingText) &&
      (contextualSexualSignal || oocIntent !== "none"));

  if (medicalFalsePositive && !explicitAction && !explicitDialogue && !oocExplicitAnatomyReaction) {
    return withOocFields({
      sceneMode: "normal",
      sexualContextActive: false,
      currentInputExplicitIntent: false,
      requiresAdultCapableModel: false,
      actualNonConsent,
      oocIntent,
      sceneReset,
      hardStop: false,
      clearSceneTransition,
      reason: "medical_or_combat_context",
    });
  }

  if (explicitDialogue) {
    return withOocFields({
      sceneMode: "explicit_dialogue",
      sexualContextActive: true,
      currentInputExplicitIntent: true,
      requiresAdultCapableModel: true,
      actualNonConsent,
      oocIntent,
      sceneReset,
      hardStop: false,
      clearSceneTransition,
      reason: oocExplicitAnatomyReaction ? "ooc_explicit_anatomy_reaction" : "explicit_dialogue",
    });
  }
  if (explicitAction) {
    return withOocFields({
      sceneMode: "explicit",
      sexualContextActive: oocExplicitAnatomyReaction ? false : true,
      currentInputExplicitIntent: true,
      requiresAdultCapableModel: true,
      actualNonConsent,
      oocIntent,
      sceneReset,
      hardStop: false,
      clearSceneTransition,
      reason: oocExplicitAnatomyReaction ? "ooc_explicit_anatomy_reaction" : "explicit_action",
    });
  }
  if (AFTERCARE.test(routingText) && EXPLICIT_SCENE_MODES.has(previous) && !sceneReset) {
    return withOocFields({
      sceneMode: "aftercare",
      sexualContextActive: true,
      currentInputExplicitIntent: false,
      actualNonConsent,
      oocIntent,
      sceneReset,
      hardStop: false,
      clearSceneTransition,
      reason: "aftercare",
    });
  }
  if (
    INTIMATE_TRANSITION.test(routingText) &&
    (contextualSexualSignal || TENSION_CONTEXT.test(recent) || sceneReset || oocIntent === "rp_continuing")
  ) {
    return withOocFields({
      sceneMode: "intimate_transition",
      sexualContextActive: true,
      currentInputExplicitIntent: true,
      requiresAdultCapableModel: true,
      actualNonConsent,
      oocIntent,
      sceneReset,
      hardStop: false,
      clearSceneTransition,
      reason: "intimate_transition",
    });
  }
  if (TENSION_CONTEXT.test(routingText)) {
    return withOocFields({
      sceneMode: "tension",
      sexualContextActive: true,
      currentInputExplicitIntent: false,
      actualNonConsent,
      oocIntent,
      sceneReset,
      hardStop: false,
      clearSceneTransition,
      reason: "tension",
    });
  }
  if (ROMANTIC_CONTEXT.test(routingText)) {
    return withOocFields({
      sceneMode: "romantic",
      sexualContextActive: false,
      currentInputExplicitIntent: false,
      actualNonConsent,
      oocIntent,
      sceneReset,
      hardStop: false,
      clearSceneTransition,
      reason: "romantic",
    });
  }
  return withOocFields({
    sceneMode: contextualSexualSignal && previous === "aftercare" ? "aftercare" : "normal",
    sexualContextActive: contextualSexualSignal && previous === "aftercare",
    currentInputExplicitIntent: false,
    requiresAdultCapableModel: false,
    actualNonConsent,
    oocIntent,
    sceneReset,
    hardStop: false,
    clearSceneTransition,
    reason: sceneReset ? "ooc_scene_reset" : "normal",
  });
}

export function modelFamily(modelId: string): string {
  const id = modelId.toLowerCase();
  if (id.includes("deepseek")) return "deepseek";
  if (id.includes("claude") || id.includes("anthropic")) return "anthropic";
  if (id.includes("gemini") || id.includes("google")) return "google";
  if (id.includes("gpt") || id.includes("openai")) return "openai";
  return "openai";
}

export function providerCanHandleScene(
  config: AdultRoutingConfig,
  providerFamily: string,
  sceneMode: SceneMode
): boolean {
  const maximum =
    config.providerCapabilities[providerFamily.toLowerCase()] ?? "tension";
  return SCENE_RANK[sceneMode] <= SCENE_RANK[maximum];
}

export interface AdultRouteDecision {
  activeRoute: ActiveModelRoute;
  sceneMode: SceneMode;
  sexualContextActive: boolean;
  routeTriggerReason?: string;
  shouldBlock: boolean;
  blockReason?: AdultEligibilityBlockReason;
  firstAdultHandoff: boolean;
  refusalBufferRecommended: boolean;
  transientAdultCapableRoute: boolean;
}

export function decideAdultModelRoute(input: {
  config: AdultRoutingConfig;
  state: ModelRouteState;
  classification: SceneClassification;
  eligibility: AdultEligibilityResult;
  adultDialogueProfile: AdultDialogueProfile;
  selectedModelId: string;
}): AdultRouteDecision {
  const { config, state, classification, eligibility } = input;
  if (!config.enabled) {
    return {
      activeRoute: "general",
      sceneMode: state.currentSceneMode,
      sexualContextActive: state.sexualContextActive === true,
      shouldBlock: false,
      firstAdultHandoff: false,
      refusalBufferRecommended: false,
      transientAdultCapableRoute: false,
    };
  }

  const explicitIntent =
    classification.currentInputExplicitIntent ||
    classification.requiresAdultCapableModel ||
    EXPLICIT_SCENE_MODES.has(classification.sceneMode);
  if (explicitIntent && !eligibility.allowedByAdultContentPolicy) {
    return {
      activeRoute: "general",
      sceneMode: classification.sceneMode,
      sexualContextActive: classification.sexualContextActive,
      shouldBlock: true,
      blockReason: eligibility.blockReason,
      firstAdultHandoff: false,
      refusalBufferRecommended: false,
      transientAdultCapableRoute: false,
    };
  }
  if (classification.hardStop) {
    return {
      activeRoute: "general",
      sceneMode: "normal",
      sexualContextActive: false,
      routeTriggerReason: "user_ooc_hard_stop",
      shouldBlock: false,
      firstAdultHandoff: false,
      refusalBufferRecommended: false,
      transientAdultCapableRoute: false,
    };
  }
  if (
    classification.clearSceneTransition &&
    classification.oocIntent === "none" &&
    !classification.currentInputExplicitIntent &&
    !classification.requiresAdultCapableModel
  ) {
    return {
      activeRoute: "general",
      sceneMode: "normal",
      sexualContextActive: false,
      routeTriggerReason: "clear_scene_transition",
      shouldBlock: false,
      firstAdultHandoff: false,
      refusalBufferRecommended: false,
      transientAdultCapableRoute: false,
    };
  }

  const frequentDirtyTalkRoute =
    eligibility.eligible &&
    input.adultDialogueProfile === "explicit_frequent" &&
    classification.sexualContextActive;
  const previousRequiresAdult =
    !classification.sceneReset &&
    (state.currentSceneMode === "explicit_dialogue" ||
      state.currentSceneMode === "intimate_transition" ||
      state.currentSceneMode === "explicit");
  const providerBoundaryExceeded = !providerCanHandleScene(
    config,
    modelFamily(input.selectedModelId),
    classification.sceneMode
  );
  const shouldEnterAdultRoute =
    eligibility.eligible &&
    eligibility.allowedByAdultContentPolicy &&
    (classification.currentInputExplicitIntent ||
      classification.requiresAdultCapableModel ||
      previousRequiresAdult ||
      frequentDirtyTalkRoute ||
      providerBoundaryExceeded);

  // Scene reset cancels old sticky adult; new classification decides the route.
  const stickyAdult =
    !classification.sceneReset &&
    state.activeRoute === "adult" &&
    eligibility.eligible &&
    eligibility.allowedByAdultContentPolicy;

  if (stickyAdult || shouldEnterAdultRoute) {
    return {
      activeRoute: "adult",
      sceneMode: classification.sceneMode,
      sexualContextActive: classification.sexualContextActive,
      routeTriggerReason: shouldEnterAdultRoute
        ? classification.reason
        : state.routeTriggerReason ?? "sticky_adult_route",
      shouldBlock: false,
      firstAdultHandoff:
        classification.sceneReset || state.activeRoute !== "adult",
      refusalBufferRecommended: false,
      transientAdultCapableRoute: classification.transientAdultCapableRoute,
    };
  }

  return {
    activeRoute: "general",
    sceneMode: classification.sceneMode,
    sexualContextActive: classification.sexualContextActive,
    shouldBlock: false,
    firstAdultHandoff: false,
    refusalBufferRecommended:
      eligibility.eligible &&
      config.silentRefusalFallback &&
      (classification.sexualContextActive ||
        classification.sceneMode === "tension"),
    transientAdultCapableRoute: false,
  };
}

export function advanceModelRouteState(input: {
  previous: ModelRouteState;
  deliveredRoute: ActiveModelRoute;
  sceneModeAfter: SceneMode;
  sexualContextActive: boolean;
  routeTriggerReason?: string;
  config: AdultRoutingConfig;
  enteredAdultThisTurn?: boolean;
  explicitSceneEnd?: boolean;
  activeConsentMode?: AdultConsentMode;
  generalRouteBridge?: GeneralRouteBridge;
  transientAdultCapableRoute?: boolean;
  establishedOngoingSexualContext?: boolean;
  adultHandoffSourceModelId?: string;
  adultHandoffTargetModelId?: string;
}): ModelRouteState {
  if (!input.config.enabled) return input.previous;
  if (input.explicitSceneEnd) {
    return {
      ...DEFAULT_MODEL_ROUTE_STATE,
      activeConsentMode: "standard",
      routeTriggerReason: "explicit_scene_end",
    };
  }

  if (
    input.transientAdultCapableRoute &&
    input.deliveredRoute === "adult" &&
    !input.establishedOngoingSexualContext
  ) {
    return {
      activeRoute: "general",
      currentSceneMode: "normal",
      adultRouteMinimumTurnsRemaining: 0,
      safeSceneStreak: 0,
      routeTriggerReason: "transient_adult_capable_route",
      activeConsentMode:
        input.activeConsentMode ?? input.previous.activeConsentMode,
      sexualContextActive: false,
      generalRouteBridge: input.previous.generalRouteBridge,
    };
  }

  const safeScene =
    input.sceneModeAfter === "normal" || input.sceneModeAfter === "romantic";
  if (input.deliveredRoute === "adult") {
    const minimum = input.enteredAdultThisTurn
      ? input.config.minimumRouteTurns
      : Math.max(0, input.previous.adultRouteMinimumTurnsRemaining - 1);
    const safeSceneStreak = safeScene ? input.previous.safeSceneStreak + 1 : 0;
    const canReturn =
      minimum === 0 && safeSceneStreak >= input.config.returnSafeTurns;
    return {
      activeRoute: canReturn ? "general" : "adult",
      currentSceneMode: input.sceneModeAfter,
      adultRouteMinimumTurnsRemaining: canReturn ? 0 : minimum,
      safeSceneStreak: canReturn ? 0 : safeSceneStreak,
      routeTriggerReason: canReturn
        ? "safe_scene_streak"
        : input.routeTriggerReason ?? input.previous.routeTriggerReason,
      activeConsentMode:
        input.activeConsentMode ?? input.previous.activeConsentMode,
      sexualContextActive: input.sexualContextActive,
      generalRouteBridge:
        input.generalRouteBridge ?? input.previous.generalRouteBridge,
      ...(canReturn
        ? {}
        : {
            adultHandoffSourceModelId:
              input.adultHandoffSourceModelId ??
              input.previous.adultHandoffSourceModelId,
            adultHandoffTargetModelId:
              input.adultHandoffTargetModelId ??
              input.previous.adultHandoffTargetModelId,
          }),
    };
  }

  return {
    activeRoute: "general",
    currentSceneMode: input.sceneModeAfter,
    adultRouteMinimumTurnsRemaining: 0,
    safeSceneStreak: safeScene ? input.previous.safeSceneStreak + 1 : 0,
    routeTriggerReason: input.routeTriggerReason,
    activeConsentMode:
      input.activeConsentMode ?? input.previous.activeConsentMode,
    sexualContextActive: input.sexualContextActive,
    generalRouteBridge: input.previous.generalRouteBridge,
  };
}

export interface SelectedAdultRawHistory {
  history: ChatMsg[];
  rawTurnsIncluded: number;
  rawTokensIncluded: number;
}

export interface AdultHandoffRawVariants {
  base: SelectedAdultRawHistory;
  handoff: SelectedAdultRawHistory;
  extraTurnsIncluded: number;
  extraTokensIncluded: number;
}

function collectCompleteAdultRawPairs(
  history: ChatMsg[]
): Array<[ChatMsg, ChatMsg]> {
  const pairs: Array<[ChatMsg, ChatMsg]> = [];
  let pendingUser: ChatMsg | null = null;
  for (const message of history) {
    if (message.role === "user") {
      pendingUser = message;
    } else if (message.role === "assistant" && pendingUser) {
      pairs.push([pendingUser, message]);
      pendingUser = null;
    }
  }
  return pairs;
}

function flattenAdultRawPairs(
  pairs: Array<[ChatMsg, ChatMsg]>
): SelectedAdultRawHistory {
  return {
    history: pairs.flatMap(([user, assistant]) => [
      { role: "user" as const, content: user.content },
      { role: "assistant" as const, content: assistant.content },
    ]),
    rawTurnsIncluded: pairs.length,
    rawTokensIncluded: pairs.reduce(
      (total, [user, assistant]) =>
        total + estimateTokens(user.content) + estimateTokens(assistant.content),
      0
    ),
  };
}

function sameRawMessage(a: ChatMsg | undefined, b: ChatMsg | undefined): boolean {
  return a?.role === b?.role && a?.content === b?.content;
}

export function assertAdultHandoffRawSuperset(
  variants: AdultHandoffRawVariants
): void {
  const { base, handoff } = variants;
  if (handoff.rawTurnsIncluded < base.rawTurnsIncluded) {
    throw new Error(
      `Adult handoff RAW invariant: B exchanges ${handoff.rawTurnsIncluded} < A ${base.rawTurnsIncluded}`
    );
  }
  if (handoff.history.length < base.history.length) {
    throw new Error(
      `Adult handoff RAW invariant: B messages ${handoff.history.length} < A ${base.history.length}`
    );
  }
  const offset = handoff.history.length - base.history.length;
  for (let index = 0; index < base.history.length; index++) {
    if (!sameRawMessage(base.history[index], handoff.history[offset + index])) {
      throw new Error(
        `Adult handoff RAW invariant: B does not contain A message ${index} as an unchanged suffix`
      );
    }
  }
  const baseLatestAssistant = [...base.history]
    .reverse()
    .find((message) => message.role === "assistant");
  const handoffLatestAssistant = [...handoff.history]
    .reverse()
    .find((message) => message.role === "assistant");
  if (!sameRawMessage(baseLatestAssistant, handoffLatestAssistant)) {
    throw new Error(
      "Adult handoff RAW invariant: latest assistant differs between A and B"
    );
  }
  const baseLatestUser = [...base.history]
    .reverse()
    .find((message) => message.role === "user");
  const handoffLatestUser = [...handoff.history]
    .reverse()
    .find((message) => message.role === "user");
  if (!sameRawMessage(baseLatestUser, handoffLatestUser)) {
    throw new Error(
      "Adult handoff RAW invariant: latest user differs between A and B"
    );
  }
}

export function selectAdultHandoffRawVariants(
  history: ChatMsg[],
  opts: {
    baseExchanges?: number;
    targetExchanges?: number;
    extraRawTokens?: number;
  } = {}
): AdultHandoffRawVariants {
  const baseExchanges = Math.max(2, opts.baseExchanges ?? 4);
  const targetExchanges = Math.max(
    baseExchanges,
    opts.targetExchanges ?? 6
  );
  const extraRawTokens = Math.max(0, opts.extraRawTokens ?? 4_000);
  const pairs = collectCompleteAdultRawPairs(history);
  const baseStart = Math.max(0, pairs.length - baseExchanges);
  const basePairs = pairs.slice(baseStart);
  const handoffPairs = [...basePairs];
  let extraTokensIncluded = 0;

  for (
    let index = baseStart - 1;
    index >= 0 && handoffPairs.length < targetExchanges;
    index--
  ) {
    const pair = pairs[index]!;
    const pairTokens =
      estimateTokens(pair[0].content) + estimateTokens(pair[1].content);
    if (extraTokensIncluded + pairTokens > extraRawTokens) break;
    handoffPairs.unshift(pair);
    extraTokensIncluded += pairTokens;
  }
  const variants: AdultHandoffRawVariants = {
    base: flattenAdultRawPairs(basePairs),
    handoff: flattenAdultRawPairs(handoffPairs),
    extraTurnsIncluded: handoffPairs.length - basePairs.length,
    extraTokensIncluded,
  };
  assertAdultHandoffRawSuperset(variants);
  return variants;
}

export function selectAdultHandoffRawHistory(
  history: ChatMsg[],
  opts: {
    baseExchanges?: number;
    targetExchanges?: number;
    extraRawTokens?: number;
    /** @deprecated */
    targetTurns?: number;
    /** @deprecated legacy total budget is now additional-history budget. */
    maxTokens?: number;
    /** @deprecated baseExchanges owns the floor. */
    minimumTurns?: number;
  } = {}
): SelectedAdultRawHistory {
  return selectAdultHandoffRawVariants(history, {
    baseExchanges: opts.baseExchanges ?? opts.minimumTurns ?? 4,
    targetExchanges: opts.targetExchanges ?? opts.targetTurns ?? 6,
    extraRawTokens: opts.extraRawTokens ?? opts.maxTokens ?? 4_000,
  }).handoff;
}

function cleanOptional(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim().slice(0, max);
  return cleaned || undefined;
}

function cleanStringArray(value: unknown, maxItems = 12): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .map((item) => cleanOptional(item, 120))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
  return cleaned.length ? cleaned : undefined;
}

export function buildSceneContinuityPacket(input: {
  previousSceneMode: SceneMode;
  sexualContextActive?: boolean;
  activeConsentMode?: AdultConsentMode;
  location?: unknown;
  time?: unknown;
  charactersPresent?: unknown;
  currentPov?: unknown;
  positions?: unknown;
  unfinishedAction?: unknown;
  emotionalBalance?: unknown;
  currentSpeechState?: unknown;
  relationshipChange?: unknown;
  previousActionActor?: unknown;
  previousActionTarget?: unknown;
  contactDirection?: unknown;
  sceneReset?: boolean;
}): SceneContinuityPacket {
  if (input.sceneReset) {
    return {
      previousSceneMode: "normal",
      sceneReset: true,
      sexualContextActive: input.sexualContextActive === true,
      ...(input.activeConsentMode
        ? { activeConsentMode: input.activeConsentMode }
        : {}),
      ...(cleanStringArray(input.charactersPresent)
        ? { charactersPresent: cleanStringArray(input.charactersPresent) }
        : {}),
      ...(cleanOptional(input.currentPov)
        ? { currentPov: cleanOptional(input.currentPov) }
        : {}),
    };
  }
  return {
    previousSceneMode: input.previousSceneMode,
    ...(input.sexualContextActive != null
      ? { sexualContextActive: input.sexualContextActive }
      : {}),
    ...(input.activeConsentMode
      ? { activeConsentMode: input.activeConsentMode }
      : {}),
    ...(cleanOptional(input.location) ? { location: cleanOptional(input.location) } : {}),
    ...(cleanOptional(input.time) ? { time: cleanOptional(input.time) } : {}),
    ...(cleanStringArray(input.charactersPresent)
      ? { charactersPresent: cleanStringArray(input.charactersPresent) }
      : {}),
    ...(cleanOptional(input.currentPov)
      ? { currentPov: cleanOptional(input.currentPov) }
      : {}),
    ...(cleanOptional(input.positions)
      ? { positions: cleanOptional(input.positions) }
      : {}),
    ...(cleanOptional(input.unfinishedAction)
      ? { unfinishedAction: cleanOptional(input.unfinishedAction) }
      : {}),
    ...(cleanOptional(input.emotionalBalance)
      ? { emotionalBalance: cleanOptional(input.emotionalBalance) }
      : {}),
    ...(cleanOptional(input.currentSpeechState)
      ? { currentSpeechState: cleanOptional(input.currentSpeechState) }
      : {}),
    ...(cleanOptional(input.relationshipChange)
      ? { relationshipChange: cleanOptional(input.relationshipChange) }
      : {}),
    ...(cleanOptional(input.previousActionActor)
      ? { previousActionActor: cleanOptional(input.previousActionActor) }
      : {}),
    ...(cleanOptional(input.previousActionTarget)
      ? { previousActionTarget: cleanOptional(input.previousActionTarget) }
      : {}),
    ...(cleanOptional(input.contactDirection)
      ? { contactDirection: cleanOptional(input.contactDirection) }
      : {}),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Lightweight continuity cues from the last general-model assistant turn.
 * Used to reduce handoff subject/object inversion (waist-wrap etc.).
 */
export function extractHandoffContinuityFromAssistantText(input: {
  text: string;
  characterName: string;
  personaName: string;
  /** Current user turn — used when user already states contact direction. */
  currentUserText?: string;
}): Pick<
  SceneContinuityPacket,
  | "location"
  | "positions"
  | "unfinishedAction"
  | "currentSpeechState"
  | "previousActionActor"
  | "previousActionTarget"
  | "contactDirection"
> {
  const text = input.text.trim();
  const currentUserText = input.currentUserText?.trim() ?? "";
  if (!text && !currentUserText) return {};

  const characterName = input.characterName.trim();
  const personaName = input.personaName.trim();
  const out: ReturnType<typeof extractHandoffContinuityFromAssistantText> = {};

  const locationMatch = `${text}\n${currentUserText}`.match(
    /(?:호텔|침실|침대|거실|소파|벽|복도|욕실|방\s*안|창문\s*앞|카페|옥상)[^\n。.!?]{0,24}/
  );
  if (locationMatch?.[0]) out.location = locationMatch[0].trim().slice(0, 80);

  const postureMatch = text.match(
    /(?:벽에\s*기대|소파에\s*앉|침대에\s*눕|무릎을\s*꿇|품안에|품에\s*안|밀착해|끌어안)[^\n。.!?]{0,40}/
  );
  if (postureMatch?.[0]) out.positions = postureMatch[0].trim().slice(0, 120);

  const speechMatch = text.match(/[「"“]([^」"”]{2,40})[」"”]/);
  if (speechMatch?.[1]) {
    out.currentSpeechState = speechMatch[1].trim().slice(0, 80);
  }

  // User already established contact: "내 허리를 감싼 …" → character → persona.
  if (
    personaName &&
    /(?:내|나의)\s*(?:허리|어깨|손목|손|허리춤)[을를]?\s*(?:감싼|감쌌|감싸|끌어|붙잡|잡)/.test(
      currentUserText
    )
  ) {
    const named = currentUserText.match(
      /([가-힣]{2,8})[이가은는]?\s*(?:내|나의)\s*(?:허리|어깨|손목|손|허리춤)/
    );
    const fallbackActor = characterName.includes(" ")
      ? characterName.split(/\s+/).at(-1) || characterName
      : characterName;
    out.previousActionActor = named?.[1] && named[1] !== personaName
      ? named[1]
      : fallbackActor;
    out.previousActionTarget = personaName;
    out.contactDirection = `${out.previousActionActor} → ${personaName} contact`;
  }

  const persona = personaName.trim();
  const namedActors = Array.from(
    new Set(
      [characterName, ...characterName.split(/\s+/)]
        .map((n) => n.trim())
        .filter((n) => n.length >= 2 && n !== persona)
    )
  );
  if (persona) {
    for (const actorName of namedActors) {
      const a = escapeRegExp(actorName);
      const b = escapeRegExp(persona);
      const forward = new RegExp(
        `${a}[이가은는]?\\s*${b}(?:의)?\\s*(?:허리|어깨|손목|손|허리춤)[을를]?\\s*(?:감싼|감쌌|감싸|끌어|붙잡|잡)`,
        "i"
      );
      const reverse = new RegExp(
        `${b}[이가은는]?\\s*${a}(?:의)?\\s*(?:허리|어깨|손목|손|허리춤)[을를]?\\s*(?:감싼|감쌌|감싸|끌어|붙잡|잡)`,
        "i"
      );
      if (forward.test(text)) {
        out.previousActionActor = actorName;
        out.previousActionTarget = persona;
        out.contactDirection = `${actorName} → ${persona} contact`;
        break;
      }
      if (reverse.test(text)) {
        out.previousActionActor = persona;
        out.previousActionTarget = actorName;
        out.contactDirection = `${persona} → ${actorName} contact`;
        break;
      }
    }
  }
  // Fallback: any Korean name contacting the persona (e.g. 서이레 vs listing title).
  if (!out.previousActionActor && persona) {
    const b = escapeRegExp(persona);
    const generic = new RegExp(
      `([가-힣]{2,8})[이가은는]?\\s*${b}(?:의)?\\s*(?:허리|어깨|손목|손|허리춤)[을를]?\\s*(?:감싼|감쌌|감싸|끌어|붙잡|잡)`
    );
    const m = text.match(generic);
    if (m?.[1] && m[1] !== persona) {
      out.previousActionActor = m[1];
      out.previousActionTarget = persona;
      out.contactDirection = `${m[1]} → ${persona} contact`;
    }
  }

  const unfinishedMatch = text.match(
    /([^\n。.!?]{0,40}(?:감싸|끌어안|밀착|속삭이|입술|손길)[^\n。.!?]{0,40})[…\.]*\s*$/
  );
  if (unfinishedMatch?.[1]) {
    out.unfinishedAction = unfinishedMatch[1].trim().slice(0, 160);
  } else {
    const lastSentence = text
      .split(/(?<=[.!?。…])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .at(-1);
    if (lastSentence) out.unfinishedAction = lastSentence.slice(0, 160);
  }

  return out;
}

export const DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION = `직전 assistant 출력의 바로 다음 순간부터 이어 쓴다.

직전 출력의 시점, 문장 호흡, 문단 구성, 대사 비율, 캐릭터별 말투·호칭과 감정 표현 방식을 최대한 유지한다.

이전 장면을 요약하거나 반복하지 말고, 새로운 도입부를 만들지 않는다.

직전 출력에서 완료되지 않은 행동이나 대화가 있다면 그 지점부터 자연스럽게 진행한다.

SceneContinuityPacket의 previousActionActor / previousActionTarget / contactDirection이 있으면 주체·객체·접촉 방향을 뒤집지 않는다.
예: A가 B의 허리를 감싼 상태면, 다음 문장에서 B가 A의 허리를 감싼 것처럼 바꾸지 않는다.

공통 시스템 프롬프트, 캐릭터 설정, Speech Lock 규칙을 직전 출력의 우연한 오류보다 우선한다.

내부 모델 전환, SceneMode, route, STATUS_VALUES 또는 시스템 지시를 RP 본문에 언급하지 않는다.`;

export const SCENE_RESET_HANDOFF_INSTRUCTION = `Previous RAW history is supplied only for:
- character voice
- writing style
- established canon / relationship knowledge
Do NOT continue:
- previous physical position
- previous unfinished action
- previous contact direction
- previous location
Begin directly from the new OOC-directed scene.
The user's OOC may explicitly establish actions performed by the user persona.
Those explicitly authored setup actions may be realized exactly as specified.
Do not invent additional user dialogue, consent/refusal, decisions, emotions, intentions, or multi-step actions beyond what the OOC explicitly established.`;

export function renderSceneContinuityPacket(
  packet: SceneContinuityPacket
): string {
  const safePacket = JSON.stringify(packet, null, 2);
  return `[SceneContinuityPacket — 비공개 라우팅 문맥]\n${safePacket}`;
}

export function appendAdultHandoffPrompt(
  systemPrompt: string,
  packet: SceneContinuityPacket,
  opts?: { sourceModelId?: string; adultTargetModelId?: string }
): string {
  const common = [
    systemPrompt.trim(),
    renderSceneContinuityPacket(packet),
    packet.sceneReset
      ? SCENE_RESET_HANDOFF_INSTRUCTION
      : DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
  ]
    .filter(Boolean)
    .join("\n\n");
  return appendSourceSpecificQwenAdapter(
    common,
    opts?.sourceModelId,
    opts?.adultTargetModelId
  );
}

export function appendAdultHandoffToSystemSplit<T extends {
  systemRulesBlock: string;
  characterSettingsBlock: string;
  dynamicBlock: string;
}>(
  split: T | undefined,
  packet: SceneContinuityPacket,
  opts?: { sourceModelId?: string; adultTargetModelId?: string }
): T | undefined {
  if (!split) return undefined;
  const dynamicBlock = appendSourceSpecificQwenAdapter(
    [
      split.dynamicBlock.trim(),
      renderSceneContinuityPacket(packet),
      packet.sceneReset
        ? SCENE_RESET_HANDOFF_INSTRUCTION
        : DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
    ]
      .filter(Boolean)
      .join("\n\n"),
    opts?.sourceModelId,
    opts?.adultTargetModelId
  );
  return {
    ...split,
    dynamicBlock,
  };
}

export function sanitizeGeneralRouteBridge(
  bridge: GeneralRouteBridge
): GeneralRouteBridge {
  return {
    ...(cleanOptional(bridge.relationshipChange)
      ? { relationshipChange: cleanOptional(bridge.relationshipChange, 240) }
      : {}),
    ...(cleanOptional(bridge.emotionalAftermath)
      ? { emotionalAftermath: cleanOptional(bridge.emotionalAftermath, 240) }
      : {}),
    ...(cleanOptional(bridge.promisesOrConflict)
      ? { promisesOrConflict: cleanOptional(bridge.promisesOrConflict, 240) }
      : {}),
    ...(cleanOptional(bridge.currentLocation)
      ? { currentLocation: cleanOptional(bridge.currentLocation, 160) }
      : {}),
    ...(cleanOptional(bridge.currentTime)
      ? { currentTime: cleanOptional(bridge.currentTime, 120) }
      : {}),
    ...(cleanOptional(bridge.physicalState)
      ? { physicalState: cleanOptional(bridge.physicalState, 180) }
      : {}),
    ...(cleanOptional(bridge.clothingState)
      ? { clothingState: cleanOptional(bridge.clothingState, 180) }
      : {}),
    ...(cleanOptional(bridge.injuryState)
      ? { injuryState: cleanOptional(bridge.injuryState, 180) }
      : {}),
    ...(cleanStringArray(bridge.importantItems, 8)
      ? { importantItems: cleanStringArray(bridge.importantItems, 8) }
      : {}),
    ...(cleanStringArray(bridge.nextSceneRelevantFacts, 8)
      ? { nextSceneRelevantFacts: cleanStringArray(bridge.nextSceneRelevantFacts, 8) }
      : {}),
  };
}

export function buildGeneralRouteBridge(
  packet: SceneContinuityPacket
): GeneralRouteBridge {
  return sanitizeGeneralRouteBridge({
    relationshipChange: packet.relationshipChange,
    emotionalAftermath:
      packet.emotionalBalance ??
      "성인 장면 이후의 감정적 여운과 관계 변화가 남아 있다.",
    currentLocation: packet.location,
    currentTime: packet.time,
    physicalState: packet.unfinishedAction
      ? "직전 장면에서 완료되지 않은 행동 상태가 이어진다."
      : undefined,
    nextSceneRelevantFacts: [
      ...(packet.charactersPresent?.length
        ? [`현재 등장인물: ${packet.charactersPresent.join(", ")}`]
        : []),
      ...(packet.currentPov ? [`현재 시점: ${packet.currentPov}`] : []),
    ],
  });
}

export interface CanonicalRouteHistoryMessage extends ChatMsg {
  sceneMode?: SceneMode;
  activeRoute?: ActiveModelRoute;
}

export function buildGeneralProviderContext(
  history: CanonicalRouteHistoryMessage[],
  bridge?: GeneralRouteBridge
): ChatMsg[] {
  const safe: ChatMsg[] = [];
  let pendingUser: CanonicalRouteHistoryMessage | null = null;
  let droppedAdult = false;
  let bridgeInserted = false;
  const insertBridge = () => {
    if (bridgeInserted || !bridge || Object.keys(bridge).length === 0) return;
    safe.push(
      { role: "user", content: "[이전 장면 이후의 안전한 연속성 정보]" },
      {
        role: "assistant",
        content: JSON.stringify(sanitizeGeneralRouteBridge(bridge)),
      }
    );
    bridgeInserted = true;
  };

  for (const message of history) {
    if (message.role === "user") {
      pendingUser = message;
      continue;
    }
    if (!pendingUser) continue;
    const explicit =
      message.activeRoute === "adult" ||
      (message.sceneMode != null && EXPLICIT_SCENE_MODES.has(message.sceneMode));
    if (explicit) {
      droppedAdult = true;
      pendingUser = null;
      continue;
    }
    if (droppedAdult) insertBridge();
    safe.push(
      { role: "user", content: pendingUser.content },
      { role: "assistant", content: message.content }
    );
    pendingUser = null;
  }
  if (droppedAdult) insertBridge();
  return safe;
}

function normalizedRefusalText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function detectModelRefusal(input: {
  text?: string | null;
  finishReason?: string | null;
  error?: unknown;
}): RefusalResult {
  const text = normalizedRefusalText(input.text ?? "");
  const finish = (input.finishReason ?? "").toLowerCase();
  const errorText =
    input.error instanceof Error
      ? input.error.message.toLowerCase()
      : typeof input.error === "string"
        ? input.error.toLowerCase()
        : "";

  if (
    /content[_ -]?filter|blocked|safety|recitation/.test(finish) ||
    /content[_ -]?filter|safety[_ -]?block|blocked by safety/.test(errorText)
  ) {
    return {
      refused: true,
      reason: finish.includes("content") || errorText.includes("content")
        ? "content_filter"
        : "safety_block",
    };
  }
  if (!text && /safety|blocked|filter|refusal/.test(`${finish} ${errorText}`)) {
    return { refused: true, reason: "empty_safety_response" };
  }
  const refusal =
    /(?:i (?:can(?:not|'t)|won't|am unable to) (?:help|assist|comply)|i must decline|cannot provide|can't continue|요청에 (?:응할|따를) 수 없|도와드릴 수 없|작성할 수 없|제공할 수 없|해당 내용은|안전 정책|성적으로 노골적인 내용)/i;
  if (text && text.length <= 1_200 && refusal.test(text)) {
    return { refused: true, reason: "provider_refusal" };
  }
  return { refused: false, reason: "unknown" };
}

type StreamTextEvent = {
  type?: unknown;
  text?: unknown;
  delta?: unknown;
};

export function createInitialStreamBuffer(
  send: (obj: object) => void,
  maxChars: number
): {
  send: (obj: object) => void;
  flush: () => void;
  discard: () => void;
  hasVisibleTokens: () => boolean;
  bufferedText: () => string;
} {
  const limit = Math.max(0, Math.trunc(maxChars));
  let queue: object[] = [];
  let visible = false;
  let discarded = false;
  let text = "";

  const flush = () => {
    if (discarded || visible) return;
    visible = true;
    for (const event of queue) send(event);
    queue = [];
  };

  const bufferedSend = (event: object) => {
    if (discarded) return;
    if (visible || limit === 0) {
      visible = true;
      send(event);
      return;
    }
    const typed = event as StreamTextEvent;
    if (typed.type === "replace" && typeof typed.text === "string") {
      text = typed.text;
    } else if (typed.type === "delta" && typeof typed.text === "string") {
      text += typed.text;
    } else if (typed.type === "delta" && typeof typed.delta === "string") {
      text += typed.delta;
    }
    queue.push(event);
    if (text.length >= limit) flush();
  };

  return {
    send: bufferedSend,
    flush,
    discard: () => {
      queue = [];
      text = "";
      discarded = true;
    },
    hasVisibleTokens: () => visible,
    bufferedText: () => text,
  };
}

export function buildHandoffVariantA(input: {
  commonSystemPrompt: string;
  history: ChatMsg[];
  currentUserInput: string;
}): { systemPrompt: string; history: ChatMsg[] } {
  const raw = selectAdultHandoffRawVariants(input.history).base;
  return {
    systemPrompt: input.commonSystemPrompt,
    history: [
      ...raw.history,
      { role: "user", content: input.currentUserInput },
    ],
  };
}

export function buildHandoffVariantB(input: {
  commonSystemPrompt: string;
  history: ChatMsg[];
  currentUserInput: string;
  continuityPacket: SceneContinuityPacket;
}): { systemPrompt: string; history: ChatMsg[] } {
  const raw = selectAdultHandoffRawVariants(input.history).handoff;
  return {
    systemPrompt: appendAdultHandoffPrompt(
      input.commonSystemPrompt,
      input.continuityPacket
    ),
    history: [
      ...raw.history,
      { role: "user", content: input.currentUserInput },
    ],
  };
}
