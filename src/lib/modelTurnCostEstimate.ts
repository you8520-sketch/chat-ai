/**
 * Client-safe turn cost preview for the model picker.
 * Mirrors OpenRouter token-floor billing in points.ts (output×rate + input surcharge≥10k).
 * Does not import db / exchangeRate.
 */
import {
  isClaudeSelectedAI,
  isDeepSeekModel,
  isDeepSeekV4ProModel,
  isGemini25ProModel,
  isGemini31ProModel,
  isKimiModel,
  isMuseModel,
  isQwenModel,
  type SelectedAI,
} from "@/lib/chatModels";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "@/lib/responseLengthConstants";
import { estimateTokens } from "@/lib/tokenEstimate";

/**
 * @deprecated Prefer resolveModelPickerOutputTokens — kept for tests/compat.
 * Historical fixed baseline (underestimates current ~3200–4000 char RP turns).
 */
export const MODEL_PICKER_ESTIMATE_OUTPUT_TOKENS = 1500;

/** When the chat has no prior usage receipt */
export const MODEL_PICKER_DEFAULT_INPUT_TOKENS = 8000;

/** Recent same-model samples used for output median */
export const MODEL_PICKER_OUTPUT_SAMPLE_LIMIT = 5;

const MIN_TURN = 5;
const INPUT_SURCHARGE_THRESHOLD = 10_000;
/** Non-DeepSeek: 1P per 1000 excess tokens (block ceil). */
const INPUT_SURCHARGE_PER_1000 = 1;
/** DeepSeek: 0.5P per 1000 excess tokens (proportional, no mid ceil). */
const DEEPSEEK_INPUT_SURCHARGE_PER_1000 = 0.5;

/** Defaults match points.ts (env overrides are server-only; preview uses shipped rates). */
const RATE_PER_OUTPUT_TOKEN: Array<{
  match: (id: string) => boolean;
  rate: number;
}> = [
  { match: isDeepSeekV4ProModel, rate: 0.022 },
  { match: isQwenModel, rate: 0.062 },
  { match: isKimiModel, rate: 0.09 },
  { match: isMuseModel, rate: 0.063 },
  { match: isGemini25ProModel, rate: 0.06 },
  { match: isGemini31ProModel, rate: 0.075 },
];

/** Opus — char floor (rare; only when OPENROUTER_OPUS_USER_SELECTABLE=1) */
const OPUS_POINTS_PER_CHAR = 0.142;

function ceilPoints(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n - 1e-9);
}

function inputSurchargePoints(inputTokens: number, modelId: string): number {
  if (inputTokens < INPUT_SURCHARGE_THRESHOLD) return 0;
  const excess = inputTokens - INPUT_SURCHARGE_THRESHOLD;
  if (isDeepSeekModel(modelId)) {
    return (excess / 1000) * DEEPSEEK_INPUT_SURCHARGE_PER_1000;
  }
  const blocks = Math.ceil(excess / 1000);
  return blocks * INPUT_SURCHARGE_PER_1000;
}

function resolveOutputTokenRate(modelId: string): number | null {
  for (const row of RATE_PER_OUTPUT_TOKEN) {
    if (row.match(modelId)) return row.rate;
  }
  return null;
}

function medianInt(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2) return s[mid]!;
  return Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/**
 * Expected points for one RP turn at the given input/output token sizes.
 * Aligns with computeOpenRouterTurnCost token-floor path for selectable models.
 */
export function estimateModelTurnPoints(opts: {
  modelId: string;
  inputTokens: number;
  outputTokens?: number;
  /** Opus only — defaults to outputTokens (1 tok ≈ 1 char preview) */
  outputChars?: number;
}): number {
  const inputTokens = Math.max(0, Math.round(opts.inputTokens));
  const outputTokens = Math.max(
    0,
    Math.round(opts.outputTokens ?? resolveAimOutputTokens())
  );
  const surcharge = inputSurchargePoints(inputTokens, opts.modelId);

  if (isClaudeSelectedAI(opts.modelId)) {
    const chars = Math.max(0, Math.round(opts.outputChars ?? outputTokens));
    const floor = ceilPoints(chars * OPUS_POINTS_PER_CHAR);
    return Math.max(MIN_TURN, ceilPoints(floor + surcharge));
  }

  const rate = resolveOutputTokenRate(opts.modelId);
  if (rate == null) {
    return Math.max(MIN_TURN, ceilPoints(surcharge));
  }
  const floor = ceilPoints(outputTokens * rate);
  return Math.max(MIN_TURN, ceilPoints(floor + surcharge));
}

export type UsageLikeForEstimate = {
  apiInputTokens?: number;
  input?: number;
  apiContentOutputTokens?: number;
  apiOutputTokens?: number;
  output?: number;
  /** Message/provider model id when known — used for per-model output median */
  model?: string;
  selectedAI?: string;
};

function usageModelId(u: UsageLikeForEstimate): string {
  return (u.selectedAI || u.model || "").trim();
}

function usageOutputTokens(u: UsageLikeForEstimate): number | null {
  const content = u.apiContentOutputTokens;
  if (typeof content === "number" && content > 0) return content;
  const apiOut = u.apiOutputTokens;
  if (typeof apiOut === "number" && apiOut > 0) return apiOut;
  const out = u.output;
  if (typeof out === "number" && out > 0) return out;
  return null;
}

export function resolveAimOutputTokens(targetResponseChars?: number): number {
  const chars =
    typeof targetResponseChars === "number" && targetResponseChars > 0
      ? targetResponseChars
      : DEFAULT_TARGET_RESPONSE_CHARS;
  // Same ratio as estimateTokens(text) without building a giant string.
  return Math.max(1, Math.ceil(chars * 0.9));
}

/**
 * Output size for picker preview:
 * 1) median of recent same-model assistant output tokens (up to N)
 * 2) else aim chars → tokens (DEFAULT_TARGET_RESPONSE_CHARS / targetResponseChars)
 * Never falls back to the obsolete fixed 1500 baseline for live UI.
 */
export function resolveModelPickerOutputTokens(opts: {
  modelId: string;
  recentUsages: Array<UsageLikeForEstimate | null | undefined>;
  targetResponseChars?: number;
  sampleLimit?: number;
}): number {
  const aim = resolveAimOutputTokens(opts.targetResponseChars);
  const limit = opts.sampleLimit ?? MODEL_PICKER_OUTPUT_SAMPLE_LIMIT;
  const samples: number[] = [];
  for (let i = opts.recentUsages.length - 1; i >= 0 && samples.length < limit; i--) {
    const u = opts.recentUsages[i];
    if (!u) continue;
    const mid = usageModelId(u);
    if (!mid || mid !== opts.modelId) continue;
    const out = usageOutputTokens(u);
    if (out != null) samples.push(out);
  }
  const med = medianInt(samples);
  if (med != null && med > 0) {
    // Prefer observed size, but never estimate below current aim (models often meet/exceed target).
    return Math.max(aim, med);
  }
  return aim;
}

/**
 * Best available prompt-size proxy for the next turn:
 * last API prompt tokens, else receipt input, else default.
 * Draft text (not yet sent) is added on top.
 */
export function resolveModelPickerInputTokens(opts: {
  recentUsages: Array<UsageLikeForEstimate | null | undefined>;
  draftInput?: string;
}): number {
  let base = MODEL_PICKER_DEFAULT_INPUT_TOKENS;
  for (let i = opts.recentUsages.length - 1; i >= 0; i--) {
    const u = opts.recentUsages[i];
    if (!u) continue;
    const apiIn = u.apiInputTokens;
    if (typeof apiIn === "number" && apiIn > 0) {
      base = apiIn;
      break;
    }
    const billedIn = u.input;
    if (typeof billedIn === "number" && billedIn > 0) {
      base = billedIn;
      break;
    }
  }
  const draft = opts.draftInput?.trim() ? estimateTokens(opts.draftInput) : 0;
  return Math.max(1, base + draft);
}

/** Compact cost phrase, e.g. "예상 105P" */
export function formatModelPickerCostLabel(points: number): string {
  return `예상 ${points.toLocaleString("ko-KR")}P`;
}

export function modelPickerOptionLabel(opts: {
  displayName: string;
  modelId: SelectedAI | string;
  inputTokens: number;
  outputTokens?: number;
  recentUsages?: Array<UsageLikeForEstimate | null | undefined>;
  targetResponseChars?: number;
}): string {
  const outputTokens =
    opts.outputTokens ??
    resolveModelPickerOutputTokens({
      modelId: String(opts.modelId),
      recentUsages: opts.recentUsages ?? [],
      targetResponseChars: opts.targetResponseChars,
    });
  const points = estimateModelTurnPoints({
    modelId: opts.modelId,
    inputTokens: opts.inputTokens,
    outputTokens,
  });
  return `${opts.displayName} ${formatModelPickerCostLabel(points)}`;
}
