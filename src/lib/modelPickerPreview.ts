/**
 * Model picker cost preview — server-authoritative estimation.
 * Uses computeOpenRouterTurnCost from points.ts (env-aware rates).
 */
import {
  isDeepSeekV4ProModel,
  isGemini25ProModel,
  isMuseModel,
  isTencentHy3Model,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_TENCENT_HY3_MODEL,
  resolveSelectedAI,
  USER_SELECTABLE_AI_OPTIONS,
  type SelectedAI,
} from "@/lib/chatModels";
import type { Usage } from "@/lib/chatUsage";
import {
  billableOpenRouterOutputTokens,
  computeOpenRouterTurnCost,
} from "@/lib/points";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "@/lib/responseLengthConstants";
import { estimateTokens } from "@/lib/tokenEstimate";
import type {
  ModelPickerInputBasis,
  ModelPickerMessageSample,
  ModelPickerOutputBasis,
  ModelPickerPreviewModelResult,
  ModelPickerPreviewResult,
  ModelPickerUsageSample,
} from "@/lib/modelPickerPreviewTypes";

export type {
  ModelPickerInputBasis,
  ModelPickerMessageSample,
  ModelPickerOutputBasis,
  ModelPickerPreviewModelResult,
  ModelPickerPreviewResult,
  ModelPickerUsageSample,
} from "@/lib/modelPickerPreviewTypes";
export {
  formatModelPickerCostLabel,
  formatModelPickerCostLabelFromPreview,
  modelPickerOptionLabel,
} from "@/lib/modelPickerPreviewTypes";

/** Active picker models — preview tuning scope for V2. */
export const MODEL_PICKER_ACTIVE_MODEL_IDS = [
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_TENCENT_HY3_MODEL,
] as const satisfies readonly SelectedAI[];

export type ModelPickerActiveModelId = (typeof MODEL_PICKER_ACTIVE_MODEL_IDS)[number];

export const MODEL_PICKER_OUTPUT_SAMPLE_LIMIT = 8;

/** Last-resort input when no snapshot / receipts exist (not a primary path). */
export const MODEL_PICKER_FALLBACK_INPUT_TOKENS = 4000;

/** Measured cold-start output P50 from dev DB normal RP (scripts/_tmp-model-picker-baselines.ts). */
export const MODEL_PICKER_MEASURED_COLD_BASELINES: Partial<Record<ModelPickerActiveModelId, number>> = {
  [OPENROUTER_DEEPSEEK_V4_PRO_MODEL]: 2063,
  [OPENROUTER_GEMINI_25_PRO_MODEL]: 1383,
};

export function isActivePickerModel(modelId: string): modelId is ModelPickerActiveModelId {
  return (MODEL_PICKER_ACTIVE_MODEL_IDS as readonly string[]).includes(modelId);
}

/** Canonical model id for sample filtering — matches billing selectedAI. */
export function canonicalizePreviewModelId(
  usage?: Pick<ModelPickerUsageSample, "selectedAI" | "model"> | null,
  messageModel?: string | null
): SelectedAI | null {
  const raw = usage?.selectedAI || usage?.model || messageModel || "";
  if (!raw.trim()) return null;
  const resolved = resolveSelectedAI(raw, raw);
  return isActivePickerModel(resolved) ? resolved : null;
}

/** Billable output tokens aligned with points.ts for preview sampling. */
export function previewBillableOutputTokens(
  modelId: string,
  usage: ModelPickerUsageSample
): number | null {
  const totalApi = usage.apiOutputTokens ?? usage.output ?? 0;
  const reasoning = usage.apiReasoningOutputTokens ?? 0;
  if (totalApi > 0) {
    const billable = billableOpenRouterOutputTokens(modelId, totalApi, reasoning);
    return billable > 0 ? billable : null;
  }
  const content = usage.apiContentOutputTokens;
  if (typeof content === "number" && content > 0) return content;
  return null;
}

export function isUsableMainRpUsage(
  usage: ModelPickerUsageSample | null | undefined,
  messageModel?: string | null
): boolean {
  if (!usage) return false;
  if (usage.htmlFlashOnly) return false;
  if (usage.billingWaived) return false;
  if (messageModel === "greeting") return false;
  if (!canonicalizePreviewModelId(usage, messageModel)) return false;
  return previewBillableOutputTokens(
    canonicalizePreviewModelId(usage, messageModel)!,
    usage
  ) != null;
}

function resolveActiveUsageFromMessage(m: ModelPickerMessageSample): ModelPickerUsageSample | null {
  let fromVariant: ModelPickerUsageSample | null = null;
  if (m.variants?.length && m.activeVariant != null && m.activeVariant >= 0) {
    fromVariant = m.variants[m.activeVariant]?.usage ?? null;
  }
  return fromVariant ?? m.usage ?? null;
}

function medianInt(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2) return s[mid]!;
  return Math.round((s[mid - 1]! + s[mid]!) / 2);
}

function pPercentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)));
  return s[idx]!;
}

export function resolveAimOutputTokens(targetResponseChars?: number): number {
  const chars =
    typeof targetResponseChars === "number" && targetResponseChars > 0
      ? targetResponseChars
      : DEFAULT_TARGET_RESPONSE_CHARS;
  return Math.max(1, Math.ceil(chars * 0.9));
}

/** Sanity upper bound only — not a hard floor. */
export function capOutputSanityUpper(outputTokens: number, targetResponseChars?: number): number {
  const aim = resolveAimOutputTokens(targetResponseChars);
  const upper = Math.ceil(aim * 1.15);
  return Math.min(Math.max(1, outputTokens), upper);
}

export function resolveColdOutputBaseline(modelId: string): number {
  if (isActivePickerModel(modelId) && MODEL_PICKER_MEASURED_COLD_BASELINES[modelId] != null) {
    return MODEL_PICKER_MEASURED_COLD_BASELINES[modelId]!;
  }
  // Temporary prior when measured data unavailable — not audit placeholders.
  const aim = resolveAimOutputTokens();
  if (isGemini25ProModel(modelId)) return Math.round(aim * 0.45);
  if (isDeepSeekV4ProModel(modelId) || isTencentHy3Model(modelId)) return Math.round(aim * 0.65);
  if (isMuseModel(modelId)) return Math.round(aim * 0.75);
  return Math.round(aim * 0.55);
}

export function collectModelOutputSamples(opts: {
  modelId: string;
  messages: ModelPickerMessageSample[];
  sampleLimit?: number;
}): number[] {
  const limit = opts.sampleLimit ?? MODEL_PICKER_OUTPUT_SAMPLE_LIMIT;
  const samples: number[] = [];
  for (let i = opts.messages.length - 1; i >= 0 && samples.length < limit; i--) {
    const m = opts.messages[i];
    if (!m || m.role !== "assistant") continue;
    const usage = resolveActiveUsageFromMessage(m);
    if (!isUsableMainRpUsage(usage, m.model)) continue;
    const canonical = canonicalizePreviewModelId(usage, m.model);
    if (canonical !== opts.modelId) continue;
    const out = previewBillableOutputTokens(opts.modelId, usage!);
    if (out != null && out > 0) samples.push(out);
  }
  return samples;
}

/**
 * Per-model output estimate — no shared-room median, no aim hard floor.
 */
export function resolveModelPickerOutputTokens(opts: {
  modelId: string;
  messages: ModelPickerMessageSample[];
  targetResponseChars?: number;
  sampleLimit?: number;
}): { tokens: number; basis: ModelPickerOutputBasis } {
  const samples = collectModelOutputSamples(opts);
  const med = medianInt(samples);

  if (samples.length >= 3 && med != null && med > 0) {
    return {
      tokens: med,
      basis: "model_median",
    };
  }

  if (samples.length >= 1 && med != null && med > 0) {
    const baseline = resolveColdOutputBaseline(opts.modelId);
    const blended = Math.round(med * 0.65 + baseline * 0.35);
    return {
      tokens: capOutputSanityUpper(blended, opts.targetResponseChars),
      basis: "model_blend",
    };
  }

  if (!isActivePickerModel(opts.modelId)) {
    return { tokens: resolveColdOutputBaseline(opts.modelId), basis: "unsupported" };
  }

  return {
    tokens: capOutputSanityUpper(resolveColdOutputBaseline(opts.modelId), opts.targetResponseChars),
    basis: "cold_baseline",
  };
}

export function resolveModelPickerBaseInputTokens(opts: {
  assembledSnapshotTokens?: number | null;
  messages: ModelPickerMessageSample[];
}): { tokens: number; basis: ModelPickerInputBasis } {
  if (
    typeof opts.assembledSnapshotTokens === "number" &&
    opts.assembledSnapshotTokens > 0
  ) {
    return { tokens: opts.assembledSnapshotTokens, basis: "assembled_snapshot" };
  }

  for (let i = opts.messages.length - 1; i >= 0; i--) {
    const m = opts.messages[i];
    if (m.role !== "assistant") continue;
    const usage = resolveActiveUsageFromMessage(m);
    if (!usage || usage.htmlFlashOnly) continue;
    const assembled = usage.assembledInputTokens;
    if (typeof assembled === "number" && assembled > 0) {
      return { tokens: assembled, basis: "prompt_audit" };
    }
  }

  for (let i = opts.messages.length - 1; i >= 0; i--) {
    const m = opts.messages[i];
    if (m.role !== "assistant") continue;
    const usage = resolveActiveUsageFromMessage(m);
    if (!usage || usage.htmlFlashOnly) continue;
    const apiIn = usage.apiInputTokens;
    if (typeof apiIn === "number" && apiIn > 0) {
      return { tokens: apiIn, basis: "api_input" };
    }
    const billedIn = usage.input;
    if (typeof billedIn === "number" && billedIn > 0) {
      return { tokens: billedIn, basis: "api_input" };
    }
  }

  return { tokens: MODEL_PICKER_FALLBACK_INPUT_TOKENS, basis: "fallback" };
}

export function resolvePreviewInputTokens(opts: {
  baseInputTokens: number;
  draftInput?: string;
}): number {
  const draft = opts.draftInput?.trim() ? estimateTokens(opts.draftInput) : 0;
  return Math.max(1, Math.round(opts.baseInputTokens) + draft);
}

export function computePreviewTurnPoints(opts: {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}): number | null {
  if (!isActivePickerModel(opts.modelId)) {
    return null;
  }
  return computeOpenRouterTurnCost(opts.inputTokens, opts.outputTokens, opts.modelId);
}

export function buildModelPickerPreview(opts: {
  messages: ModelPickerMessageSample[];
  targetResponseChars?: number;
  assembledSnapshotTokens?: number | null;
  assembledSnapshotTokensByModel?: Partial<Record<string, number>> | null;
  draftInput?: string;
  inputTokensOverride?: number | null;
  modelIds?: string[];
}): ModelPickerPreviewResult {
  const representativeSnapshot =
    opts.assembledSnapshotTokens ??
    Object.values(opts.assembledSnapshotTokensByModel ?? {}).find(
      (tokens) => typeof tokens === "number" && tokens > 0
    ) ??
    null;
  const baseInput = resolveModelPickerBaseInputTokens({
    assembledSnapshotTokens: representativeSnapshot,
    messages: opts.messages,
  });

  const inputOverride =
    typeof opts.inputTokensOverride === "number" && opts.inputTokensOverride > 0
      ? Math.max(1, Math.round(opts.inputTokensOverride))
      : null;
  const draftTokens = opts.draftInput?.trim() ? estimateTokens(opts.draftInput) : 0;

  const modelIds =
    opts.modelIds ??
    USER_SELECTABLE_AI_OPTIONS.filter((o) => isActivePickerModel(o.id)).map((o) => o.id);

  const models: ModelPickerPreviewModelResult[] = modelIds.map((modelId) => {
    if (!isActivePickerModel(modelId)) {
      return {
        modelId,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        estimatedPoints: null,
        supported: false,
        outputBasis: "unsupported",
      };
    }

    const { tokens: outputTokens, basis } = resolveModelPickerOutputTokens({
      modelId,
      messages: opts.messages,
      targetResponseChars: opts.targetResponseChars,
    });
    const modelBaseInput =
      opts.assembledSnapshotTokensByModel?.[modelId] ?? baseInput.tokens;
    const modelInputTokens =
      inputOverride ??
      Math.max(1, Math.round(modelBaseInput) + draftTokens);

    const points = computePreviewTurnPoints({
      modelId,
      inputTokens: modelInputTokens,
      outputTokens,
    });

    return {
      modelId,
      estimatedInputTokens: modelInputTokens,
      estimatedOutputTokens: outputTokens,
      estimatedPoints: points,
      supported: points != null,
      outputBasis: basis,
    };
  });

  return {
    baseInputTokens: baseInput.tokens,
    inputBasis: baseInput.basis,
    models,
  };
}

/** Map stored Usage to sample shape for preview builders. */
export function usageToPickerSample(u: Usage | null | undefined): ModelPickerUsageSample | null {
  if (!u) return null;
  return {
    model: u.model,
    selectedAI: u.selectedAI,
    apiInputTokens: u.apiInputTokens,
    input: u.input,
    assembledInputTokens: u.assembledInputTokens,
    apiContentOutputTokens: u.apiContentOutputTokens,
    apiOutputTokens: u.apiOutputTokens,
    apiReasoningOutputTokens: u.apiReasoningOutputTokens,
    output: u.output,
    htmlFlashOnly: u.htmlFlashOnly,
    billingWaived: u.billingWaived,
    cost: u.cost,
    estimated: u.estimated,
  };
}
