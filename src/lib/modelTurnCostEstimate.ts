/**
 * Client-safe turn cost preview for the model picker.
 * Mirrors OpenRouter token-floor billing in points.ts (output×rate + input surcharge≥10k).
 * Does not import db / exchangeRate.
 */
import {
  isClaudeSelectedAI,
  isDeepSeekV4ProModel,
  isGemini25ProModel,
  isGemini31ProModel,
  isKimiModel,
  isMuseModel,
  isQwenModel,
  type SelectedAI,
} from "@/lib/chatModels";
import { estimateTokens } from "@/lib/tokenEstimate";

/** Preview output size — user-facing baseline for model comparison */
export const MODEL_PICKER_ESTIMATE_OUTPUT_TOKENS = 1500;

/** When the chat has no prior usage receipt */
export const MODEL_PICKER_DEFAULT_INPUT_TOKENS = 8000;

const MIN_TURN = 5;
const INPUT_SURCHARGE_THRESHOLD = 10_000;
const INPUT_SURCHARGE_PER_1000 = 1.25;

/** Defaults match points.ts (env overrides are server-only; preview uses shipped rates). */
const RATE_PER_OUTPUT_TOKEN: Array<{
  match: (id: string) => boolean;
  rate: number;
}> = [
  { match: isDeepSeekV4ProModel, rate: 0.022 },
  { match: isQwenModel, rate: 0.062 },
  { match: isKimiModel, rate: 0.09 },
  { match: isMuseModel, rate: 0.07 },
  { match: isGemini25ProModel, rate: 0.065 },
  { match: isGemini31ProModel, rate: 0.075 },
];

/** Opus — char floor (rare; only when OPENROUTER_OPUS_USER_SELECTABLE=1) */
const OPUS_POINTS_PER_CHAR = 0.142;

function ceilPoints(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n - 1e-9);
}

function inputSurchargePoints(inputTokens: number): number {
  if (inputTokens < INPUT_SURCHARGE_THRESHOLD) return 0;
  const blocks = Math.ceil((inputTokens - INPUT_SURCHARGE_THRESHOLD) / 1000);
  return ceilPoints(blocks * INPUT_SURCHARGE_PER_1000);
}

function resolveOutputTokenRate(modelId: string): number | null {
  for (const row of RATE_PER_OUTPUT_TOKEN) {
    if (row.match(modelId)) return row.rate;
  }
  return null;
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
    Math.round(opts.outputTokens ?? MODEL_PICKER_ESTIMATE_OUTPUT_TOKENS)
  );
  const surcharge = inputSurchargePoints(inputTokens);

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
};

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

/** Compact cost phrase, e.g. "다음턴 예상 포인트 105P" */
export function formatModelPickerCostLabel(points: number): string {
  return `다음턴 예상 포인트 ${points.toLocaleString("ko-KR")}P`;
}

export function modelPickerOptionLabel(opts: {
  displayName: string;
  modelId: SelectedAI | string;
  inputTokens: number;
  outputTokens?: number;
}): string {
  const points = estimateModelTurnPoints({
    modelId: opts.modelId,
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens ?? MODEL_PICKER_ESTIMATE_OUTPUT_TOKENS,
  });
  return `${opts.displayName} ${formatModelPickerCostLabel(points)}`;
}
