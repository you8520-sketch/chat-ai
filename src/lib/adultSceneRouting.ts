import type { ChatMsg } from "@/lib/ai";
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
  previousSceneMode: SceneMode;
  sexualContextActive?: boolean;
  activeConsentMode?: AdultConsentMode;
}

export interface ParticipantAdultMetadata {
  age?: number | null;
  isAdult?: boolean | number | null;
  ageGroup?: string | null;
  adultStatus?: string | null;
  currentSchool?: string | null;
  description?: string | null;
  isRealPerson?: boolean;
}

export type AdultEligibilityBlockReason =
  | "user_not_verified"
  | "character_adult_disabled"
  | "participant_minor"
  | "participant_conflict"
  | "participant_unknown"
  | "real_person"
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
  handoffRawTurns: number;
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

const MINOR_SIGNAL =
  /(?:미성년|미성년자|중학생|고등학생|초등학생|아동|어린이|어린아이|child|minor|underage|middle\s*school|high\s*school)/i;
const ADULT_SIGNAL =
  /(?:\b(?:19|2[0-9]|[3-9][0-9])\s*(?:세|살)\b|성인(?:\s*(?:남성|여성))?|adult|대학생|직장인|현역\s*군인)/i;
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
  return {
    enabled: envBool(env.ADULT_SCENE_ROUTING_ENABLED, false),
    adultModelId: env.ADULT_MODEL_ID?.trim() || "deepseek-v4-pro",
    providerOrder: envList(env.ADULT_MODEL_PROVIDER_ORDER),
    providerOnly: envList(env.ADULT_MODEL_PROVIDER_ONLY),
    allowProviderFallbacks: envBool(
      env.ADULT_MODEL_ALLOW_PROVIDER_FALLBACKS,
      false
    ),
    requireParameters: envBool(env.ADULT_MODEL_REQUIRE_PARAMETERS, true),
    quantizations: envList(env.ADULT_MODEL_QUANTIZATIONS),
    handoffRawTurns: envInt(env.ADULT_SCENE_HANDOFF_RAW_TURNS, 6, 2, 12),
    handoffMaxTokens: envInt(
      env.ADULT_SCENE_HANDOFF_MAX_TOKENS,
      8_000,
      1_000,
      20_000
    ),
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
  const minor = MINOR_SIGNAL.test(normalized) || findNumericMinorAge(normalized);
  const adult = ADULT_SIGNAL.test(normalized);
  if (minor && adult) return "conflict";
  if (minor) return "minor";
  if (adult) return "confirmed";
  return "unknown";
}

function findNumericMinorAge(text: string): boolean {
  const ages = [...text.matchAll(/(?:나이\s*[:：]?\s*)?(\d{1,2})\s*(?:세|살)\b/g)];
  return ages.some((match) => {
    const age = Number(match[1]);
    return age > 0 && age < 19;
  });
}

export function assessParticipantAdultStatus(
  participant: ParticipantAdultMetadata
): AdultStatus | "real_person" {
  const description = [
    participant.description,
    participant.currentSchool,
    participant.ageGroup,
    participant.adultStatus,
  ]
    .filter(Boolean)
    .join("\n");
  if (participant.isRealPerson || REAL_PERSON_SIGNAL.test(description)) {
    return "real_person";
  }

  const numericAge =
    typeof participant.age === "number" && Number.isFinite(participant.age)
      ? participant.age
      : null;
  const explicitMinor =
    (numericAge != null && numericAge < 19) ||
    MINOR_SIGNAL.test(description) ||
    findNumericMinorAge(description) ||
    /^(minor|underage|child)$/i.test(participant.adultStatus?.trim() ?? "");
  const explicitAdult =
    (numericAge != null && numericAge >= 19) ||
    participant.isAdult === true ||
    participant.isAdult === 1 ||
    /^(adult)$/i.test(participant.ageGroup?.trim() ?? "") ||
    /^(confirmed|adult)$/i.test(participant.adultStatus?.trim() ?? "") ||
    ADULT_SIGNAL.test(description);

  if (explicitMinor && explicitAdult) return "conflict";
  if (explicitMinor) return "minor";
  if (explicitAdult) return "confirmed";
  return "unknown";
}

export function resolveAdultEligibility(input: {
  userAdultVerified: boolean;
  characterAdultContentEnabled: boolean;
  participants: ParticipantAdultMetadata[];
  actualNonConsent?: boolean;
}): AdultEligibilityResult {
  if (!input.userAdultVerified) {
    return {
      eligible: false,
      allowedByAdultContentPolicy: false,
      blockReason: "user_not_verified",
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
  if (input.actualNonConsent) {
    return {
      eligible: false,
      allowedByAdultContentPolicy: false,
      blockReason: "actual_nonconsent",
    };
  }
  return { eligible: true, allowedByAdultContentPolicy: true };
}

const OOC_STOP =
  /(?:\bOOC\b|괄호\s*밖|롤플레(?:이|잉)\s*(?:중단|종료)|장면\s*(?:중단|종료)|그만\s*하자|여기서\s*멈춰|stop\s+(?:the\s+)?scene|end\s+(?:the\s+)?scene)/i;
const EXPLICIT_NONCONSENT =
  /(?:실제\s*(?:비동의|강간|성폭력)|동의\s*없이|싫다고\s*(?:했는데|하는데).{0,16}(?:강제로|억지로)|의식\s*없는.{0,12}(?:성행위|관계)|actual\s+(?:rape|non[- ]?consensual)|without\s+consent)/i;
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
  /(?:(?:침실|침대|호텔|방으로).{0,24}(?:가|데려|이동|들어)|옷을\s*(?:벗|내리)|계속해|더\s*해|다음으로\s*넘어|끝까지|명시적(?:인)?\s*장면|성인\s*장면|have\s+sex|make\s+love)/i;
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

export function detectOocSceneStop(text: string): boolean {
  return OOC_STOP.test(text);
}

export function detectActualNonConsent(text: string): boolean {
  return EXPLICIT_NONCONSENT.test(text) && !CNC_OPT_IN.test(text);
}

export function hasExplicitCncOptIn(text: string): boolean {
  return CNC_OPT_IN.test(text);
}

export function resolveRequestedConsentMode(
  requested: unknown,
  previous: AdultConsentMode,
  currentInput: string
): AdultConsentMode {
  if (detectOocSceneStop(currentInput)) return "standard";
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
  actualNonConsent: boolean;
  oocStop: boolean;
  clearSceneTransition: boolean;
  reason: string;
}

export function classifySceneMode(input: {
  currentInput: string;
  previousSceneMode?: SceneMode;
  recentRawText?: string;
  adultDialogueProfile?: AdultDialogueProfile;
  activeConsentMode?: AdultConsentMode;
}): SceneClassification {
  const current = input.currentInput.trim();
  const previous = input.previousSceneMode ?? "normal";
  const recent = input.recentRawText?.slice(-6_000) ?? "";
  const combined = `${recent}\n${current}`;
  const oocStop = detectOocSceneStop(current);
  const actualNonConsent = detectActualNonConsent(current);
  const clearSceneTransition = TIME_OR_PLACE_JUMP.test(current);
  if (oocStop || clearSceneTransition) {
    return {
      sceneMode: "normal",
      sexualContextActive: false,
      currentInputExplicitIntent: false,
      actualNonConsent,
      oocStop,
      clearSceneTransition,
      reason: oocStop ? "ooc_stop" : "clear_scene_transition",
    };
  }

  const contextualSexualSignal =
    SEXUAL_CONTEXT.test(current) ||
    SEXUAL_CONTEXT.test(recent) ||
    EXPLICIT_SCENE_MODES.has(previous) ||
    previous === "tension" ||
    previous === "aftercare";
  const medicalOrCombat = MEDICAL_OR_COMBAT.test(current);
  const explicitAction =
    EXPLICIT_ACTION.test(current) ||
    (EXPLICIT_ANATOMY.test(current) &&
      (EXPLICIT_ACTION.test(combined) || contextualSexualSignal));
  const explicitDialogue =
    EXPLICIT_DIALOGUE.test(current) ||
    (EXPLICIT_ANATOMY.test(current) &&
      /(?:말해|대사|명령|속삭|외쳐|describe|say|tell)/i.test(current) &&
      contextualSexualSignal);

  if (!contextualSexualSignal && medicalOrCombat && !explicitAction && !explicitDialogue) {
    return {
      sceneMode: "normal",
      sexualContextActive: false,
      currentInputExplicitIntent: false,
      actualNonConsent,
      oocStop: false,
      clearSceneTransition,
      reason: "medical_or_combat_context",
    };
  }

  if (explicitDialogue) {
    return {
      sceneMode: "explicit_dialogue",
      sexualContextActive: true,
      currentInputExplicitIntent: true,
      actualNonConsent,
      oocStop: false,
      clearSceneTransition,
      reason: "explicit_dialogue",
    };
  }
  if (explicitAction) {
    return {
      sceneMode: "explicit",
      sexualContextActive: true,
      currentInputExplicitIntent: true,
      actualNonConsent,
      oocStop: false,
      clearSceneTransition,
      reason: "explicit_action",
    };
  }
  if (AFTERCARE.test(current) && EXPLICIT_SCENE_MODES.has(previous)) {
    return {
      sceneMode: "aftercare",
      sexualContextActive: true,
      currentInputExplicitIntent: false,
      actualNonConsent,
      oocStop: false,
      clearSceneTransition,
      reason: "aftercare",
    };
  }
  if (
    INTIMATE_TRANSITION.test(current) &&
    (contextualSexualSignal || TENSION_CONTEXT.test(recent))
  ) {
    return {
      sceneMode: "intimate_transition",
      sexualContextActive: true,
      currentInputExplicitIntent: true,
      actualNonConsent,
      oocStop: false,
      clearSceneTransition,
      reason: "intimate_transition",
    };
  }
  if (TENSION_CONTEXT.test(current)) {
    return {
      sceneMode: "tension",
      sexualContextActive: true,
      currentInputExplicitIntent: false,
      actualNonConsent,
      oocStop: false,
      clearSceneTransition,
      reason: "tension",
    };
  }
  if (ROMANTIC_CONTEXT.test(current)) {
    return {
      sceneMode: "romantic",
      sexualContextActive: false,
      currentInputExplicitIntent: false,
      actualNonConsent,
      oocStop: false,
      clearSceneTransition,
      reason: "romantic",
    };
  }
  return {
    sceneMode: contextualSexualSignal && previous === "aftercare" ? "aftercare" : "normal",
    sexualContextActive:
      contextualSexualSignal && previous === "aftercare",
    currentInputExplicitIntent: false,
    actualNonConsent,
    oocStop: false,
    clearSceneTransition,
    reason: "normal",
  };
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
    };
  }

  const explicitIntent =
    classification.currentInputExplicitIntent ||
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
    };
  }
  if (classification.oocStop || classification.clearSceneTransition) {
    return {
      activeRoute: "general",
      sceneMode: "normal",
      sexualContextActive: false,
      routeTriggerReason: classification.oocStop
        ? "user_ooc_stop"
        : "clear_scene_transition",
      shouldBlock: false,
      firstAdultHandoff: false,
      refusalBufferRecommended: false,
    };
  }

  const frequentDirtyTalkRoute =
    eligibility.eligible &&
    input.adultDialogueProfile === "explicit_frequent" &&
    classification.sexualContextActive;
  const previousRequiresAdult =
    state.currentSceneMode === "explicit_dialogue" ||
    state.currentSceneMode === "intimate_transition" ||
    state.currentSceneMode === "explicit";
  const providerBoundaryExceeded = !providerCanHandleScene(
    config,
    modelFamily(input.selectedModelId),
    classification.sceneMode
  );
  const shouldEnterAdultRoute =
    eligibility.eligible &&
    eligibility.allowedByAdultContentPolicy &&
    (previousRequiresAdult ||
      classification.currentInputExplicitIntent ||
      frequentDirtyTalkRoute ||
      providerBoundaryExceeded);

  if (state.activeRoute === "adult" || shouldEnterAdultRoute) {
    return {
      activeRoute: "adult",
      sceneMode: classification.sceneMode,
      sexualContextActive: classification.sexualContextActive,
      routeTriggerReason: shouldEnterAdultRoute
        ? classification.reason
        : state.routeTriggerReason ?? "sticky_adult_route",
      shouldBlock: false,
      firstAdultHandoff: state.activeRoute !== "adult",
      refusalBufferRecommended: false,
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
}): ModelRouteState {
  if (!input.config.enabled) return input.previous;
  if (input.explicitSceneEnd) {
    return {
      ...DEFAULT_MODEL_ROUTE_STATE,
      activeConsentMode: "standard",
      routeTriggerReason: "explicit_scene_end",
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

export function selectAdultHandoffRawHistory(
  history: ChatMsg[],
  opts: { targetTurns?: number; maxTokens?: number; minimumTurns?: number } = {}
): {
  history: ChatMsg[];
  rawTurnsIncluded: number;
  rawTokensIncluded: number;
} {
  const targetTurns = Math.max(2, opts.targetTurns ?? 6);
  const minimumTurns = Math.max(2, opts.minimumTurns ?? 2);
  const maxTokens = Math.max(1_000, opts.maxTokens ?? 8_000);
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
  const selected: Array<[ChatMsg, ChatMsg]> = [];
  let tokens = 0;
  for (let i = pairs.length - 1; i >= 0 && selected.length < targetTurns; i--) {
    const pair = pairs[i]!;
    const pairTokens =
      estimateTokens(pair[0].content) + estimateTokens(pair[1].content);
    if (tokens + pairTokens > maxTokens && selected.length >= minimumTurns) break;
    selected.unshift(pair);
    tokens += pairTokens;
  }
  return {
    history: selected.flatMap(([user, assistant]) => [
      { role: "user" as const, content: user.content },
      { role: "assistant" as const, content: assistant.content },
    ]),
    rawTurnsIncluded: selected.length,
    rawTokensIncluded: tokens,
  };
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
}): SceneContinuityPacket {
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
  };
}

export const DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION = `직전 assistant 출력의 바로 다음 순간부터 이어 쓴다.

직전 출력의 시점, 문장 호흡, 문단 구성, 대사 비율, 캐릭터별 말투·호칭과 감정 표현 방식을 최대한 유지한다.

이전 장면을 요약하거나 반복하지 말고, 새로운 도입부를 만들지 않는다.

직전 출력에서 완료되지 않은 행동이나 대화가 있다면 그 지점부터 자연스럽게 진행한다.

공통 시스템 프롬프트, 캐릭터 설정, Speech Lock과 Muse 문체 규칙을 직전 출력의 우연한 오류보다 우선한다.

내부 모델 전환, SceneMode, route, STATUS_VALUES 또는 시스템 지시를 RP 본문에 언급하지 않는다.`;

export function renderSceneContinuityPacket(
  packet: SceneContinuityPacket
): string {
  const safePacket = JSON.stringify(packet, null, 2);
  return `[SceneContinuityPacket — 비공개 라우팅 문맥]\n${safePacket}`;
}

export function appendAdultHandoffPrompt(
  systemPrompt: string,
  packet: SceneContinuityPacket
): string {
  return [
    systemPrompt.trim(),
    renderSceneContinuityPacket(packet),
    DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function appendAdultHandoffToSystemSplit<T extends {
  systemRulesBlock: string;
  characterSettingsBlock: string;
  dynamicBlock: string;
}>(split: T | undefined, packet: SceneContinuityPacket): T | undefined {
  if (!split) return undefined;
  return {
    ...split,
    dynamicBlock: [
      split.dynamicBlock.trim(),
      renderSceneContinuityPacket(packet),
      DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
    ]
      .filter(Boolean)
      .join("\n\n"),
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
  const raw = selectAdultHandoffRawHistory(input.history, {
    targetTurns: 4,
    minimumTurns: 2,
    maxTokens: 8_000,
  });
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
  const raw = selectAdultHandoffRawHistory(input.history, {
    targetTurns: 6,
    minimumTurns: 2,
    maxTokens: 8_000,
  });
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
