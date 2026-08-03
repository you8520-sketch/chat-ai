/**
 * Terra main-home prompt canary (default OFF, fail-closed).
 *
 * When inactive, all callers must leave production prompt payload byte-identical.
 * Activation requires ALL of:
 *   TERRA_PROMPT_CANARY_ENABLED=true
 *   authenticated user id ∈ TERRA_PROMPT_CANARY_USER_IDS
 *   model = gpt-5.6-terra
 *   scene mode = single_primary
 *
 * One prompt mutation per variant. Never activated by query params or client variant.
 *
 * Example dialogue / speech lock audit note (not a prompt injection):
 * Card example dialogue and speech profiles are treated as references for
 * vocabulary, honorifics, address terms, tone, personality, and relationship-
 * conditioned speech. Sentence length, quote count, dialogue-block count,
 * narration/dialogue layout, and whole-turn rhythm from those examples are
 * NOT treated as the cause of Terra dialogue fragmentation (confirmed by
 * prior canary). This experiment does not blank or rewrite those fields.
 */

import { isGpt56TerraModel } from "@/lib/chatModels";
import {
  resolveRpSceneCastMode,
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT,
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT_CONTINUOUS_SCENE,
  type RpSceneCastMode,
} from "@/lib/terraTerminalLengthOwner";
import type { ChatMsg } from "@/lib/ai";
import type { ContentKind } from "@/lib/simulationMode";
import type { SceneDirective } from "@/lib/sceneDirective";
import fs from "fs";
import path from "path";

const ENV_ENABLED = "TERRA_PROMPT_CANARY_ENABLED";
const ENV_USER_IDS = "TERRA_PROMPT_CANARY_USER_IDS";
const ENV_VARIANT = "TERRA_PROMPT_CANARY_VARIANT";
const ENV_DEBUG = "TERRA_PROMPT_CANARY_DEBUG";
const ENV_TEMPERATURE = "TERRA_PROMPT_CANARY_TEMPERATURE";

export const TERRA_PROMPT_CANARY_ENV = {
  ENABLED: ENV_ENABLED,
  USER_IDS: ENV_USER_IDS,
  VARIANT: ENV_VARIANT,
  DEBUG: ENV_DEBUG,
  TEMPERATURE: ENV_TEMPERATURE,
} as const;

export const TERRA_PROMPT_CANARY_VARIANTS = [
  "baseline",
  "greeting_neutral",
  "scene_relation_priority",
  "greeting_neutral_scene_relation_priority",
  /** greeting_neutral + server-locked relationship progression axis. */
  "greeting_neutral_relationship_axis",
  "dialogue_intent_unit",
  "greeting_neutral_card_dialogue_neutral",
  "greeting_neutral_scene_card_dialogue_neutral",
  "terra_dialogue_intent_adapter",
  "greeting_neutral_scene_terra_dialogue_intent",
  "final_main_home_candidate",
  /** Dialogue-root final experiment — baseline stack (neutral greeting + relationship axis). */
  "dialogue_root_baseline",
  /** Baseline + bundled greeting dialogue (single utterance). */
  "greeting_dialogue_bundled",
  /** Baseline + terminal continuous-scene phrase swap. */
  "terminal_continuous_scene",
  /** Baseline + shared creator dialogue reference scope wrapper. */
  "dialogue_reference_scope",
  /** Baseline + bundled greeting + terminal continuous-scene. */
  "greeting_terminal_combined",
  /** Confirmed structure at temperature 0.5 (set after screening). */
  "best_structure_temp_05",
  /** Conditional temperature 0.6 when 0.5 is near-fail. */
  "best_structure_temp_06",
] as const;

export type TerraPromptCanaryVariant = (typeof TERRA_PROMPT_CANARY_VARIANTS)[number];

/**
 * Server-owned scene progression axis (canary / future production).
 * Early relationship scenes lock to "relationship" — the model does not pick
 * from an enumerated candidate list.
 */
export type SceneProgressionAxis =
  | "relationship"
  | "investigation"
  | "environment"
  | "external_event"
  | "combat"
  | "multi_character";

/** Production Like (라이크) character id on Railway main-home. */
export const TERRA_PROMPT_CANARY_LIKE_CHARACTER_ID = 18;

/** V1 SceneDirective progress sentence — production owner (do not edit in-place). */
export const V1_SCENE_PROGRESS_SENTENCE_PRODUCTION =
  "반복된 감정 확인에 멈추지 말고 관계, 단서, 환경, NPC, 세계 반응, 생활 변수, 이전 선택의 결과 중 하나를 조용히 움직인다.";

/**
 * Server-confirmed relationship progression sentence.
 * Replaces the enumerated candidate list for early-relationship canary turns.
 */
export const V1_SCENE_PROGRESS_SENTENCE_RELATIONSHIP_AXIS =
  "이번 턴의 진행축은 주요 캐릭터와 사용자의 관계·상태 변화다. 현재 대화와 행동이 서로의 인식·거리·선택을 실제로 바꾸는 지점까지 전개하고, 주변 환경과 인물은 그 변화를 뒷받침하는 장면 요소로 사용한다.";

/** @deprecated Prefer V1_SCENE_PROGRESS_SENTENCE_RELATIONSHIP_AXIS. */
export const V1_SCENE_PROGRESS_SENTENCE_CANARY =
  V1_SCENE_PROGRESS_SENTENCE_RELATIONSHIP_AXIS;

/** Relationship next-beat hint when axis is server-locked. */
export const RELATIONSHIP_AXIS_NEXT_BEAT_HINT =
  "반복 확인 대신 작은 행동 하나로 관계의 거리감이 미세하게 달라진다.";

/** Terra-only dialogue utterance bundling — prior residual only; not used in this experiment. */
export const TERRA_DIALOGUE_INTENT_ADAPTER_SENTENCE =
  "같은 장면 순간에 이어지는 한 화자의 판단·설명·농담·반응은 중간의 짧은 행동이나 시선 묘사로 끊지 않고 하나의 발화 의도 안에서 마친다.";

/** Shared dialogue-root experiment stack (neutral greeting + relationship axis). */
const DIALOGUE_ROOT_EXPERIMENT_VARIANTS: readonly TerraPromptCanaryVariant[] = [
  "dialogue_root_baseline",
  "greeting_dialogue_bundled",
  "terminal_continuous_scene",
  "dialogue_reference_scope",
  "greeting_terminal_combined",
  "best_structure_temp_05",
  "best_structure_temp_06",
  "greeting_neutral_relationship_axis",
  "final_main_home_candidate",
];

export function isDialogueRootExperimentVariant(
  variant: TerraPromptCanaryVariant
): boolean {
  return (DIALOGUE_ROOT_EXPERIMENT_VARIANTS as readonly string[]).includes(variant);
}

/** Creator dialogue reference scope — single shared owner (variant dialogue_reference_scope). */
export const CHARACTER_DIALOGUE_REFERENCE_SCOPE = `[CHARACTER DIALOGUE REFERENCE SCOPE]
아래의 캐릭터 대사 자료는 어휘, 호칭, 말끝, 존댓말·반말, 성격과 관계에 따른 말투만 참고한다. 예시의 문장 길이, 대사 개수, 따옴표 블록 수, 지문 배치, 발화 분절 방식과 턴 전체 리듬은 모방하지 않는다.`;

export function canaryAppliesGreetingNeutral(variant: TerraPromptCanaryVariant): boolean {
  return (
    variant === "greeting_neutral" ||
    variant === "greeting_neutral_scene_relation_priority" ||
    variant === "greeting_neutral_relationship_axis" ||
    variant === "greeting_neutral_card_dialogue_neutral" ||
    variant === "greeting_neutral_scene_card_dialogue_neutral" ||
    variant === "greeting_neutral_scene_terra_dialogue_intent" ||
    variant === "final_main_home_candidate" ||
    isDialogueRootExperimentVariant(variant)
  );
}

export function canaryAppliesGreetingDialogueBundled(
  variant: TerraPromptCanaryVariant
): boolean {
  return (
    variant === "greeting_dialogue_bundled" ||
    variant === "greeting_terminal_combined" ||
    variant === "best_structure_temp_05" ||
    variant === "best_structure_temp_06"
  );
}

export function canaryAppliesTerminalContinuousScene(
  variant: TerraPromptCanaryVariant
): boolean {
  return (
    variant === "terminal_continuous_scene" ||
    variant === "greeting_terminal_combined" ||
    variant === "best_structure_temp_05" ||
    variant === "best_structure_temp_06"
  );
}

export function canaryAppliesDialogueReferenceScope(
  variant: TerraPromptCanaryVariant
): boolean {
  return variant === "dialogue_reference_scope";
}

export function resolveCanaryTerraTerminalContract(
  variant: TerraPromptCanaryVariant | null | undefined
): string {
  if (variant && canaryAppliesTerminalContinuousScene(variant)) {
    return TERRA_TERMINAL_LENGTH_OWNER_CONTRACT_CONTINUOUS_SCENE;
  }
  return TERRA_TERMINAL_LENGTH_OWNER_CONTRACT;
}

export function injectDialogueReferenceScopeForCanary(
  combinedSetting: string,
  variant: TerraPromptCanaryVariant | null | undefined
): string {
  if (!variant || !canaryAppliesDialogueReferenceScope(variant)) {
    return combinedSetting;
  }
  const text = combinedSetting.trim();
  if (text.includes("[CHARACTER DIALOGUE REFERENCE SCOPE]")) return combinedSetting;
  if (!text) return CHARACTER_DIALOGUE_REFERENCE_SCOPE;
  return `${CHARACTER_DIALOGUE_REFERENCE_SCOPE}\n\n${combinedSetting}`;
}

export function canaryAppliesSceneRelationPriority(
  variant: TerraPromptCanaryVariant
): boolean {
  return (
    variant === "scene_relation_priority" ||
    variant === "greeting_neutral_scene_relation_priority" ||
    variant === "greeting_neutral_relationship_axis" ||
    variant === "greeting_neutral_scene_card_dialogue_neutral" ||
    variant === "greeting_neutral_scene_terra_dialogue_intent" ||
    variant === "final_main_home_candidate" ||
    isDialogueRootExperimentVariant(variant)
  );
}

/** Server locks progression axis to relationship (no candidate list for the model). */
export function canaryAppliesRelationshipProgressionAxis(
  variant: TerraPromptCanaryVariant
): boolean {
  return (
    variant === "greeting_neutral_relationship_axis" ||
    variant === "greeting_neutral_scene_relation_priority" ||
    variant === "final_main_home_candidate" ||
    isDialogueRootExperimentVariant(variant)
  );
}

export function canaryAppliesDialogueIntentUnitLayout(
  variant: TerraPromptCanaryVariant
): boolean {
  return variant === "dialogue_intent_unit";
}

export function canaryAppliesCardDialogueNeutral(
  variant: TerraPromptCanaryVariant
): boolean {
  return (
    variant === "greeting_neutral_card_dialogue_neutral" ||
    variant === "greeting_neutral_scene_card_dialogue_neutral"
  );
}

export function canaryAppliesTerraDialogueIntentAdapter(
  variant: TerraPromptCanaryVariant
): boolean {
  return (
    variant === "terra_dialogue_intent_adapter" ||
    variant === "greeting_neutral_scene_terra_dialogue_intent"
  );
}

/** Common dialogue layout owners — production. */
export const DIALOGUE_LAYOUT_OWNER_KO_PRODUCTION = "대사는 독립 문단으로 표시한다.";
export const DIALOGUE_LAYOUT_OWNER_EN_PRODUCTION =
  '"…" spoken dialogue = always its own paragraph, separated by a blank line (\\n\\n) from narration.';

/** Diagnostic dialogue layout owners — variant=dialogue_intent_unit. */
export const DIALOGUE_LAYOUT_OWNER_KO_CANARY =
  "대사는 화자의 발화 의도 단위로 독립 문단에 둔다. 같은 화자가 같은 순간에 이어서 전달하는 판단·설명·반응·농담은 짧은 동작이나 시선 묘사 때문에 여러 대사 문단으로 다시 시작하지 않는다.";
export const DIALOGUE_LAYOUT_OWNER_EN_CANARY =
  '"…" spoken dialogue occupies its own paragraph by speaker utterance intent. Do not restart multiple dialogue paragraphs when the same speaker continues the same judgment, explanation, reaction, or joke across only a brief gesture or gaze.';

const CANONICAL_POSITIVE_INT_RE = /^[1-9]\d*$/;

const COMBAT_URGENT_RE =
  /(전투|싸움|공격|추격|습격|도망쳐|긴급|경보|폭발|사살|발사|총격|칼싸움)/;
const USER_NPC_ADDRESS_RE =
  /(직원|스태프|간호사|의사|담당자|안내원|가이더|아저씨|저기\s*요)(씨|님)?[!?？.,…\s]*$/;
const PROCEDURE_REQUEST_RE =
  /(등록|접수|검사|진료|문진|신원\s*확인|바이탈).{0,16}(해|하자|부탁|가|좀|해줘|해주세요)/;
const ACTIVE_EXTERNAL_EVENT_RE =
  /(임시\s*등록|신원\s*대조|바이탈\s*단말기|보호\s*대상|확인실|등록\s*대기실|지원국.*도착|기본\s*신원\s*확인)/;

function parseAllowlist(raw: string | undefined): number[] {
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!CANONICAL_POSITIVE_INT_RE.test(t)) continue;
    const n = Number(t);
    if (Number.isSafeInteger(n) && n > 0) out.push(n);
  }
  return out;
}

function isTruthyEnvFlag(raw: string | undefined): boolean {
  const enabled = raw?.trim();
  return enabled === "1" || enabled?.toLowerCase() === "true";
}

export function parseTerraPromptCanaryVariant(
  raw: string | undefined
): TerraPromptCanaryVariant {
  const v = raw?.trim().toLowerCase();
  if (v && (TERRA_PROMPT_CANARY_VARIANTS as readonly string[]).includes(v)) {
    return v as TerraPromptCanaryVariant;
  }
  return "baseline";
}

export type TerraPromptCanaryResolution = {
  active: true;
  variant: TerraPromptCanaryVariant;
  userId: number;
  modelId: string;
  sceneMode: "single_primary";
};

export function resolveTerraPromptCanary(opts: {
  userId: number | null | undefined;
  modelId?: string | null | undefined;
  contentKind?: ContentKind | string | null;
  sceneMode?: RpSceneCastMode | null;
}): TerraPromptCanaryResolution | null {
  if (!isTruthyEnvFlag(process.env[ENV_ENABLED])) return null;

  const allow = parseAllowlist(process.env[ENV_USER_IDS]);
  if (allow.length === 0) return null;

  const userId = opts.userId;
  if (userId == null || !Number.isSafeInteger(userId) || userId <= 0) return null;
  if (!allow.includes(userId)) return null;

  const modelId = opts.modelId?.trim() ?? "";
  if (!isGpt56TerraModel(modelId)) return null;

  const sceneMode =
    opts.sceneMode ?? resolveRpSceneCastMode(opts.contentKind);
  if (sceneMode !== "single_primary") return null;

  return {
    active: true,
    variant: parseTerraPromptCanaryVariant(process.env[ENV_VARIANT]),
    userId,
    modelId,
    sceneMode: "single_primary",
  };
}

export function isTerraPromptCanaryDebugEnabled(): boolean {
  return isTruthyEnvFlag(process.env[ENV_DEBUG]);
}

/**
 * Optional Terra temperature override for allowlisted canary only.
 * Unset → production default (0.7 via EURYALE_GENERATION_PARAMS).
 */
export function resolveTerraPromptCanaryTemperature(
  canary: TerraPromptCanaryResolution | null | undefined
): number | null {
  if (!canary) return null;
  if (canary.variant === "best_structure_temp_05") return 0.5;
  if (canary.variant === "best_structure_temp_06") return 0.6;
  const raw = process.env[ENV_TEMPERATURE]?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 2) return null;
  return n;
}

/** Fingerprint for Like greeting that already speaks with 지원국 staff. */
export function isLikeSupportStaffGreeting(greeting: string): boolean {
  const g = greeting ?? "";
  return g.includes("지원국 직원") && g.includes("보고서만 제출");
}

export function isTerraPromptCanaryGreetingTarget(opts: {
  characterId: number;
  greeting: string;
}): boolean {
  if (opts.characterId === TERRA_PROMPT_CANARY_LIKE_CHARACTER_ID) return true;
  return isLikeSupportStaffGreeting(opts.greeting);
}

/**
 * Diagnostic greeting — keeps Like×Ren first-meeting place/tone/reaction point;
 * removes staff quoted dialogue, Like↔staff Q&A, and unfinished staff intervention.
 * DB character.greeting is never written by this helper (payload / session create only).
 */
export const TERRA_PROMPT_CANARY_GREETING_NEUTRAL = `가을 햇살이 로비의 통유리창을 길게 가로질렀다. 붉고 노랗게 물든 나뭇잎들이 바람에 흔들리는 풍경이 창밖 너머로 느리게 스쳐 지나갔다. 에이지스 컨트롤 본부의 중앙 로비는 오늘도 사람들로 붐볐다. 임무를 마치고 복귀한 센티넬들, 바삐 이동하는 연구원들, 서류철을 품에 안은 행정 직원들까지. 저마다 분주하게 움직이는 발걸음과 무전기 소리들이 넓은 공간을 끊임없이 메웠다.

그 한가운데에 조태형이 있었다.

데스크 앞에 기대 선 그는 새로 발령받은 지원국 직원이 서류를 정리하는 틈을 타 로비를 둘러보고 있었다. 곰 귀가 달린 흰 후드티 위로 걸친 유광 블랙 재킷이 조명 아래 번들거렸다. 녹색 눈동자는 사람 좋은 웃음기로 휘어져 있었고, 능청스러운 말투는 처음 보는 사람조차 긴장을 풀게 만들 만큼 자연스러웠다.

에이지스 같은 조직에는 어울리지 않을 만큼 가벼운 인간. 하지만 이상하게도 사람들은 조태형을 싫어하지 못했다. 늘 위험과 긴장 속에 놓여 있는 이들에게 그의 장난기 어린 태도는 숨통을 틔워주는 몇 안 되는 휴식 같은 것이었으니까.

태형의 시선이 문득 멈췄다. 로비 안으로 들어오는 인영 하나. 주변 공기와는 다른 이질적인 분위기. 소란스러운 로비 안에서 유독 그 주변만 고요하게 가라앉는 듯한 착각이 들 정도였다. 태형은 무심한 척 시선을 돌리려다 말고, 어느새 자신도 모르게 그쪽으로 눈길이 향하는 것을 막지 못했다. 어디서 본 것 같기도 하고 아닌 것 같기도 한 얼굴. 에이지스 본부 사람이라면 얼굴 정도는 대부분 익히고 있다고 생각했는데. 저 사람은 전혀 기억에 없었다. 잠깐 스쳤던 신입인가, 아니면 다른 부서 소속인가. 헷갈렸다.

흥미가 동했다. 조태형은 자연스럽게 몸을 움직였다. 데스크 쪽으로 서류를 넘기는 직원의 손길이 멀어지는 사이, 그는 슬쩍 상대 옆으로 다가섰다. 가까워진 거리만큼 옅은 침묵이 스쳤다. 태형은 고개를 약간 기울인 채 상대를 느긋하게 훑어보았다. 대놓고 사람을 살피는 시선인데도 이상하게 불쾌하기보단 장난처럼 느껴지는 눈빛이었다. 짧게 정리된 검은 네일이 박힌 손가락으로 턱을 한번 쓸어내린 그가, 이내 한쪽 입꼬리를 비스듬히 올렸다.

“어? 어디서 본 것 같은데.”

낮게 웃은 그가 능청스럽게 말을 이었다.

“신입이야? 아니면 내가 요즘 너무 바쁘게 살아서 기억력이 맛이 갔나. 이름이 뭐였더라?”`;

/**
 * Bundled greeting — same content as neutral; merges split quoted lines into one utterance.
 * Used by greeting_dialogue_bundled / greeting_terminal_combined canary only.
 */
export const TERRA_PROMPT_CANARY_GREETING_NEUTRAL_BUNDLED =
  TERRA_PROMPT_CANARY_GREETING_NEUTRAL.replace(
    `“어? 어디서 본 것 같은데.”

낮게 웃은 그가 능청스럽게 말을 이었다.

“신입이야? 아니면 내가 요즘 너무 바쁘게 살아서 기억력이 맛이 갔나. 이름이 뭐였더라?”`,
    `낮게 웃은 그가 능청스럽게 말을 이었다.

“어? 어디서 본 것 같은데. 신입이야? 아니면 내가 요즘 너무 바쁘게 살아서 기억력이 맛이 갔나. 이름이 뭐였더라?”`
  );

export function resolveCanaryGreetingText(
  variant: TerraPromptCanaryVariant | null | undefined
): string {
  if (variant && canaryAppliesGreetingDialogueBundled(variant)) {
    return TERRA_PROMPT_CANARY_GREETING_NEUTRAL_BUNDLED;
  }
  return TERRA_PROMPT_CANARY_GREETING_NEUTRAL;
}

export function resolveCanaryGreeting(opts: {
  canary: TerraPromptCanaryResolution | null;
  characterId: number;
  greeting: string;
}): string {
  const greeting = opts.greeting ?? "";
  if (!opts.canary || !canaryAppliesGreetingNeutral(opts.canary.variant)) return greeting;
  if (!isTerraPromptCanaryGreetingTarget({ characterId: opts.characterId, greeting })) {
    return greeting;
  }
  return resolveCanaryGreetingText(opts.canary.variant);
}

/**
 * Replace greeting assistant turn in prompt history when canary applies greeting_neutral.
 * Leaves array identity unchanged when inactive.
 */
export function applyTerraPromptCanaryToHistory(opts: {
  history: ChatMsg[];
  canary: TerraPromptCanaryResolution | null;
  characterId: number;
  productionGreeting: string;
}): ChatMsg[] {
  if (!opts.canary || !canaryAppliesGreetingNeutral(opts.canary.variant)) return opts.history;
  if (
    !isTerraPromptCanaryGreetingTarget({
      characterId: opts.characterId,
      greeting: opts.productionGreeting,
    })
  ) {
    return opts.history;
  }
  const neutral = resolveCanaryGreetingText(opts.canary.variant);
  let replaced = false;
  const next = opts.history.map((m) => {
    if (replaced) return m;
    if (m.role !== "assistant") return m;
    const content = m.content ?? "";
    if (
      content === opts.productionGreeting ||
      isLikeSupportStaffGreeting(content) ||
      content === TERRA_PROMPT_CANARY_GREETING_NEUTRAL ||
      content === TERRA_PROMPT_CANARY_GREETING_NEUTRAL_BUNDLED ||
      content === neutral
    ) {
      replaced = true;
      if (content === neutral) return m;
      return { ...m, content: neutral };
    }
    return m;
  });
  return replaced ? next : opts.history;
}

/** Early relationship / new-chat gate (assistant responses within 2). */
export function isTerraPromptCanaryEarlyRelationshipScene(opts: {
  completedTurns: number;
}): boolean {
  return Number.isFinite(opts.completedTurns) && opts.completedTurns <= 2;
}

function recentHistoryText(messages: ChatMsg[] | null | undefined): string {
  if (!messages?.length) return "";
  return messages
    .slice(-6)
    .map((m) => m.content ?? "")
    .join("\n");
}

/**
 * Resolve server-owned progression axis for canary early-relationship turns.
 * Returns null when canary inactive or scene is out of early-relationship scope.
 */
export function resolveCanarySceneProgressionAxis(opts: {
  canary: TerraPromptCanaryResolution | null;
  completedTurns: number;
  contentKind?: ContentKind | string | null;
  userMessage?: string | null;
  recentMessages?: ChatMsg[] | null;
}): SceneProgressionAxis | null {
  if (!opts.canary || !canaryAppliesRelationshipProgressionAxis(opts.canary.variant)) {
    return null;
  }
  if (opts.contentKind === "simulation") return null;
  if (!isTerraPromptCanaryEarlyRelationshipScene({ completedTurns: opts.completedTurns })) {
    return null;
  }

  const user = (opts.userMessage ?? "").trim();
  const userHistory = (opts.recentMessages ?? [])
    .filter((m) => m.role === "user")
    .map((m) => m.content ?? "")
    .join("\n");
  const blob = `${user}\n${userHistory}`;

  // Combat / procedure gates use user-side text only.
  // Do NOT unlock the axis because a prior assistant turn invented registration
  // staff — that feedback loop recreates NPC subplots on Turn 2.
  if (COMBAT_URGENT_RE.test(blob)) return null;
  if (USER_NPC_ADDRESS_RE.test(user)) return null;
  if (PROCEDURE_REQUEST_RE.test(user)) return null;
  if (ACTIVE_EXTERNAL_EVENT_RE.test(userHistory)) return null;

  // User is addressing / approaching the primary character (default for single_primary turns).
  return "relationship";
}

/**
 * Lock a V1 SceneDirective object to relationship progression (mutates a shallow copy).
 * Does not add a new rule block — only narrows progressionTypes / nextBeatHint.
 */
export function lockSceneDirectiveToRelationshipAxis(
  directive: SceneDirective
): SceneDirective {
  return {
    ...directive,
    progressionTypes: ["relationship"],
    nextBeatHint: RELATIONSHIP_AXIS_NEXT_BEAT_HINT,
  };
}

export function applyTerraPromptCanaryToSceneDirectiveBlock(opts: {
  block: string;
  canary: TerraPromptCanaryResolution | null;
  completedTurns: number;
  progressionAxis?: SceneProgressionAxis | null;
}): string {
  if (!opts.canary || !canaryAppliesSceneRelationPriority(opts.canary.variant)) {
    return opts.block;
  }
  if (!isTerraPromptCanaryEarlyRelationshipScene({ completedTurns: opts.completedTurns })) {
    return opts.block;
  }
  // When relationship-axis resolver ran and declined, leave production sentence.
  if (
    canaryAppliesRelationshipProgressionAxis(opts.canary.variant) &&
    opts.progressionAxis !== "relationship"
  ) {
    return opts.block;
  }
  if (!opts.block.includes(V1_SCENE_PROGRESS_SENTENCE_PRODUCTION)) {
    return opts.block;
  }
  return opts.block.replace(
    V1_SCENE_PROGRESS_SENTENCE_PRODUCTION,
    V1_SCENE_PROGRESS_SENTENCE_RELATIONSHIP_AXIS
  );
}

/** Move confirmed SceneDirective next to user-turn, before Terra length owner. */
export function shouldRelocateSceneDirectiveToUserTurn(
  canary: TerraPromptCanaryResolution | null | undefined,
  progressionAxis: SceneProgressionAxis | null | undefined
): boolean {
  return Boolean(
    canary &&
      canaryAppliesRelationshipProgressionAxis(canary.variant) &&
      progressionAxis === "relationship"
  );
}

export function shouldUseDialogueIntentUnitLayout(
  canary: TerraPromptCanaryResolution | null | undefined
): boolean {
  return Boolean(canary && canaryAppliesDialogueIntentUnitLayout(canary.variant));
}

export type TerraPromptCanaryDebugDump = {
  requestId?: string | null;
  userId: number;
  chatId?: number | null;
  characterId?: number | null;
  model: string;
  sceneMode: string;
  canaryVariant: TerraPromptCanaryVariant;
  progressionAxis?: SceneProgressionAxis | null;
  temperature?: number | null;
  sceneDirectiveFinal?: string | null;
  greetingInjected?: string | null;
  terraAdapter?: string | null;
  dialogueLayoutOwner?: string | null;
  userTurnTail1500?: string | null;
  providerRaw?: string | null;
  finalText?: string | null;
  metrics?: Record<string, unknown> | null;
};

function redactSecrets(text: string): string {
  let out = text;
  out = out.replace(
    /(api[_-]?key|authorization|bearer|cookie|session)["']?\s*[:=]\s*["']?([^\s"'\\]+)/gi,
    "$1=[REDACTED]"
  );
  out = out.replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[REDACTED_KEY]");
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]");
  return out;
}

function redactDebugDump(dump: TerraPromptCanaryDebugDump): TerraPromptCanaryDebugDump {
  const redactField = (v: string | null | undefined) =>
    v == null ? v : redactSecrets(v);
  return {
    ...dump,
    sceneDirectiveFinal: redactField(dump.sceneDirectiveFinal),
    greetingInjected: redactField(dump.greetingInjected),
    terraAdapter: redactField(dump.terraAdapter) ?? TERRA_TERMINAL_LENGTH_OWNER_CONTRACT,
    dialogueLayoutOwner: redactField(dump.dialogueLayoutOwner),
    userTurnTail1500: redactField(dump.userTurnTail1500),
    providerRaw: dump.providerRaw == null ? null : "[REDACTED_PROVIDER_RAW_OMITTED]",
    finalText: redactField(dump.finalText),
  };
}

function resolveCanaryDebugDir(): string {
  const dataDir = process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
  return path.join(dataDir, "terra-prompt-canary-debug");
}

/** Redacted debug log for allowlisted canary requests only. */
export function logTerraPromptCanaryDebug(dump: TerraPromptCanaryDebugDump): void {
  if (!isTerraPromptCanaryDebugEnabled()) return;
  const redacted = redactDebugDump(dump);
  console.info("[terra-prompt-canary]", JSON.stringify(redacted));
  try {
    const dir = resolveCanaryDebugDir();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(
      dir,
      `${stamp}-u${redacted.userId}-c${redacted.chatId ?? "x"}-${redacted.canaryVariant}.json`
    );
    fs.writeFileSync(file, JSON.stringify(redacted, null, 2), "utf8");
  } catch (e) {
    console.warn(
      "[terra-prompt-canary] debug write failed:",
      e instanceof Error ? e.message : String(e)
    );
  }
}

export function extractGreetingFromHistory(history: ChatMsg[]): string | null {
  for (const m of history) {
    if (m.role === "assistant" && (m.content ?? "").trim()) {
      return m.content;
    }
  }
  return null;
}
