/**
 * Model-neutral RP diagnostic canary (default OFF, fail-closed).
 *
 * Separate from TERRA_PROMPT_CANARY_* — used for cross-model root-cause audits
 * (DeepSeek V4 Pro primary diagnostic model; Flash retained for cross-check only).
 */

import {
  isCheaperInferenceDeepSeekV4FlashModel,
  isCheaperInferenceDeepSeekV4ProModel,
} from "@/lib/chatModels";
import { resolveRpSceneCastMode } from "@/lib/terraTerminalLengthOwner";
import type { ContentKind } from "@/lib/simulationMode";
import {
  applyTerraPromptCanaryToHistory,
  applyTerraPromptCanaryToSceneDirectiveBlock,
  canaryAppliesDialogueReferenceScope,
  CHARACTER_DIALOGUE_REFERENCE_SCOPE,
  injectDialogueReferenceScopeForCanary,
  isTerraPromptCanaryGreetingTarget,
  lockSceneDirectiveToRelationshipAxis,
  resolveCanaryGreetingText,
  resolveCanarySceneProgressionAxis,
  shouldRelocateSceneDirectiveToUserTurn,
  TERRA_PROMPT_CANARY_GREETING_NEUTRAL,
  TERRA_PROMPT_CANARY_GREETING_NEUTRAL_BUNDLED,
  TERRA_PROMPT_CANARY_LIKE_CHARACTER_ID,
  type SceneProgressionAxis,
} from "@/lib/terraPromptCanary";
import type { ChatMsg } from "@/lib/ai";
import fs from "fs";
import path from "path";
import { computeDialogueMetrics, diffPipelineMetrics, type DialogueMetrics } from "@/lib/dialogueMetrics";

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
  /**
   * Audit 40 — collapse DeepSeek competing length owners to a single terminal owner.
   * Keeps USER_TAIL_LENGTH_OWNER_SENTENCE; strips DEEPSEEK LENGTH block + SHORT HISTORY /
   * SHORT USER TURN / REGEN length extras. Opening-scene peel still uses thin-history
   * detection (not the injected SHORT HISTORY text).
   */
  "ds_single_terminal_length_owner",
  /**
   * Audit 42 — ARM C: production triple length owners, SceneDirective / BASE_SCENE_ENGINE OFF.
   * Does NOT rewrite greeting (unlike common_scene_directive_removed).
   */
  "ds_triple_owner_scene_off",
  /**
   * Audit 42 — ARM D: single terminal length owner + SceneDirective OFF.
   */
  "ds_single_owner_scene_off",
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
    .map((s) => s.trim().toLowerCase())
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
  const modelId = (opts.modelId ?? "").trim().toLowerCase();
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
    variant === "ds_real_production" ||
    variant === "ds_single_terminal_length_owner" ||
    variant === "ds_triple_owner_scene_off" ||
    variant === "ds_single_owner_scene_off"
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
  if (!isTerraPromptCanaryGreetingTarget({ characterId, greeting: productionGreeting })) {
    return null;
  }
  if (rpDiagnosticUsesSplitGreeting(variant)) {
    return TERRA_PROMPT_CANARY_GREETING_NEUTRAL;
  }
  if (rpDiagnosticUsesBundledGreeting(variant)) {
    return TERRA_PROMPT_CANARY_GREETING_NEUTRAL_BUNDLED;
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

/** One length owner only: USER_TAIL_LENGTH_OWNER_SENTENCE (suppress DeepSeek length extras). */
export function rpDiagnosticUsesSingleTerminalLengthOwner(
  variant: RpDiagnosticCanaryVariant
): boolean {
  return (
    variant === "ds_single_terminal_length_owner" ||
    variant === "ds_single_owner_scene_off"
  );
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
  return applyTerraPromptCanaryToSceneDirectiveBlock({
    block: opts.block,
    canary: {
      active: true,
      variant: "greeting_neutral_relationship_axis",
      userId: opts.canary.userId,
      modelId: opts.canary.modelId,
      sceneMode: "single_primary",
    },
    completedTurns: opts.completedTurns,
    progressionAxis: opts.progressionAxis,
  });
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
  return (
    variant === "common_scene_directive_removed" ||
    variant === "ds_triple_owner_scene_off" ||
    variant === "ds_single_owner_scene_off"
  );
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
      content === TERRA_PROMPT_CANARY_GREETING_NEUTRAL ||
      content === TERRA_PROMPT_CANARY_GREETING_NEUTRAL_BUNDLED ||
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
  // Turn 1-2 lock; for deepseek_final turn 3-4 axis may unlock naturally
  if (opts.canary.variant !== "deepseek_final" && opts.completedTurns > 2) {
    return null;
  }
  if (opts.canary.variant === "deepseek_final" && opts.completedTurns > 2) {
    return null;
  }
  return resolveCanarySceneProgressionAxis({
    canary: {
      active: true,
      variant: "greeting_neutral_relationship_axis",
      userId: opts.canary.userId,
      modelId: opts.canary.modelId,
      sceneMode: "single_primary",
    },
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

export {
  applyTerraPromptCanaryToSceneDirectiveBlock,
  lockSceneDirectiveToRelationshipAxis,
  shouldRelocateSceneDirectiveToUserTurn,
  injectDialogueReferenceScopeForCanary,
  CHARACTER_DIALOGUE_REFERENCE_SCOPE,
  TERRA_PROMPT_CANARY_LIKE_CHARACTER_ID,
};
