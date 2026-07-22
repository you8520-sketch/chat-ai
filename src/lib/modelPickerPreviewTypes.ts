export type ModelPickerInputBasis =
  | "assembled_snapshot"
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
  estimatedOutputTokens: number;
  estimatedPoints: number | null;
  supported: boolean;
  outputBasis: ModelPickerOutputBasis;
};

export type ModelPickerPreviewResult = {
  baseInputTokens: number;
  inputBasis: ModelPickerInputBasis;
  models: ModelPickerPreviewModelResult[];
};

export function formatModelPickerCostLabel(points: number): string {
  return `약 ${points.toLocaleString("ko-KR")}P`;
}

export function formatModelPickerCostLabelFromPreview(points: number | null): string {
  if (points == null) return "예상 —";
  return formatModelPickerCostLabel(points);
}

export function modelPickerOptionLabel(opts: {
  displayName: string;
  estimatedPoints: number | null;
}): string {
  return `${opts.displayName} ${formatModelPickerCostLabelFromPreview(opts.estimatedPoints)}`;
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
