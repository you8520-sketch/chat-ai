import { estimateTokens } from "@/lib/tokenEstimate";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  buildOpenRouterHeaders,
  resolveOpenRouterApiKey,
} from "@/lib/openRouterConfig";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import { isCheaperInferenceModel } from "@/lib/chatModels";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import {
  getMockResponseText,
  isMockApiMode,
  MOCK_INPUT_TOKENS,
  MOCK_OUTPUT_TOKENS,
} from "@/lib/mockApiMode";

export type OpenRouterChatMsg = { role: "user" | "assistant" | "system"; content: string };

export type OpenRouterCompletionUsage = {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  finishReason?: string;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  standardInputTokens?: number;
  reasoningOutputTokens?: number;
  debugRawUsage?: unknown;
};

/** bare gemini-* slug → OpenRouter google/ slug */
export function toOpenRouterModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes("/")) return trimmed;
  if (/^gemini-/i.test(trimmed)) return `google/${trimmed}`;
  return trimmed;
}

export function resolveOpenRouterCompletionTimeoutMs(requestKind?: string): number {
  if (/background-html-visual-card/i.test(requestKind ?? "")) return 240_000;
  return 120_000;
}

export async function callOpenRouterCompletion(opts: {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  requestKind?: string;
  timeoutMs?: number;
}): Promise<{ text: string; usage: OpenRouterCompletionUsage }> {
  const model = toOpenRouterModelId(opts.model);
  const useCheaperInference = isCheaperInferenceModel(model);
  const providerLabel = useCheaperInference ? "CheaperInference" : "OpenRouter";
  const messages: OpenRouterChatMsg[] = [
    { role: "system", content: opts.system.trim() },
    ...opts.history
      .filter((m) => m.content?.trim())
      .map((m) => ({ role: m.role, content: m.content.trim() })),
  ];
  if (messages.length < 2 || messages[messages.length - 1]?.role !== "user") {
    throw new Error(
      `[${providerLabel}] requires system + user history ending with user`
    );
  }

  if (isMockApiMode()) {
    const mockText = getMockResponseText();
    return {
      text: mockText,
      usage: {
        inputTokens: MOCK_INPUT_TOKENS,
        outputTokens: MOCK_OUTPUT_TOKENS,
        estimated: true,
      },
    };
  }

  const key = useCheaperInference
    ? resolveCheaperInferenceApiKey()
    : resolveOpenRouterApiKey();
  const endpoint = useCheaperInference
    ? CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL
    : OPENROUTER_CHAT_COMPLETIONS_URL;
  const headers = useCheaperInference
    ? buildCheaperInferenceHeaders(key)
    : buildOpenRouterHeaders(key);
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 2048,
    }),
    signal: AbortSignal.timeout(
      opts.timeoutMs ?? resolveOpenRouterCompletionTimeoutMs(opts.requestKind)
    ),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${providerLabel} ${res.status}: ${body.slice(0, 240)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new Error(
      `[${providerLabel}] empty completion (finish=${data.choices?.[0]?.finish_reason ?? "unknown"})`
    );
  }

  const parsedUsage = parseOpenRouterUsage(data.usage, res.headers);
  const promptTokens = parsedUsage.promptTokens || undefined;
  const completionTokens = parsedUsage.completionTokens || undefined;
  return {
    text,
    usage: {
      inputTokens:
        promptTokens ??
        estimateTokens(opts.system + opts.history.map((m) => m.content).join("\n")),
      outputTokens: completionTokens ?? estimateTokens(text),
      estimated: promptTokens == null || completionTokens == null,
      finishReason: data.choices?.[0]?.finish_reason,
      cacheReadTokens: parsedUsage.cacheReadTokens || undefined,
      cacheWriteTokens: parsedUsage.cacheWriteTokens || undefined,
      standardInputTokens: parsedUsage.standardInputTokens || undefined,
      reasoningOutputTokens: parsedUsage.reasoningTokens || undefined,
      debugRawUsage: data.usage,
    },
  };
}
