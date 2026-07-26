/**
 * Model picker cost preview — server-authoritative estimation.
 * Uses computeOpenRouterTurnCost from points.ts (env-aware rates).
 */
import {
  isDeepSeekV4ProModel,
  isGemini36FlashModel,
  isMuseModel,
  isTencentHy3Model,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
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
  formatModelPickerCostLabelRange,
  modelPickerOptionLabel,
} from "@/lib/modelPickerPreviewTypes";

/** Active picker models — preview tuning scope for V2. */
export const MODEL_PICKER_ACTIVE_MODEL_IDS = [
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_TENCENT_HY3_MODEL,
] as const satisfies readonly SelectedAI[];

export type ModelPickerActiveModelId = (typeof MODEL_PICKER_ACTIVE_MODEL_IDS)[number];

export const MODEL_PICKER_OUTPUT_SAMPLE_LIMIT = 8;

/** Last-resort input when no snapshot / receipts exist (not a primary path). */
export const MODEL_PICKER_FALLBACK_INPUT_TOKENS = 4000;

/**
 * Measured / calibrated cold-start completion-token P50 (content + thinking).
 * Kept below typical aim so cold-start labels do not read as worst-case ceilings.
 */
export const MODEL_PICKER_MEASURED_COLD_BASELINES: Partial<Record<ModelPickerActiveModelId, number>> =
  {
    [OPENROUTER_MUSE_SPARK_11_MODEL]: 1400,
    [OPENROUTER_DEEPSEEK_V4_PRO_MODEL]: 1500,
    [OPENROUTER_GEMINI_36_FLASH_MODEL]: 1200,
    [OPENROUTER_TENCENT_HY3_MODEL]: 1300,
  };

/** Output-token band used when deriving low/high point labels. */
export const MODEL_PICKER_OUTPUT_RANGE_RATIO = 0.2;

/**
 * Minimum displayed point-band width as a fraction of mid.
 * Cheap dual-rate models otherwise collapse to a single number because ±output
 * only moves a few P while Gemini's higher out-rate still spreads.
 */
export const MODEL_PICKER_DISPLAY_RANGE_RATIO = 0.12;

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

/** Visible content output tokens for receipt-aligned sampling labels. */
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

/** Total output tokens used for next-turn cost preview (content + thinking when billed). */
export function previewCostOutputTokens(
  modelId: string,
  usage: ModelPickerUsageSample
): number | null {
  const totalApi = usage.apiOutputTokens ?? usage.output ?? 0;
  if (totalApi > 0) return totalApi;
  const content = usage.apiContentOutputTokens ?? 0;
  const reasoning = usage.apiReasoningOutputTokens ?? 0;
  if (content + reasoning > 0) return content + reasoning;
  return previewBillableOutputTokens(modelId, usage);
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
  return previewCostOutputTokens(
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

/** Sanity upper bound only — not a hard floor. Tighter than aim so long outliers do not stick. */
export function capOutputSanityUpper(outputTokens: number, targetResponseChars?: number): number {
  const aim = resolveAimOutputTokens(targetResponseChars);
  const upper = Math.ceil(aim * 0.9);
  return Math.min(Math.max(1, outputTokens), upper);
}

export function resolveColdOutputBaseline(modelId: string): number {
  if (isActivePickerModel(modelId) && MODEL_PICKER_MEASURED_COLD_BASELINES[modelId] != null) {
    return MODEL_PICKER_MEASURED_COLD_BASELINES[modelId]!;
  }
  // Fallback priors when a new active model lacks a measured baseline.
  const aim = resolveAimOutputTokens();
  if (isGemini36FlashModel(modelId)) return Math.round(aim * 0.4);
  if (isDeepSeekV4ProModel(modelId) || isTencentHy3Model(modelId)) return Math.round(aim * 0.5);
  if (isMuseModel(modelId)) return Math.round(aim * 0.48);
  return Math.round(aim * 0.4);
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
    const out = previewCostOutputTokens(opts.modelId, usage!);
    if (out != null && out > 0) samples.push(out);
  }
  return samples;
}

/**
 * Per-model output estimate — p30 + recent blend, always sanity-capped.
 * samples[] is newest-first from collectModelOutputSamples.
 */
export function resolveModelPickerOutputTokens(opts: {
  modelId: string;
  messages: ModelPickerMessageSample[];
  targetResponseChars?: number;
  sampleLimit?: number;
}): { tokens: number; basis: ModelPickerOutputBasis } {
  const samples = collectModelOutputSamples(opts);
  const med = medianInt(samples);
  const p30 = pPercentile(samples, 0.3);
  const recent = samples[0] ?? null;

  if (samples.length >= 3 && p30 != null && p30 > 0 && recent != null) {
    const blended = Math.round(p30 * 0.75 + recent * 0.25);
    return {
      tokens: capOutputSanityUpper(blended, opts.targetResponseChars),
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

/** Latest billable/API input tokens for this model from chat receipts. */
export function resolveLastModelReceiptInputTokens(
  modelId: string,
  messages: ModelPickerMessageSample[]
): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "assistant") continue;
    const usage = resolveActiveUsageFromMessage(m);
    if (!usage || usage.htmlFlashOnly || usage.billingWaived) continue;
    const canonical = canonicalizePreviewModelId(usage, m.model);
    if (canonical !== modelId) continue;
    const apiIn = usage.apiInputTokens;
    if (typeof apiIn === "number" && apiIn > 0) return apiIn;
    const billedIn = usage.input;
    if (typeof billedIn === "number" && billedIn > 0) return billedIn;
  }
  return null;
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

/**
 * Align preview input with billing: min(assembled, last receipt api) + draft.
 * Prevents assembled-only overestimates when the last billed prompt was smaller.
 */
export function resolveAlignedPreviewInputTokens(opts: {
  modelId: string;
  assembledTokens: number | null | undefined;
  messages: ModelPickerMessageSample[];
  draftTokens?: number;
}): { tokens: number; basis: ModelPickerInputBasis } {
  const draft = Math.max(0, opts.draftTokens ?? 0);
  const assembled =
    typeof opts.assembledTokens === "number" && opts.assembledTokens > 0
      ? opts.assembledTokens
      : null;
  const receipt = resolveLastModelReceiptInputTokens(opts.modelId, opts.messages);

  if (assembled != null && receipt != null) {
    const capped = Math.min(assembled, receipt);
    return {
      tokens: Math.max(1, Math.round(capped + draft)),
      basis: capped < assembled ? "assembled_capped_by_api" : "assembled_snapshot",
    };
  }
  if (assembled != null) {
    return {
      tokens: Math.max(1, Math.round(assembled + draft)),
      basis: "assembled_snapshot",
    };
  }
  if (receipt != null) {
    return {
      tokens: Math.max(1, Math.round(receipt + draft)),
      basis: "api_input",
    };
  }
  return {
    tokens: Math.max(1, MODEL_PICKER_FALLBACK_INPUT_TOKENS + draft),
    basis: "fallback",
  };
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
  // outputTokens are total completion tokens (content + thinking) from previewCostOutputTokens.
  return computeOpenRouterTurnCost(opts.inputTokens, opts.outputTokens, opts.modelId);
}

export function computePreviewPointBand(opts: {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  targetResponseChars?: number;
}): { low: number; mid: number; high: number } | null {
  const mid = computePreviewTurnPoints(opts);
  if (mid == null) return null;
  const loOut = Math.max(
    1,
    Math.round(opts.outputTokens * (1 - MODEL_PICKER_OUTPUT_RANGE_RATIO))
  );
  const hiOut = capOutputSanityUpper(
    Math.round(opts.outputTokens * (1 + MODEL_PICKER_OUTPUT_RANGE_RATIO)),
    opts.targetResponseChars
  );
  const low = computePreviewTurnPoints({
    modelId: opts.modelId,
    inputTokens: opts.inputTokens,
    outputTokens: loOut,
  });
  const high = computePreviewTurnPoints({
    modelId: opts.modelId,
    inputTokens: opts.inputTokens,
    outputTokens: hiOut,
  });
  if (low == null || high == null) return { low: mid, mid, high: mid };

  // Token-based band (can be tiny on cheap out-rates) ∪ minimum relative display band.
  const displayLow = Math.max(1, Math.floor(mid * (1 - MODEL_PICKER_DISPLAY_RANGE_RATIO)));
  const displayHigh = Math.max(mid + 1, Math.ceil(mid * (1 + MODEL_PICKER_DISPLAY_RANGE_RATIO)));
  const a = Math.min(low, high, displayLow);
  const b = Math.max(low, high, displayHigh);
  return { low: a, mid, high: b };
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
        estimatedPointsLow: null,
        estimatedPointsHigh: null,
        supported: false,
        outputBasis: "unsupported",
      };
    }

    const { tokens: outputTokens, basis } = resolveModelPickerOutputTokens({
      modelId,
      messages: opts.messages,
      targetResponseChars: opts.targetResponseChars,
    });

    let modelInputTokens: number;
    let modelInputBasis: ModelPickerInputBasis;
    if (inputOverride != null) {
      modelInputTokens = inputOverride;
      modelInputBasis = "assembled_snapshot";
    } else {
      const assembled =
        opts.assembledSnapshotTokensByModel?.[modelId] ??
        (typeof opts.assembledSnapshotTokens === "number"
          ? opts.assembledSnapshotTokens
          : null);
      const aligned = resolveAlignedPreviewInputTokens({
        modelId,
        assembledTokens: assembled,
        messages: opts.messages,
        draftTokens,
      });
      modelInputTokens = aligned.tokens;
      modelInputBasis = aligned.basis;
    }

    const band = computePreviewPointBand({
      modelId,
      inputTokens: modelInputTokens,
      outputTokens,
      targetResponseChars: opts.targetResponseChars,
    });

    return {
      modelId,
      estimatedInputTokens: modelInputTokens,
      estimatedOutputTokens: outputTokens,
      estimatedPoints: band?.mid ?? null,
      estimatedPointsLow: band?.low ?? null,
      estimatedPointsHigh: band?.high ?? null,
      supported: band != null,
      outputBasis: basis,
      inputBasis: modelInputBasis,
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
