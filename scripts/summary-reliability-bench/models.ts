import { CHEAPER_INFERENCE_GPT_56_LUNA_MODEL } from "../../src/lib/chatModels";

/**
 * Production Luna baseline — must match `BACKGROUND_OPENROUTER_MODEL` default on main
 * (`resolveBackgroundOpenRouterModel()` → `CHEAPER_INFERENCE_GPT_56_LUNA_MODEL` when env unset).
 */
export const PRODUCTION_LUNA_MODEL_ID = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;

export const RELIABILITY_BENCH_MODELS = [
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
    label: "GPT-5.6 Luna (production background)",
    requestedModelId: PRODUCTION_LUNA_MODEL_ID,
    /** Matches `adaptCheaperInferenceChatBody` for Luna/Terra in production. */
    reasoningParams: {
      reasoning: { effort: "none" as const },
      reasoning_effort: "none" as const,
    },
  },
] as const;

export const BENCH_ROUNDS = 3;
export const BENCH_FIXTURE_COUNT = 20;
export const BENCH_CALLS_PER_MODEL = BENCH_ROUNDS * BENCH_FIXTURE_COUNT;
export const BENCH_OUTPUT_MAX_TOKENS = 350;
export const BENCH_TEMPERATURE = 0.3;
export const BENCH_TIMEOUT_MS = 180_000;
export const BENCH_REQUEST_KIND = "benchmark-summary-reliability-v1";

/** Interleave: round → fixture → model (Gemini, DeepSeek, Luna). */
export const BENCH_MODEL_ORDER = [
  "Gemini 3.1 Flash-Lite",
  "DeepSeek V4 Flash",
  "GPT-5.6 Luna (production background)",
] as const;
