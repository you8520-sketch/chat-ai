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
  adaptCheaperInferenceChatBody,
} from "@/lib/cheaperInferenceConfig";
import { isCheaperInferenceModel } from "@/lib/chatModels";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import { recordApiCost } from "@/lib/adminFinance";
import {
  getMockResponseText,
  isMockApiMode,
  MOCK_INPUT_TOKENS,
  MOCK_OUTPUT_TOKENS,
} from "@/lib/mockApiMode";
import {
  DeepSeekDeterministicProviderError,
  DeepSeekProviderFailoverError,
  adaptOpenRouterDeepSeekBackupBody,
  executeDeepSeekBackgroundWithProviderFailover,
  isDeepSeekPrimaryCheaperInferenceModel,
  resolveDeepSeekBackupModelId,
  resolveDeepSeekFailoverRouteKind,
  resolveDeepSeekLogicalModel,
} from "@/lib/deepseekProviderFailover";

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

export class CompatibleCompletionError extends Error {
  readonly provider: "OpenRouter" | "CheaperInference";
  readonly httpStatus: number | null;
  readonly finishReason: string | null;
  readonly usage: OpenRouterCompletionUsage | null;

  constructor(opts: {
    message: string;
    provider: "OpenRouter" | "CheaperInference";
    httpStatus?: number | null;
    finishReason?: string | null;
    usage?: OpenRouterCompletionUsage | null;
  }) {
    super(opts.message);
    this.name = "CompatibleCompletionError";
    this.provider = opts.provider;
    this.httpStatus = opts.httpStatus ?? null;
    this.finishReason = opts.finishReason ?? null;
    this.usage = opts.usage ?? null;
  }
}

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
  maxTokens?: number | null;
  disableReasoning?: boolean;
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
  const configuredMaxTokens =
    opts.maxTokens === null ? null : opts.maxTokens ?? 2048;
  const baseRequestBody = {
    model,
    messages,
    stream: false,
    temperature: opts.temperature ?? 0.3,
    ...(configuredMaxTokens != null ? { max_tokens: configuredMaxTokens } : {}),
    ...(opts.disableReasoning
      ? { reasoning: { effort: "none" as const }, include_reasoning: false }
      : {}),
  };
  const requestBody = useCheaperInference
    ? adaptCheaperInferenceChatBody(baseRequestBody)
    : baseRequestBody;
  const timeoutMs =
    opts.timeoutMs ?? resolveOpenRouterCompletionTimeoutMs(opts.requestKind);
  const logical = resolveDeepSeekLogicalModel(model);
  const routeKind = resolveDeepSeekFailoverRouteKind({
    modelId: model,
    background: true,
  });
  let res: Response;
  let usedProvider = useCheaperInference
    ? ("cheaperinference" as const)
    : ("openrouter" as const);
  let usedModel = model;
  if (
    useCheaperInference &&
    isDeepSeekPrimaryCheaperInferenceModel(model) &&
    logical &&
    routeKind
  ) {
    try {
      const failover = await executeDeepSeekBackgroundWithProviderFailover({
        routeKind,
        logicalModel: logical,
        primary: { endpoint, headers, body: requestBody },
        backupBody: adaptOpenRouterDeepSeekBackupBody(
          baseRequestBody,
          resolveDeepSeekBackupModelId(logical)
        ),
        timeoutMs,
        requestKind: opts.requestKind,
      });
      res = failover.response;
      usedProvider = failover.usedProvider;
      usedModel =
        failover.usedProvider === "openrouter"
          ? resolveDeepSeekBackupModelId(logical)
          : model;
    } catch (error) {
      if (error instanceof DeepSeekDeterministicProviderError) {
        throw new CompatibleCompletionError({
          message: error.message,
          provider: providerLabel,
          httpStatus: error.httpStatus,
        });
      }
      if (error instanceof DeepSeekProviderFailoverError) {
        throw new CompatibleCompletionError({
          message: error.message,
          provider: "OpenRouter",
          httpStatus: error.primaryHttpStatus,
        });
      }
      throw error;
    }
  } else {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  if (!res.ok) {
    const body = await res.text();
    throw new CompatibleCompletionError({
      message: `${providerLabel} ${res.status}: ${body.slice(0, 240)}`,
      provider: providerLabel,
      httpStatus: res.status,
    });
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  const parsedUsage = parseOpenRouterUsage(data.usage, res.headers);
  const promptTokens = parsedUsage.promptTokens || undefined;
  const completionTokens = parsedUsage.completionTokens || undefined;
  const resolvedInputTokens =
    promptTokens ??
    estimateTokens(opts.system + opts.history.map((m) => m.content).join("\n"));
  const resolvedOutputTokens = completionTokens ?? estimateTokens(text);
  const usage: OpenRouterCompletionUsage = {
    inputTokens: resolvedInputTokens,
    outputTokens: resolvedOutputTokens,
    estimated: promptTokens == null || completionTokens == null,
    finishReason: data.choices?.[0]?.finish_reason,
    cacheReadTokens: parsedUsage.cacheReadTokens || undefined,
    cacheWriteTokens: parsedUsage.cacheWriteTokens || undefined,
    standardInputTokens: parsedUsage.standardInputTokens || undefined,
    reasoningOutputTokens: parsedUsage.reasoningTokens || undefined,
    debugRawUsage: data.usage,
  };
  try {
    recordApiCost({
      provider: usedProvider,
      model: usedModel,
      requestKind: opts.requestKind,
      inputTokens: resolvedInputTokens,
      outputTokens: resolvedOutputTokens,
      cacheReadTokens: parsedUsage.cacheReadTokens || undefined,
      cacheWriteTokens: parsedUsage.cacheWriteTokens || undefined,
      estimated: promptTokens == null || completionTokens == null,
    });
  } catch (error) {
    console.warn("[api-cost-ledger] usage record skipped:", (error as Error).message);
  }
  if (!text) {
    const finishReason = data.choices?.[0]?.finish_reason ?? null;
    throw new CompatibleCompletionError({
      message: `[${providerLabel}] empty completion (finish=${finishReason ?? "unknown"})`,
      provider: providerLabel,
      httpStatus: res.status,
      finishReason,
      usage,
    });
  }
  return {
    text,
    usage,
  };
}
