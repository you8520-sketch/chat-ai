import OpenAI from "openai";
import { estimateTokens, type ChatMsg, type TokenUsage } from "@/lib/ai";
import { OPENAI_GPT_56_TERRA_MODEL } from "@/lib/chatModels";

/**
 * The RP target is 3,200 visible characters. Give Terra enough headroom for
 * Korean text plus hidden reasoning/accounting tokens instead of relying on
 * the provider default, which can end a response mid-sentence.
 */
export const TERRA_MAX_OUTPUT_TOKENS = 8_192;

export const TERRA_FALLBACK_PROSE_DIRECTIVE = [
  "장면을 요약하거나 설명하지 말고, 인물의 구체적인 행동·반응·대사로 진행한다.",
  "감정은 직접 이름 붙이기보다 표정, 몸짓, 말의 간격과 선택을 통해 드러낸다.",
  "설정 정보를 한꺼번에 나열하지 말고 현재 장면에 필요한 만큼 자연스럽게 사용한다.",
].join("\n");

function hasEquivalentProseDirective(system: string): boolean {
  const normalized = system.replace(/\s+/g, " ");
  return (
    normalized.includes("장면을 요약하거나 설명하지 말고") ||
    (normalized.includes("구체적인 행동") &&
      normalized.includes("감정") &&
      normalized.includes("자연스럽게 사용"))
  );
}

export function buildTerraInstructions(system: string): string {
  const trimmed = system.trim();
  if (hasEquivalentProseDirective(trimmed)) return trimmed;
  return [trimmed, TERRA_FALLBACK_PROSE_DIRECTIVE].filter(Boolean).join("\n\n");
}

export function buildOpenAiTerraResponseRequest(
  system: string,
  history: ChatMsg[],
  targetResponseChars?: number | null,
  maxTokensOverride?: number
) {
  const input = history
    .filter((message): message is ChatMsg & { role: "user" | "assistant" } =>
      message.role === "user" || message.role === "assistant"
    )
    .map((message) => ({ role: message.role, content: message.content }));
  const maxOutputTokens =
    maxTokensOverride ?? TERRA_MAX_OUTPUT_TOKENS;
  return {
    model: OPENAI_GPT_56_TERRA_MODEL,
    instructions: buildTerraInstructions(system),
    input,
    reasoning: { effort: "none" as const },
    text: { verbosity: "high" as const },
    stream: true as const,
    ...(maxOutputTokens != null ? { max_output_tokens: maxOutputTokens } : {}),
  };
}

function responseRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Normalize Responses API terminal states to the finish reasons already used
 * by the chat length guard and persisted receipts.
 */
export function resolveOpenAiResponsesFinishReason(
  eventType: unknown,
  response: unknown
): string | undefined {
  const type = typeof eventType === "string" ? eventType : "";
  const value = responseRecord(response);
  const status = typeof value.status === "string" ? value.status.toLowerCase() : "";

  if (type === "response.completed" || status === "completed") return "STOP";

  if (type === "response.incomplete" || status === "incomplete") {
    const details = responseRecord(value.incomplete_details);
    const reason =
      typeof details.reason === "string" ? details.reason.trim().toLowerCase() : "";
    if (reason === "max_tokens" || reason === "max_output_tokens") {
      return "MAX_OUTPUT_TOKENS";
    }
    if (reason === "content_filter") return "CONTENT_FILTER";
    return reason ? reason.toUpperCase() : "INCOMPLETE";
  }

  if (type === "response.failed" || status === "failed") return "RESPONSE_FAILED";
  return status ? status.toUpperCase() : undefined;
}

export function isRetryableTerraFinishReason(finishReason?: string | null): boolean {
  const value = (finishReason ?? "").trim().toUpperCase();
  return (
    value === "MAX_OUTPUT_TOKENS" ||
    value === "LENGTH" ||
    value === "INCOMPLETE" ||
    value === "STREAM_ERROR" ||
    value === "RESPONSE_FAILED"
  );
}

/** @deprecated Terra 공통 Chat Completions 판별 함수 사용 */
export function isRetryableOpenAiTerraFinishReason(
  finishReason?: string | null
): boolean {
  return isRetryableTerraFinishReason(finishReason);
}

function usageCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function parseResponsesUsage(usage: unknown, fallbackInput: number, fallbackOutput: number): TokenUsage {
  const value = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  const inputDetails =
    value.input_tokens_details && typeof value.input_tokens_details === "object"
      ? (value.input_tokens_details as Record<string, unknown>)
      : {};
  const outputDetails =
    value.output_tokens_details && typeof value.output_tokens_details === "object"
      ? (value.output_tokens_details as Record<string, unknown>)
      : {};
  const inputTokens = usageCount(value.input_tokens) || fallbackInput;
  const outputTokens = usageCount(value.output_tokens) || fallbackOutput;
  const cacheReadTokens = usageCount(
    inputDetails.cached_tokens ?? inputDetails.cache_read_tokens
  );
  const cacheWriteTokens = usageCount(
    inputDetails.cache_write_tokens ?? inputDetails.cache_creation_tokens
  );
  const reasoningOutputTokens = usageCount(
    outputDetails.reasoning_tokens ?? value.reasoning_tokens
  );

  return {
    inputTokens,
    outputTokens,
    apiReportedInputTokens: inputTokens,
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
    ...(reasoningOutputTokens > 0 ? { reasoningOutputTokens } : {}),
    standardInputTokens: Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens),
    estimated: !usage,
  };
}

export async function* streamOpenAiTerraResponses(
  system: string,
  history: ChatMsg[],
  targetResponseChars?: number | null,
  maxTokensOverride?: number
): AsyncGenerator<string, TokenUsage> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const request = buildOpenAiTerraResponseRequest(
    system,
    history,
    targetResponseChars,
    maxTokensOverride
  );
  const fallbackInput = estimateTokens(
    `${system}\n${request.input.map((message) => message.content).join("\n")}`
  );
  const client = new OpenAI({ apiKey });
  const stream = await client.responses.create(request as never);

  let completedUsage: unknown;
  let finishReason: string | undefined;
  let fullText = "";
  try {
    for await (const event of stream as unknown as AsyncIterable<Record<string, unknown>>) {
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        fullText += event.delta;
        yield event.delta;
        continue;
      }
      if (
        event.type === "response.completed" ||
        event.type === "response.incomplete" ||
        event.type === "response.failed"
      ) {
        const response = responseRecord(event.response);
        completedUsage = response.usage;
        finishReason = resolveOpenAiResponsesFinishReason(event.type, response);
        if (event.type === "response.failed" && !fullText.trim()) {
          const error = responseRecord(response.error);
          throw new Error(
            typeof error.message === "string"
              ? error.message
              : "OpenAI Responses stream failed"
          );
        }
      }
      if (event.type === "error") {
        const error = responseRecord(event.error);
        if (!fullText.trim()) {
          throw new Error(
            typeof error.message === "string"
              ? error.message
              : "OpenAI Responses stream failed"
          );
        }
        finishReason = "STREAM_ERROR";
        break;
      }
    }
  } catch (error) {
    if (!fullText.trim()) throw error;
    console.warn("[OpenAI Responses] Terra stream ended after partial output", {
      message: (error as Error).message,
      outputChars: fullText.length,
    });
    finishReason = "STREAM_ERROR";
  }

  return {
    ...parseResponsesUsage(completedUsage, fallbackInput, estimateTokens(fullText)),
    ...(finishReason ? { finishReason } : {}),
  };
}
