export type ModelPickerInputBasis =
  | "assembled_snapshot"
  | "assembled_capped_by_api"
  | "prompt_audit"
  | "api_input"
  | "fallback";

export type ModelPickerOutputBasis =
  | "model_median"
  | "model_blend"
  | "cold_baseline"
  | "unsupported";

export type ModelPickerPreviewModelResult = {
  modelId: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  /** Central / typical estimate (midpoint of low–high when ranged). */
  estimatedPoints: number | null;
  estimatedPointsLow: number | null;
  estimatedPointsHigh: number | null;
  supported: boolean;
  outputBasis: ModelPickerOutputBasis;
  inputBasis?: ModelPickerInputBasis;
};

export type ModelPickerPreviewResult = {
  baseInputTokens: number;
  inputBasis: ModelPickerInputBasis;
  models: ModelPickerPreviewModelResult[];
};

export function formatModelPickerCostLabel(points: number): string {
  return `약 ${points.toLocaleString("ko-KR")}P`;
}

export function formatModelPickerCostLabelRange(low: number, high: number): string {
  const a = Math.min(low, high);
  const b = Math.max(low, high);
  if (a === b) return formatModelPickerCostLabel(a);
  return `약 ${a.toLocaleString("ko-KR")}–${b.toLocaleString("ko-KR")}P`;
}

export function formatModelPickerCostLabelFromPreview(
  points: number | null,
  low?: number | null,
  high?: number | null
): string {
  if (points == null && (low == null || high == null)) return "예상 —";
  if (typeof low === "number" && typeof high === "number") {
    return formatModelPickerCostLabelRange(low, high);
  }
  if (points == null) return "예상 —";
  return formatModelPickerCostLabel(points);
}

export function modelPickerOptionLabel(opts: {
  displayName: string;
  estimatedPoints: number | null;
  estimatedPointsLow?: number | null;
  estimatedPointsHigh?: number | null;
}): string {
  return `${opts.displayName} ${formatModelPickerCostLabelFromPreview(
    opts.estimatedPoints,
    opts.estimatedPointsLow,
    opts.estimatedPointsHigh
  )}`;
}

export type ModelPickerUsageSample = {
  model?: string;
  selectedAI?: string;
  apiInputTokens?: number;
  input?: number;
  assembledInputTokens?: number;
  apiContentOutputTokens?: number;
  apiOutputTokens?: number;
  apiReasoningOutputTokens?: number;
  output?: number;
  htmlFlashOnly?: boolean;
  billingWaived?: boolean;
  cost?: number;
  estimated?: boolean;
};

export type ModelPickerMessageSample = {
  role: "user" | "assistant" | "system";
  model?: string;
  usage?: ModelPickerUsageSample | null;
  variants?: Array<{ usage?: ModelPickerUsageSample | null }>;
  activeVariant?: number;
};
