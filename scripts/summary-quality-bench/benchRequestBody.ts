import { BENCH_OUTPUT_MAX_TOKENS, BENCH_TEMPERATURE } from "./models";

/**
 * Benchmark-only CheaperInference body builder.
 * Preserves requested model id (no DeepSeek alias normalization) and records exact reasoning params.
 */
export function buildBenchmarkCheaperInferenceBody(opts: {
  requestedModelId: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  reasoningParams: Record<string, unknown>;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts.requestedModelId,
    messages: opts.messages,
    stream: false,
    temperature: BENCH_TEMPERATURE,
    max_tokens: BENCH_OUTPUT_MAX_TOKENS,
    ...opts.reasoningParams,
  };
  delete body.reasoning;
  delete body.include_reasoning;
  delete body.session_id;
  delete body.frequency_penalty;
  delete body.presence_penalty;
  delete body.repetition_penalty;
  return body;
}
