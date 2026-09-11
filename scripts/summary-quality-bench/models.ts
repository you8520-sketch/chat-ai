/** Benchmark-only model roster — public labels, exact CheaperInference request ids. */
export const SUMMARY_QUALITY_BENCH_MODELS = [
  {
    label: "GLM-5.3-Flash",
    requestedModelId: "glm-5.3-flash",
    reasoningParams: { reasoning_effort: "low" as const },
  },
  {
    label: "Gemini 3.1 Flash-Lite",
    requestedModelId: "gemini-3.1-flash-lite",
    reasoningParams: { reasoning_effort: "none" as const },
  },
  {
    label: "DeepSeek V4 Flash",
    requestedModelId: "deepseek-v4-flash",
    reasoningParams: { thinking: { type: "disabled" as const } },
  },
  {
    label: "DeepSeek V4 Flash-0731",
    requestedModelId: "deepseek-v4-flash-0731",
    reasoningParams: { thinking: { type: "disabled" as const } },
  },
] as const;

export const BENCH_OUTPUT_MAX_TOKENS = 350;
export const BENCH_TEMPERATURE = 0.3;
export const BENCH_REQUEST_KIND = "benchmark-summary-quality-v1";
