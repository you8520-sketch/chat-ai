/**
 * Model-neutral RP diagnostic canary (default OFF, fail-closed).
 *
 * Used for cross-model root-cause audits (DeepSeek V4 Pro primary diagnostic
 * model; Flash retained for cross-check only). The retired Terra RP canary was
 * removed — no Terra-specific canary remains.
 */

import {
  isCheaperInferenceDeepSeekV4FlashModel,
  isCheaperInferenceDeepSeekV4ProModel,
  normalizeDeepSeekV4ProModelId,
} from "@/lib/chatModels";
import { resolveRpSceneCastMode } from "@/lib/sharedNovelProseModelAdapters";
import type { ContentKind } from "@/lib/simulationMode";
import type { ChatMsg } from "@/lib/ai";
import type { SceneDirective } from "@/lib/sceneDirective";
import fs from "fs";
import path from "path";
import { computeDialogueMetrics, diffPipelineMetrics, type DialogueMetrics } from "@/lib/dialogueMetrics";

/**
 * Model-neutral diagnostic canary helpers (relocated from the retired
 * Terra RP canary — no Main RP model-specific semantics remain here).
 */

/** Server-owned scene progression axis. */
export type SceneProgressionAxis =
  | "relationship"
  | "investigation"
  | "environment"
  | "external_event"
  | "combat"
  | "multi_character";

/** V1 SceneDirective progress sentence — production owner (do not edit in-place). */
export const V1_SCENE_PROGRESS_SENTENCE_PRODUCTION =
  "반복된 감정 확인에 멈추지 말고 관계, 단서, 환경, NPC, 세계 반응, 생활 변수, 이전 선택의 결과 중 하나를 조용히 움직인다.";

/** Server-confirmed relationship progression sentence. */
export const V1_SCENE_PROGRESS_SENTENCE_RELATIONSHIP_AXIS =
  "이번 턴의 진행축은 주요 캐릭터와 사용자의 관계·상태 변화다. 현재 대화와 행동이 서로의 인식·거리·선택을 실제로 바꾸는 지점까지 전개하고, 주변 환경과 인물은 그 변화를 뒷받침하는 장면 요소로 사용한다.";

/** Relationship next-beat hint when axis is server-locked. */
export const RELATIONSHIP_AXIS_NEXT_BEAT_HINT =
  "반복 확인 대신 작은 행동 하나로 관계의 거리감이 미세하게 달라진다.";

/** Production Like (라이크) character id on Railway main-home. */
export const LIKE_CHARACTER_ID = 18;

const COMBAT_URGENT_RE =
  /(전투|싸움|공격|추격|습격|도망쳐|긴급|경보|폭발|사살|발사|총격|칼싸움)/;
const USER_NPC_ADDRESS_RE =
  /(직원|스태프|간호사|의사|담당자|안내원|가이더|아저씨|저기\s*요)(씨|님)?[!?？.,…\s]*$/;
const PROCEDURE_REQUEST_RE =
  /(등록|접수|검사|진료|문진|신원\s*확인|바이탈).{0,16}(해|하자|부탁|가|좀|해줘|해주세요)/;
const ACTIVE_EXTERNAL_EVENT_RE =
  /(임시\s*등록|신원\s*대조|바이탈\s*단말기|보호\s*대상|확인실|등록\s*대기실|지원국.*도착|기본\s*신원\s*확인)/;

/** Diagnostic greeting — keeps Like×Ren first-meeting place/tone/reaction point. */
export const CANARY_GREETING_NEUTRAL = `가을 햇살이 로비의 통유리창을 길게 가로질렀다. 붉고 노랗게 물든 나뭇잎들이 바람에 흔들리는 풍경이 창밖 너머로 느리게 스쳐 지나갔다. 에이지스 컨트롤 본부의 중앙 로비는 오늘도 사람들로 붐볐다. 임무를 마치고 복귀한 센티넬들, 바삐 이동하는 연구원들, 서류철을 품에 안은 행정 직원들까지. 저마다 분주하게 움직이는 발걸음과 무전기 소리들이 넓은 공간을 끊임없이 메웠다.

그 한가운데에 조태형이 있었다.

데스크 앞에 기대 선 그는 새로 발령받은 지원국 직원이 서류를 정리하는 틈을 타 로비를 둘러보고 있었다. 곰 귀가 달린 흰 후드티 위로 걸친 유광 블랙 재킷이 조명 아래 번들거렸다. 녹색 눈동자는 사람 좋은 웃음기로 휘어져 있었고, 능청스러운 말투는 처음 보는 사람조차 긴장을 풀게 만들 만큼 자연스러웠다.

에이지스 같은 조직에는 어울리지 않을 만큼 가벼운 인간. 하지만 이상하게도 사람들은 조태형을 싫어하지 못했다. 늘 위험과 긴장 속에 놓여 있는 이들에게 그의 장난기 어린 태도는 숨통을 틔워주는 몇 안 되는 휴식 같은 것이었으니까.

태형의 시선이 문득 멈췄다. 로비 안으로 들어오는 인영 하나. 주변 공기와는 다른 이질적인 분위기. 소란스러운 로비 안에서 유독 그 주변만 고요하게 가라앉는 듯한 착각이 들 정도였다. 태형은 무심한 척 시선을 돌리려다 말고, 어느새 자신도 모르게 그쪽으로 눈길이 향하는 것을 막지 못했다. 어디서 본 것 같기도 하고 아닌 것 같기도 한 얼굴. 에이지스 본부 사람이라면 얼굴 정도는 대부분 익히고 있다고 생각했는데. 저 사람은 전혀 기억에 없었다. 잠깐 스쳤던 신입인가, 아니면 다른 부서 소속인가. 헷갈렸다.

흥미가 동했다. 조태형은 자연스럽게 몸을 움직였다. 데스크 쪽으로 서류를 넘기는 직원의 손길이 멀어지는 사이, 그는 슬쩍 상대 옆으로 다가섰다. 가까워진 거리만큼 옅은 침묵이 스쳤다. 태형은 고개를 약간 기울인 채 상대를 느긋하게 훑어보았다. 대놓고 사람을 살피는 시선인데도 이상하게 불쾌하기보단 장난처럼 느껴지는 눈빛이었다. 짧게 정리된 검은 네일이 박힌 손가락으로 턱을 한번 쓸어내린 그가, 이내 한쪽 입꼬리를 비스듬히 올렸다.

“어? 어디서 본 것 같은데.”

낮게 웃은 그가 능청스럽게 말을 이었다.

“신입이야? 아니면 내가 요즘 너무 바쁘게 살아서 기억력이 맛이 갔나. 이름이 뭐였더라?”`;

/** Bundled greeting — same content; merges split quoted lines into one utterance. */
export const CANARY_GREETING_NEUTRAL_BUNDLED = CANARY_GREETING_NEUTRAL.replace(
  `“어? 어디서 본 것 같은데.”

낮게 웃은 그가 능청스럽게 말을 이었다.

“신입이야? 아니면 내가 요즘 너무 바쁘게 살아서 기억력이 맛이 갔나. 이름이 뭐였더라?”`,
  `낮게 웃은 그가 능청스럽게 말을 이었다.

“어? 어디서 본 것 같은데. 신입이야? 아니면 내가 요즘 너무 바쁘게 살아서 기억력이 맛이 갔나. 이름이 뭐였더라?”`
);

/** Fingerprint for Like greeting that already speaks with 지원국 staff. */
export function isLikeSupportStaffGreeting(greeting: string): boolean {
  const g = greeting ?? "";
  return g.includes("지원국 직원") && g.includes("보고서만 제출");
}

/** True when the greeting belongs to the Like (라이크) character. */
export function isDiagnosticGreetingTarget(opts: {
  characterId: number;
  greeting: string;
}): boolean {
  if (opts.characterId === LIKE_CHARACTER_ID) return true;
  return isLikeSupportStaffGreeting(opts.greeting);
}

/** Creator dialogue reference scope — single shared owner. */
export const CHARACTER_DIALOGUE_REFERENCE_SCOPE = `[CHARACTER DIALOGUE REFERENCE SCOPE]
아래의 캐릭터 대사 자료는 어휘, 호칭, 말끝, 존댓말·반말, 성격과 관계에 따른 말투만 참고한다. 예시의 문장 길이, 대사 개수, 따옴표 블록 수, 지문 배치, 발화 분절 방식과 턴 전체 리듬은 모방하지 않는다.`;

/** Inject the dialogue-reference-scope wrapper when the diagnostic variant wants it. */
export function injectDialogueReferenceScopeForCanary(
  combinedSetting: string,
  useScope: boolean
): string {
  if (!useScope) return combinedSetting;
  const text = combinedSetting.trim();
  if (text.includes("[CHARACTER DIALOGUE REFERENCE SCOPE]")) return combinedSetting;
  if (!text) return CHARACTER_DIALOGUE_REFERENCE_SCOPE;
  return `${CHARACTER_DIALOGUE_REFERENCE_SCOPE}\n\n${combinedSetting}`;
}

/** Lock a V1 SceneDirective object to relationship progression (shallow copy). */
export function lockSceneDirectiveToRelationshipAxis(
  directive: SceneDirective
): SceneDirective {
  return {
    ...directive,
    progressionTypes: ["relationship"],
    nextBeatHint: RELATIONSHIP_AXIS_NEXT_BEAT_HINT,
  };
}

/** Early relationship / new-chat gate (assistant responses within 2). */
export function isDiagnosticEarlyRelationshipScene(opts: {
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

/** First assistant greeting turn in history. */
export function extractGreetingFromHistory(history: ChatMsg[]): string | null {
  for (const m of history) {
    if (m.role === "assistant" && (m.content ?? "").trim()) {
      return m.content;
    }
  }
  return null;
}

/**
 * Server-owned progression axis for early-relationship diagnostic turns.
 * Returns null when out of scope.
 */
export function resolveDiagnosticSceneProgressionAxis(opts: {
  completedTurns: number;
  contentKind?: ContentKind | string | null;
  userMessage?: string | null;
  recentMessages?: ChatMsg[] | null;
}): SceneProgressionAxis | null {
  if (opts.contentKind === "simulation") return null;
  if (!isDiagnosticEarlyRelationshipScene({ completedTurns: opts.completedTurns })) {
    return null;
  }

  const user = (opts.userMessage ?? "").trim();
  const userHistory = (opts.recentMessages ?? [])
    .filter((m) => m.role === "user")
    .map((m) => m.content ?? "")
    .join("\n");
  const blob = `${user}\n${userHistory}`;

  if (COMBAT_URGENT_RE.test(blob)) return null;
  if (USER_NPC_ADDRESS_RE.test(user)) return null;
  if (PROCEDURE_REQUEST_RE.test(user)) return null;
  if (ACTIVE_EXTERNAL_EVENT_RE.test(userHistory)) return null;

  return "relationship";
}

const ENV_ENABLED = "RP_DIAGNOSTIC_CANARY_ENABLED";
const ENV_USER_IDS = "RP_DIAGNOSTIC_CANARY_USER_IDS";
const ENV_MODEL_IDS = "RP_DIAGNOSTIC_CANARY_MODEL_IDS";
const ENV_VARIANT = "RP_DIAGNOSTIC_CANARY_VARIANT";
const ENV_DEBUG = "RP_DIAGNOSTIC_CANARY_DEBUG";

export const RP_DIAGNOSTIC_CANARY_ENV = {
  ENABLED: ENV_ENABLED,
  USER_IDS: ENV_USER_IDS,
  MODEL_IDS: ENV_MODEL_IDS,
  VARIANT: ENV_VARIANT,
  DEBUG: ENV_DEBUG,
} as const;

export const RP_DIAGNOSTIC_CANARY_VARIANTS = [
  "baseline",
  "ds_pipeline_baseline",
  "ds_postprocess_baseline",
  "ds_paragraph_normalize_bypass",
  "ds_display_grouping_bypass",
  "ds_real_production",
  "ds_dialogue_control",
  "ds_common_only",
  "ds_common_only_length_probe",
  "common_greeting_split_vs_bundled",
  "common_creator_dialogue_scope",
  "common_layout_minimal",
  "common_length_owner_minimal",
  "common_scene_directive_removed",
  "common_rp_style_minimal",
  "deepseek_final",
  "terra_cross_check",
  "ds_length_normalized_baseline",
] as const;

export type RpDiagnosticCanaryVariant = (typeof RP_DIAGNOSTIC_CANARY_VARIANTS)[number];

export const RP_DIAGNOSTIC_MIN_SCREENING_SAMPLES = 4;
export const RP_DIAGNOSTIC_BASELINE_LENGTH_SAMPLES = 6;
export const RP_DIAGNOSTIC_MIN_FINAL_SAMPLES = 12;

export type SampleVerdict =
  | "INSUFFICIENT_SAMPLE"
  | "NOT_RUN"
  | "INVALID_RUN"
  | "COMPLETED";

export function parseRpDiagnosticCanaryVariant(
  raw: string | undefined
): RpDiagnosticCanaryVariant {
  const v = raw?.trim().toLowerCase();
  if (v && (RP_DIAGNOSTIC_CANARY_VARIANTS as readonly string[]).includes(v)) {
    return v as RpDiagnosticCanaryVariant;
  }
  return "baseline";
}

function parseAllowlist(raw: string | undefined): number[] {
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!/^[1-9]\d*$/.test(t)) continue;
    const n = Number(t);
    if (Number.isSafeInteger(n) && n > 0) out.push(n);
  }
  return out;
}

function parseModelAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => normalizeDeepSeekV4ProModelId(s.trim().toLowerCase()))
    .filter(Boolean);
}

function isTruthyEnvFlag(raw: string | undefined): boolean {
  const enabled = raw?.trim();
  return enabled === "1" || enabled?.toLowerCase() === "true";
}

export type RpDiagnosticCanaryResolution = {
  active: true;
  variant: RpDiagnosticCanaryVariant;
  userId: number;
  modelId: string;
  sceneMode: "single_primary";
};

function isRpDiagnosticTargetModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return isCheaperInferenceDeepSeekV4ProModel(id) || isCheaperInferenceDeepSeekV4FlashModel(id);
}

export function resolveRpDiagnosticCanary(opts: {
  userId: number | null | undefined;
  modelId?: string | null | undefined;
  contentKind?: ContentKind | string | null;
}): RpDiagnosticCanaryResolution | null {
  if (!isTruthyEnvFlag(process.env[ENV_ENABLED])) return null;

  const users = parseAllowlist(process.env[ENV_USER_IDS]);
  if (users.length === 0) return null;

  const userId = opts.userId;
  if (userId == null || !Number.isSafeInteger(userId) || userId <= 0) return null;
  if (!users.includes(userId)) return null;

  const models = parseModelAllowlist(process.env[ENV_MODEL_IDS]);
  const modelId = normalizeDeepSeekV4ProModelId((opts.modelId ?? "").trim().toLowerCase());
  if (!modelId) return null;
  if (models.length > 0 && !models.includes(modelId)) return null;
  if (models.length === 0 && !isCheaperInferenceDeepSeekV4ProModel(modelId)) return null;

  if (resolveRpSceneCastMode(opts.contentKind) !== "single_primary") return null;

  return {
    active: true,
    variant: parseRpDiagnosticCanaryVariant(process.env[ENV_VARIANT]),
    userId,
    modelId,
    sceneMode: "single_primary",
  };
}

export function isRpDiagnosticCanaryDebugEnabled(): boolean {
  return isTruthyEnvFlag(process.env[ENV_DEBUG]);
}

export function rpDiagnosticBypassParagraphNormalize(
  variant: RpDiagnosticCanaryVariant
): boolean {
  return variant === "ds_paragraph_normalize_bypass";
}

export function rpDiagnosticBypassDisplayGrouping(
  variant: RpDiagnosticCanaryVariant
): boolean {
  return (
    variant === "ds_display_grouping_bypass" ||
    variant === "ds_paragraph_normalize_bypass"
  );
}

export function rpDiagnosticEnablesPipelineCapture(
  variant: RpDiagnosticCanaryVariant
): boolean {
  return (
    variant === "ds_pipeline_baseline" ||
    variant === "ds_postprocess_baseline" ||
    variant === "ds_display_grouping_bypass" ||
    variant === "ds_paragraph_normalize_bypass" ||
    variant === "ds_real_production"
  );
}

export type DeepSeekExtrasMode = "full" | "length_stack_only" | "off";

export function resolveDeepSeekExtrasMode(
  variant: RpDiagnosticCanaryVariant | undefined
): DeepSeekExtrasMode {
  if (!variant) return "full";
  if (variant === "ds_common_only_length_probe") return "off";
  if (variant === "ds_common_only") return "length_stack_only";
  return "full";
}

export function rpDiagnosticUsesBundledGreeting(
  variant: RpDiagnosticCanaryVariant
): boolean {
  if (variant === "common_greeting_split_vs_bundled") return false;
  return (
    variant === "ds_dialogue_control" ||
    variant === "ds_common_only" ||
    variant === "ds_common_only_length_probe" ||
    variant === "common_creator_dialogue_scope" ||
    variant === "common_layout_minimal" ||
    variant === "common_length_owner_minimal" ||
    variant === "common_scene_directive_removed" ||
    variant === "common_rp_style_minimal" ||
    variant === "deepseek_final"
  );
}

export function rpDiagnosticUsesSplitGreeting(
  variant: RpDiagnosticCanaryVariant
): boolean {
  return variant === "common_greeting_split_vs_bundled";
}

/** C1 split greeting uses neutral (2 blocks); bundled uses BUNDLED. Control uses bundled. */
export function resolveRpDiagnosticGreeting(
  variant: RpDiagnosticCanaryVariant,
  characterId: number,
  productionGreeting: string
): string | null {
  if (!isDiagnosticGreetingTarget({ characterId, greeting: productionGreeting })) {
    return null;
  }
  if (rpDiagnosticUsesSplitGreeting(variant)) {
    return CANARY_GREETING_NEUTRAL;
  }
  if (rpDiagnosticUsesBundledGreeting(variant)) {
    return CANARY_GREETING_NEUTRAL_BUNDLED;
  }
  return null;
}

export function rpDiagnosticUsesFlashLengthStack(
  variant: RpDiagnosticCanaryVariant
): boolean {
  if (variant === "ds_length_normalized_baseline") return true;
  const env = process.env.RP_DIAGNOSTIC_CANARY_FLASH_LENGTH_STACK?.trim().toLowerCase();
  return env === "1" || env === "true";
}

/** @deprecated use resolveDeepSeekExtrasMode */
export function rpDiagnosticDisablesDeepSeekExtras(
  variant: RpDiagnosticCanaryVariant
): boolean {
  return resolveDeepSeekExtrasMode(variant) !== "full";
}

export function rpDiagnosticDisablesDeepSeekStyleExtras(
  variant: RpDiagnosticCanaryVariant
): boolean {
  const mode = resolveDeepSeekExtrasMode(variant);
  return mode === "length_stack_only" || mode === "off";
}

export function rpDiagnosticDisablesDeepSeekLengthExtras(
  variant: RpDiagnosticCanaryVariant
): boolean {
  return resolveDeepSeekExtrasMode(variant) === "off";
}

export function evaluateLengthGate(
  rows: Array<{
    canonical_length_ws?: number;
    visible_canonical_length?: number;
    final_ws?: number;
    provider_raw_ws?: number;
    api?: {
      finish_reason?: string;
      finishReason?: string;
      length_recovery_passes?: number;
      retry_count?: number;
    };
  }>,
  opts?: { requireStopFinish?: boolean }
): {
  pass: boolean;
  reason: string;
  stats: {
    canonical_avg: number;
    canonical_median: number;
    canonical_min: number;
    canonical_max: number;
    count_ge_3000: number;
    count_ge_2700: number;
    count_lt_2400: number;
    count_lt_1500: number;
    count_lt_1000: number;
    n: number;
  };
} {
  const canonicals = rows.map(
    (r) =>
      r.provider_raw_ws ??
      r.visible_canonical_length ??
      r.canonical_length_ws ??
      r.final_ws ??
      0
  );
  const n = canonicals.length;
  const avg = n ? Math.round(canonicals.reduce((a, b) => a + b, 0) / n) : 0;
  const sorted = [...canonicals].sort((a, b) => a - b);
  const med = n ? sorted[Math.floor(n / 2)] ?? 0 : 0;
  const stats = {
    canonical_avg: avg,
    canonical_median: med,
    canonical_min: n ? Math.min(...canonicals) : 0,
    canonical_max: n ? Math.max(...canonicals) : 0,
    count_ge_3000: canonicals.filter((c) => c >= 3000).length,
    count_ge_2700: canonicals.filter((c) => c >= 2700).length,
    count_lt_2400: canonicals.filter((c) => c < 2400).length,
    count_lt_1500: canonicals.filter((c) => c < 1500).length,
    count_lt_1000: canonicals.filter((c) => c < 1000).length,
    n,
  };
  if (n < RP_DIAGNOSTIC_BASELINE_LENGTH_SAMPLES) {
    return { pass: false, reason: "INSUFFICIENT_SAMPLE", stats };
  }
  if (stats.count_lt_2400 > 0) return { pass: false, reason: "canonical_lt_2400", stats };
  if (stats.count_ge_2700 < 5) return { pass: false, reason: "count_ge_2700_lt_5", stats };
  if (stats.canonical_avg < 3000) return { pass: false, reason: "canonical_avg_lt_3000", stats };
  if (opts?.requireStopFinish !== false) {
    const badFinish = rows.filter((r) => {
      const fr = (r.api?.finish_reason ?? r.api?.finishReason ?? "").toLowerCase();
      return fr && fr !== "stop" && fr !== "end_turn";
    }).length;
    if (badFinish > 0) return { pass: false, reason: "finish_reason_not_stop", stats };
    const recovery = rows.filter((r) => (r.api?.length_recovery_passes ?? 0) > 0).length;
    if (recovery > 0) return { pass: false, reason: "length_recovery_nonzero", stats };
    const retry = rows.filter((r) => (r.api?.retry_count ?? 0) > 0).length;
    if (retry > 0) return { pass: false, reason: "retry_nonzero", stats };
  }
  return { pass: true, reason: "PASS", stats };
}

export function shouldRelocateRpDiagnosticSceneDirective(
  canary: RpDiagnosticCanaryResolution | null | undefined,
  progressionAxis: SceneProgressionAxis | null | undefined
): boolean {
  return Boolean(
    canary &&
      rpDiagnosticUsesRelationshipAxis(canary.variant) &&
      progressionAxis === "relationship"
  );
}

export function applyRpDiagnosticToSceneDirectiveBlock(opts: {
  block: string;
  canary: RpDiagnosticCanaryResolution | null;
  completedTurns: number;
  progressionAxis?: SceneProgressionAxis | null;
}): string {
  if (!opts.canary) return opts.block;
  if (rpDiagnosticRemovesSceneDirective(opts.canary.variant)) return "";
  if (!rpDiagnosticUsesRelationshipAxis(opts.canary.variant)) return opts.block;
  if (!isDiagnosticEarlyRelationshipScene({ completedTurns: opts.completedTurns })) {
    return opts.block;
  }
  if (opts.progressionAxis !== "relationship") return opts.block;
  if (!opts.block.includes(V1_SCENE_PROGRESS_SENTENCE_PRODUCTION)) {
    return opts.block;
  }
  return opts.block.replace(
    V1_SCENE_PROGRESS_SENTENCE_PRODUCTION,
    V1_SCENE_PROGRESS_SENTENCE_RELATIONSHIP_AXIS
  );
}

export function buildRpDiagnosticIntegrity(opts: {
  userId: number;
  chatId?: number | null;
  characterId: number;
  characterName: string;
  personaId?: number | null;
  personaName?: string | null;
  modelUiId?: string | null;
  resolvedProviderModelId: string;
  contentKind: string;
  canary: RpDiagnosticCanaryResolution;
  temperature?: number | null;
  expectedPersonaId?: number | null;
  expectedModelId?: string | null;
  expectedVariant?: RpDiagnosticCanaryVariant | null;
}): RpDiagnosticRunIntegrity {
  const invalidReasons: string[] = [];
  if (opts.expectedModelId && opts.resolvedProviderModelId !== opts.expectedModelId) {
    invalidReasons.push("model mismatch");
  }
  if (
    opts.expectedPersonaId != null &&
    opts.personaId != null &&
    opts.personaId !== opts.expectedPersonaId
  ) {
    invalidReasons.push("persona mismatch");
  }
  if (opts.expectedVariant && opts.canary.variant !== opts.expectedVariant) {
    invalidReasons.push("variant mismatch");
  }
  return {
    userId: opts.userId,
    chatId: opts.chatId ?? null,
    characterId: opts.characterId,
    characterName: opts.characterName,
    personaId: opts.personaId ?? null,
    personaName: opts.personaName ?? null,
    modelUiId: opts.modelUiId ?? null,
    resolvedProviderModelId: opts.resolvedProviderModelId,
    contentKind: opts.contentKind,
    singlePrimary: true,
    canaryVariant: opts.canary.variant,
    temperature: opts.temperature ?? null,
    valid: invalidReasons.length === 0,
    invalidReasons,
  };
}

export function rpDiagnosticUsesRelationshipAxis(
  variant: RpDiagnosticCanaryVariant
): boolean {
  return (
    variant === "ds_dialogue_control" ||
    variant === "ds_common_only" ||
    variant === "ds_common_only_length_probe" ||
    variant === "common_greeting_split_vs_bundled" ||
    variant === "common_creator_dialogue_scope" ||
    variant === "common_layout_minimal" ||
    variant === "common_length_owner_minimal" ||
    variant === "common_rp_style_minimal" ||
    variant === "deepseek_final"
  );
}

export function rpDiagnosticRemovesSceneDirective(
  variant: RpDiagnosticCanaryVariant
): boolean {
  return variant === "common_scene_directive_removed";
}

export function rpDiagnosticUsesDialogueReferenceScope(
  variant: RpDiagnosticCanaryVariant
): boolean {
  return variant === "common_creator_dialogue_scope";
}

export function rpDiagnosticUsesMinimalLayout(
  variant: RpDiagnosticCanaryVariant
): boolean {
  return variant === "common_layout_minimal";
}

export function rpDiagnosticUsesMinimalLengthOwner(
  variant: RpDiagnosticCanaryVariant
): boolean {
  return variant === "common_length_owner_minimal";
}

export function rpDiagnosticUsesMinimalRpStyle(
  variant: RpDiagnosticCanaryVariant
): boolean {
  return variant === "common_rp_style_minimal";
}

export const COMMON_LAYOUT_MINIMAL_OWNER =
  "대사와 지문은 읽기 쉬운 소설 문단으로 구분하되, 문단 형식이 발화 횟수나 대화 리듬을 결정하지 않는다.";

export const COMMON_LENGTH_OWNER_MINIMAL =
  "같은 목표 분량 안에서 현재 상호작용의 하나의 연속된 장면을 완성한다.";

export function applyRpDiagnosticToHistory(opts: {
  history: ChatMsg[];
  canary: RpDiagnosticCanaryResolution | null;
  characterId: number;
  productionGreeting: string;
}): ChatMsg[] {
  const greeting = opts.canary
    ? resolveRpDiagnosticGreeting(opts.canary.variant, opts.characterId, opts.productionGreeting)
    : null;
  if (!greeting) return opts.history;

  let replaced = false;
  const next = opts.history.map((m) => {
    if (replaced || m.role !== "assistant") return m;
    const content = m.content ?? "";
    if (
      content === opts.productionGreeting ||
      content === CANARY_GREETING_NEUTRAL ||
      content === CANARY_GREETING_NEUTRAL_BUNDLED ||
      content === greeting
    ) {
      replaced = true;
      if (content === greeting) return m;
      return { ...m, content: greeting };
    }
    return m;
  });
  return replaced ? next : opts.history;
}

export function resolveRpDiagnosticProgressionAxis(opts: {
  canary: RpDiagnosticCanaryResolution | null;
  completedTurns: number;
  contentKind?: ContentKind | string | null;
  userMessage?: string | null;
  recentMessages?: ChatMsg[] | null;
}): SceneProgressionAxis | null {
  if (!opts.canary || !rpDiagnosticUsesRelationshipAxis(opts.canary.variant)) return null;
  return resolveDiagnosticSceneProgressionAxis({
    completedTurns: opts.completedTurns,
    contentKind: opts.contentKind,
    userMessage: opts.userMessage,
    recentMessages: opts.recentMessages,
  });
}

export type PostprocessPipelineCapture = {
  provider_raw_merged: string;
  pre_normalize: string;
  post_normalize: string;
  pre_display_grouping: string;
  post_display_grouping: string;
  sse_final: string;
  db_saved: string;
  metrics: {
    provider_raw: DialogueMetrics;
    pre_normalize: DialogueMetrics;
    post_normalize: DialogueMetrics;
    pre_display_grouping: DialogueMetrics;
    post_display_grouping: DialogueMetrics;
    sse_final: DialogueMetrics;
    db_saved: DialogueMetrics;
    deltas: {
      raw_to_pre_display: Record<string, number>;
      raw_to_post_display: Record<string, number>;
      raw_to_sse: Record<string, number>;
      raw_to_db: Record<string, number>;
    };
  };
};

export function capturePostprocessPipeline(opts: {
  providerRawMerged: string;
  preNormalize: string;
  postNormalize: string;
  preDisplayGrouping: string;
  postDisplayGrouping: string;
  sseFinal: string;
  dbSaved: string;
}): PostprocessPipelineCapture {
  const provider_raw = computeDialogueMetrics({ text: opts.providerRawMerged });
  const pre_normalize = computeDialogueMetrics({ text: opts.preNormalize });
  const post_normalize = computeDialogueMetrics({ text: opts.postNormalize });
  const pre_display_grouping = computeDialogueMetrics({ text: opts.preDisplayGrouping });
  const post_display_grouping = computeDialogueMetrics({ text: opts.postDisplayGrouping });
  const sse_final = computeDialogueMetrics({ text: opts.sseFinal });
  const db_saved = computeDialogueMetrics({ text: opts.dbSaved });

  return {
    provider_raw_merged: opts.providerRawMerged,
    pre_normalize: opts.preNormalize,
    post_normalize: opts.postNormalize,
    pre_display_grouping: opts.preDisplayGrouping,
    post_display_grouping: opts.postDisplayGrouping,
    sse_final: opts.sseFinal,
    db_saved: opts.dbSaved,
    metrics: {
      provider_raw,
      pre_normalize,
      post_normalize,
      pre_display_grouping,
      post_display_grouping,
      sse_final,
      db_saved,
      deltas: {
        raw_to_pre_display: diffPipelineMetrics(provider_raw, pre_display_grouping),
        raw_to_post_display: diffPipelineMetrics(provider_raw, post_display_grouping),
        raw_to_sse: diffPipelineMetrics(provider_raw, sse_final),
        raw_to_db: diffPipelineMetrics(provider_raw, db_saved),
      },
    },
  };
}

export function evaluateCandidateLengthGate(
  rows: Array<{ provider_raw_ws?: number; canonical_length_ws?: number }>,
  baselineAvg: number
): { pass: boolean; reason: string } {
  const canonicals = rows.map((r) => r.provider_raw_ws ?? r.canonical_length_ws ?? 0);
  const n = canonicals.length;
  if (n < RP_DIAGNOSTIC_MIN_SCREENING_SAMPLES) {
    return { pass: false, reason: "INSUFFICIENT_SAMPLE" };
  }
  const avg = n ? canonicals.reduce((a, b) => a + b, 0) / n : 0;
  const lt2400 = canonicals.filter((c) => c < 2400).length;
  if (avg < 2700) return { pass: false, reason: "canonical_avg_lt_2700" };
  if (lt2400 > Math.ceil(n / 6)) return { pass: false, reason: "canonical_lt_2400" };
  if (baselineAvg > 0 && (avg - baselineAvg) / baselineAvg < -0.15) {
    return { pass: false, reason: "length_drop_gt_15pct" };
  }
  return { pass: true, reason: "PASS" };
}

export function evaluateScreeningEffect(
  baseline: { manual_resume_per_1000?: number; manual_fragmentation?: number },
  candidate: { manual_resume_per_1000?: number; manual_fragmentation?: number }
): {
  resume_delta_pct: number;
  fragmentation_delta_pct: number;
  effect_confirmed: boolean;
  strong_effect: boolean;
} {
  const resumeBase = baseline.manual_resume_per_1000 ?? 0;
  const fragBase = baseline.manual_fragmentation ?? 1;
  const resumeDelta =
    resumeBase === 0
      ? 0
      : ((candidate.manual_resume_per_1000 ?? 0) - resumeBase) / resumeBase;
  const fragDelta =
    fragBase === 0
      ? 0
      : ((candidate.manual_fragmentation ?? 0) - fragBase) / fragBase;
  const resumePct = Math.round(resumeDelta * 1000) / 10;
  const fragPct = Math.round(fragDelta * 1000) / 10;
  const effectConfirmed = resumePct <= -25 && fragPct <= -25;
  const strongEffect = resumePct <= -30 && fragPct <= -30;
  return {
    resume_delta_pct: resumePct,
    fragmentation_delta_pct: fragPct,
    effect_confirmed: effectConfirmed,
    strong_effect: strongEffect,
  };
}

export function judgePostprocessPrimary(
  capture: PostprocessPipelineCapture
): SampleVerdict | "POSTPROCESS_CREATES_FRAGMENTATION" | "POSTPROCESS_VISUAL_AMPLIFIER" | "POSTPROCESS_NOT_PRIMARY" {
  const raw = capture.metrics.provider_raw;
  const postDisplay = capture.metrics.post_display_grouping;
  const sse = capture.metrics.sse_final;

  if (postDisplay.raw_quote_blocks > raw.raw_quote_blocks) {
    return "POSTPROCESS_CREATES_FRAGMENTATION";
  }
  if (postDisplay.manual_resume_transitions > raw.manual_resume_transitions) {
    return "POSTPROCESS_CREATES_FRAGMENTATION";
  }
  if (
    sse.raw_quote_blocks === raw.raw_quote_blocks &&
    sse.manual_semantic_units === raw.manual_semantic_units &&
    sse.paragraph_count < raw.paragraph_count - 2
  ) {
    return "POSTPROCESS_VISUAL_AMPLIFIER";
  }
  if (
    sse.raw_quote_blocks === raw.raw_quote_blocks &&
    sse.manual_resume_transitions === raw.manual_resume_transitions
  ) {
    return "POSTPROCESS_NOT_PRIMARY";
  }
  return "INSUFFICIENT_SAMPLE";
}

export function evaluateP0ParityGate(opts: {
  p0Samples: Array<{ provider_raw_ws?: number; canonical_length_ws?: number }>;
  baselineAvg: number;
}): { pass: boolean; reason: string; avg_delta_pct: number } {
  const canonicals = opts.p0Samples.map(
    (r) => r.provider_raw_ws ?? r.canonical_length_ws ?? 0
  );
  const n = canonicals.length;
  if (n < RP_DIAGNOSTIC_MIN_SCREENING_SAMPLES) {
    return { pass: false, reason: "INSUFFICIENT_SAMPLE", avg_delta_pct: 0 };
  }
  const avg = canonicals.reduce((a, b) => a + b, 0) / n;
  const avgDeltaPct =
    opts.baselineAvg > 0 ? Math.round(((avg - opts.baselineAvg) / opts.baselineAvg) * 1000) / 10 : 0;
  if (Math.abs(avgDeltaPct) > 15) {
    return { pass: false, reason: "LENGTH_PARITY_DRIFT", avg_delta_pct: avgDeltaPct };
  }
  return { pass: true, reason: "PASS", avg_delta_pct: avgDeltaPct };
}

export type RpDiagnosticRunIntegrity = {
  userId: number;
  chatId?: number | null;
  characterId?: number | null;
  characterName?: string | null;
  personaId?: number | null;
  personaName?: string | null;
  modelUiId?: string | null;
  resolvedProviderModelId?: string | null;
  contentKind?: string | null;
  singlePrimary: boolean;
  canaryVariant: RpDiagnosticCanaryVariant;
  temperature?: number | null;
  valid: boolean;
  invalidReasons: string[];
};

export function evaluateSampleVerdict(count: number, kind: "screening" | "final"): SampleVerdict {
  const min = kind === "final" ? RP_DIAGNOSTIC_MIN_FINAL_SAMPLES : RP_DIAGNOSTIC_MIN_SCREENING_SAMPLES;
  if (count === 0) return "NOT_RUN";
  if (count < min) return "INSUFFICIENT_SAMPLE";
  return "COMPLETED";
}

export type RpDiagnosticDebugDump = {
  requestId?: string | null;
  integrity: RpDiagnosticRunIntegrity;
  pipeline?: PostprocessPipelineCapture | null;
  promptRedacted?: Record<string, unknown> | null;
};

function redactSecrets(text: string): string {
  return text
    .replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[REDACTED_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]");
}

export function logRpDiagnosticCanaryDebug(dump: RpDiagnosticDebugDump): void {
  if (!isRpDiagnosticCanaryDebugEnabled()) return;
  const safe = {
    ...dump,
    pipeline: dump.pipeline
      ? {
          ...dump.pipeline,
          provider_raw_merged: "[REDACTED]",
          pre_normalize: "[REDACTED]",
          post_normalize: "[REDACTED]",
          sse_final: "[REDACTED]",
          db_saved: "[REDACTED]",
        }
      : null,
  };
  console.info("[rp-diagnostic-canary]", JSON.stringify(safe));
  try {
    const dataDir = process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
    const dir = path.join(dataDir, "rp-diagnostic-canary-debug");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(
      dir,
      `${stamp}-u${dump.integrity.userId}-c${dump.integrity.chatId ?? "x"}-${dump.integrity.canaryVariant}.json`
    );
    fs.writeFileSync(file, JSON.stringify(dump, null, 2), "utf8");
  } catch (e) {
    console.warn(
      "[rp-diagnostic-canary] debug write failed:",
      e instanceof Error ? e.message : String(e)
    );
  }
}
