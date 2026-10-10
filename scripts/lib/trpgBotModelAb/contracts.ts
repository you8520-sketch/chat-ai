import {
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
} from "@/lib/chatModels";
import { adaptCheaperInferenceChatBody } from "@/lib/cheaperInferenceConfig";
import { TRPG_BOT_MAX_TOKENS } from "@/lib/trpg/types";

export const BENCH_GEMINI_MODEL = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
export const BENCH_LUNA_MODEL = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;

export type BenchModelId = typeof BENCH_GEMINI_MODEL | typeof BENCH_LUNA_MODEL;

/** Production bot-seat temperature — do not tune per model. */
export const BENCH_TEMPERATURE = 0.85;

export type ModelRequestContractMeta = {
  model: BenchModelId;
  /** Fields sent on the wire after adaptCheaperInferenceChatBody. */
  adaptedBody: Record<string, unknown>;
  geminiTrueOffSupported?: boolean;
  geminiReasoningMode?: string;
  lunaTrueOffSupported?: boolean;
  lunaReasoningMode?: string;
};

function baseMessages(system: string, user: string) {
  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

/** Benchmark outbound body — uses adaptCheaperInferenceChatBody, NOT adaptTrpgBotChatBody. */
export function buildBenchBotRequestBody(opts: {
  model: BenchModelId;
  system: string;
  user: string;
}): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    model: opts.model,
    messages: baseMessages(opts.system, opts.user),
    stream: false,
    temperature: BENCH_TEMPERATURE,
    max_tokens: TRPG_BOT_MAX_TOKENS,
  };
  const adapted = adaptCheaperInferenceChatBody(raw);
  // Benchmark-only: probe confirmed gemini-3.7-flash accepts reasoning_effort=none.
  // Production adapter still uses "low" via adaptCheaperInferenceChatBody.
  if (opts.model === BENCH_GEMINI_MODEL) {
    adapted.reasoning_effort = "none";
    delete adapted.thinking;
  }
  return adapted;
}

export function describeModelContract(model: BenchModelId, adapted: Record<string, unknown>): ModelRequestContractMeta {
  const meta: ModelRequestContractMeta = {
    model,
    adaptedBody: {
      model: adapted.model,
      stream: adapted.stream,
      temperature: adapted.temperature,
      max_tokens: adapted.max_tokens,
      reasoning_effort: adapted.reasoning_effort,
      reasoning: adapted.reasoning,
      thinking: adapted.thinking,
      output_config: adapted.output_config,
    },
  };
  if (model === BENCH_GEMINI_MODEL) {
    const effort = adapted.reasoning_effort;
    meta.geminiTrueOffSupported = effort === "none";
    meta.geminiReasoningMode = typeof effort === "string" ? effort : String(effort ?? "unset");
  }
  if (model === BENCH_LUNA_MODEL) {
    const reasoning = adapted.reasoning as { effort?: string } | undefined;
    const effort = reasoning?.effort ?? adapted.reasoning_effort;
    meta.lunaTrueOffSupported = effort === "none";
    meta.lunaReasoningMode = typeof effort === "string" ? effort : String(effort ?? "unset");
  }
  return meta;
}

/** Prove Luna-only reasoning object is not copied onto Gemini bodies. */
export function contractsAreModelSpecific(
  gemini: Record<string, unknown>,
  luna: Record<string, unknown>
): { geminiHasLunaReasoningObject: boolean; lunaHasGeminiOnlyFields: boolean } {
  return {
    geminiHasLunaReasoningObject:
      gemini.reasoning != null &&
      typeof gemini.reasoning === "object" &&
      (gemini.reasoning as { effort?: string }).effort === "none",
    lunaHasGeminiOnlyFields: gemini.thinking != null && luna.thinking == null,
  };
}
