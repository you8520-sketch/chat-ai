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
import { parseCompatibleUsage } from "@/lib/openRouterUsage";
import type { UsageReportingEvidence } from "@/lib/usageReportingEvidence";
import { recordApiCost } from "@/lib/adminFinance";
import {
  finalizeProviderCostAttempt,
  startProviderCostAttempt,
  type ProviderCostEventStatus,
  type ProviderCostLedgerContext,
} from "@/lib/providerCostLedger";
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
  cheaperInferenceBilledCostUsd?: number;
  upstreamCostUsd?: number;
  debugRawUsage?: unknown;
  usageReportingEvidence?: UsageReportingEvidence;
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

function ledgerContextForPhysicalAttempt(
  base: ProviderCostLedgerContext,
  physicalAttemptOrdinal: number,
  requestedProvider: string,
  requestedModel: string
): ProviderCostLedgerContext {
  return {
    ...base,
    physicalAttemptOrdinal,
    requestedProvider,
    requestedModel,
  };
}

function persistProviderCostLedgerFailure(
  ctx: ProviderCostLedgerContext,
  input: {
    actualProvider: string;
    actualModel: string;
    httpStatus?: number | null;
    usage?: OpenRouterCompletionUsage | null;
    eventStatus: ProviderCostEventStatus;
  }
): void {
  try {
    finalizeProviderCostAttempt(ctx, {
      actualProvider: input.actualProvider,
      actualModel: input.actualModel,
      inputTokens: input.usage?.inputTokens,
      outputTokens: input.usage?.outputTokens,
      reasoningTokens: input.usage?.reasoningOutputTokens,
      cacheReadTokens: input.usage?.cacheReadTokens,
      cacheWriteTokens: input.usage?.cacheWriteTokens,
      cheaperInferenceBilledCostUsd: input.usage?.cheaperInferenceBilledCostUsd,
      upstreamCostUsd: input.usage?.upstreamCostUsd,
      usageEstimated: input.usage?.estimated,
      httpStatus: input.httpStatus,
      eventStatus: input.eventStatus,
    });
  } catch (error) {
    console.warn("[provider-cost-ledger] finalize failed:", (error as Error).message);
  }
}

function persistProviderCostLedgerSuccess(
  ctx: ProviderCostLedgerContext,
  input: {
    actualProvider: string;
    actualModel: string;
    usage: OpenRouterCompletionUsage;
    providerRequestId?: string | null;
  }
): void {
  const hasExactUsage =
    finiteNonNegative(input.usage.cheaperInferenceBilledCostUsd) > 0 ||
    (finiteNonNegative(input.usage.upstreamCostUsd) > 0 && input.usage.estimated !== true);
  const eventStatus: ProviderCostEventStatus = hasExactUsage
    ? "settled"
    : "completed_without_exact_cost";
  try {
    finalizeProviderCostAttempt(ctx, {
      actualProvider: input.actualProvider,
      actualModel: input.actualModel,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      reasoningTokens: input.usage.reasoningOutputTokens,
      cacheReadTokens: input.usage.cacheReadTokens,
      cacheWriteTokens: input.usage.cacheWriteTokens,
      cheaperInferenceBilledCostUsd: input.usage.cheaperInferenceBilledCostUsd,
      upstreamCostUsd: input.usage.upstreamCostUsd,
      providerRequestId: input.providerRequestId,
      usageEstimated: input.usage.estimated,
      eventStatus,
    });
  } catch (error) {
    console.warn("[provider-cost-ledger] finalize failed:", (error as Error).message);
  }
}

function finiteNonNegative(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function buildFailoverLedgerHooks(
  ledgerBase: ProviderCostLedgerContext,
  backupModel: string
): {
  onPhysicalAttemptStart: (info: {
    physicalAttemptOrdinal: number;
    provider: "cheaperinference" | "openrouter";
    model: string;
  }) => void;
  onPhysicalAttemptFinish: (info: {
    physicalAttemptOrdinal: number;
    provider: "cheaperinference" | "openrouter";
    model: string;
    success: boolean;
    httpStatus: number | null;
  }) => void;
} {
  return {
    onPhysicalAttemptStart: (info) => {
      const ctx = ledgerContextForPhysicalAttempt(
        ledgerBase,
        info.physicalAttemptOrdinal,
        info.provider,
        info.model
      );
      try {
        startProviderCostAttempt(ctx);
      } catch (error) {
        console.warn("[provider-cost-ledger] start failed:", (error as Error).message);
      }
    },
    onPhysicalAttemptFinish: (info) => {
      if (info.success) return;
      const ctx = ledgerContextForPhysicalAttempt(
        ledgerBase,
        info.physicalAttemptOrdinal,
        info.physicalAttemptOrdinal === 1 ? "cheaperinference" : "openrouter",
        info.physicalAttemptOrdinal === 1 ? ledgerBase.requestedModel : backupModel
      );
      persistProviderCostLedgerFailure(ctx, {
        actualProvider: info.provider,
        actualModel: info.model,
        httpStatus: info.httpStatus,
        eventStatus: "failed_without_usage",
      });
    },
  };
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
  ledgerContext?: ProviderCostLedgerContext;
}): Promise<{ text: string; usage: OpenRouterCompletionUsage }> {
  const rawModel = opts.model.trim();
  const useCheaperInference = isCheaperInferenceModel(rawModel);
  const model = useCheaperInference ? rawModel : toOpenRouterModelId(opts.model);
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
  const ledgerBase = opts.ledgerContext
    ? {
        ...opts.ledgerContext,
        requestKind: opts.ledgerContext.requestKind ?? opts.requestKind,
        requestedProvider: opts.ledgerContext.requestedProvider || (useCheaperInference ? "cheaperinference" : "openrouter"),
        requestedModel: opts.ledgerContext.requestedModel || model,
      }
    : null;
  const backupModelId = logical ? resolveDeepSeekBackupModelId(logical) : model;

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
          backupModelId
        ),
        timeoutMs,
        requestKind: opts.requestKind,
        hooks: ledgerBase
          ? buildFailoverLedgerHooks(ledgerBase, backupModelId)
          : undefined,
      });
      res = failover.response;
      usedProvider = failover.usedProvider;
      usedModel =
        failover.usedProvider === "openrouter"
          ? backupModelId
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
    const singleAttemptCtx = ledgerBase
      ? ledgerContextForPhysicalAttempt(
          ledgerBase,
          1,
          useCheaperInference ? "cheaperinference" : "openrouter",
          model
        )
      : null;
    if (singleAttemptCtx) {
      try {
        startProviderCostAttempt(singleAttemptCtx);
      } catch (error) {
        console.warn("[provider-cost-ledger] start failed:", (error as Error).message);
      }
    }
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (singleAttemptCtx) {
        persistProviderCostLedgerFailure(singleAttemptCtx, {
          actualProvider: useCheaperInference ? "cheaperinference" : "openrouter",
          actualModel: model,
          eventStatus: "failed_without_usage",
        });
      }
      throw error;
    }
    if (!res.ok && singleAttemptCtx) {
      persistProviderCostLedgerFailure(singleAttemptCtx, {
        actualProvider: useCheaperInference ? "cheaperinference" : "openrouter",
        actualModel: model,
        httpStatus: res.status,
        eventStatus: "failed_without_usage",
      });
    }
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
    cheaper_inference?: { billing?: { billed_cost_usd?: unknown }; billed_cost_usd?: unknown };
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  const parsedUsage = parseCompatibleUsage({ usage: data.usage, cheaperInference: (data as Record<string, unknown>).cheaper_inference, headers: res.headers });
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
    cheaperInferenceBilledCostUsd: parsedUsage.cheaperInferenceBilledCostUsd,
    upstreamCostUsd: parsedUsage.upstreamCostUsd,
    debugRawUsage: data.usage,
    usageReportingEvidence: parsedUsage.reportingEvidence,
  };
  const providerRequestId = res.headers.get("x-request-id") ?? res.headers.get("x-openrouter-request-id");
  const physicalOrdinal =
    usedProvider === "openrouter" && useCheaperInference && isDeepSeekPrimaryCheaperInferenceModel(model)
      ? 2
      : 1;
  const successAttemptCtx = ledgerBase
    ? ledgerContextForPhysicalAttempt(ledgerBase, physicalOrdinal, usedProvider, usedModel)
    : null;

  if (!text) {
    const finishReason = data.choices?.[0]?.finish_reason ?? null;
    if (successAttemptCtx) {
      persistProviderCostLedgerFailure(successAttemptCtx, {
        actualProvider: usedProvider,
        actualModel: usedModel,
        httpStatus: res.status,
        usage,
        eventStatus: usage.estimated ? "failed_without_usage" : "failed_with_usage",
      });
    }
    throw new CompatibleCompletionError({
      message: `[${providerLabel}] empty completion (finish=${finishReason ?? "unknown"})`,
      provider: providerLabel,
      httpStatus: res.status,
      finishReason,
      usage,
    });
  }

  if (ledgerBase && successAttemptCtx) {
    persistProviderCostLedgerSuccess(successAttemptCtx, {
      actualProvider: usedProvider,
      actualModel: usedModel,
      usage,
      providerRequestId,
    });
  } else {
    try {
      recordApiCost({
        provider: usedProvider,
        model: usedModel,
        requestKind: opts.requestKind,
        inputTokens: resolvedInputTokens,
        outputTokens: resolvedOutputTokens,
        cacheReadTokens: parsedUsage.cacheReadTokens || undefined,
        cacheWriteTokens: parsedUsage.cacheWriteTokens || undefined,
        upstreamCostUsd: parsedUsage.upstreamCostUsd,
        estimated: promptTokens == null || completionTokens == null,
      });
    } catch (error) {
      console.warn("[api-cost-ledger] usage record skipped:", (error as Error).message);
    }
  }
  return {
    text,
    usage,
  };
}
