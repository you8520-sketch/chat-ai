/** Direct CheaperInference transport for Creative OOC HTML bench (no failover). */
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "../src/lib/cheaperInferenceConfig";
import {
  isCheaperInferenceDeepSeekV4ProModel,
  isGpt56LunaModel,
} from "../src/lib/chatModels";
import { resolveOpenRouterCompletionTimeoutMs } from "../src/lib/openRouterCompletion";
import { parseOpenRouterUsage } from "../src/lib/openRouterUsage";
import { HTML_FLASH_MAX_OUTPUT_TOKENS } from "../src/lib/htmlVisualCardRecovery";

export type BenchCallResult = {
  modelId: string;
  rawText: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  finishReason: string | null;
  httpStatus: number | null;
  error: string | null;
  timeout: boolean;
  empty: boolean;
  outboundThinkingOff: boolean;
  outboundReasoningNone: boolean;
};

function verifyOutboundFlags(body: Record<string, unknown>, model: string) {
  const thinking = body.thinking as { type?: string } | undefined;
  const reasoning = body.reasoning as { effort?: string } | undefined;
  return {
    outboundThinkingOff:
      isCheaperInferenceDeepSeekV4ProModel(model) && thinking?.type === "disabled",
    outboundReasoningNone:
      isGpt56LunaModel(model) &&
      reasoning?.effort === "none" &&
      body.reasoning_effort === "none",
  };
}

export async function benchDirectCreativeOocHtmlCall(opts: {
  modelId: string;
  system: string;
  userContent: string;
}): Promise<BenchCallResult> {
  const started = Date.now();
  const requestKind = "background-html-visual-card";
  const timeoutMs = resolveOpenRouterCompletionTimeoutMs(requestKind);
  const baseBody: Record<string, unknown> = {
    model: opts.modelId,
    messages: [
      { role: "system", content: opts.system.trim() },
      { role: "user", content: opts.userContent.trim() },
    ],
    stream: false,
    temperature: 0.3,
    max_tokens: HTML_FLASH_MAX_OUTPUT_TOKENS,
    reasoning: { effort: "none" as const },
    include_reasoning: false,
  };
  const outbound = adaptCheaperInferenceChatBody(baseBody);
  const flags = verifyOutboundFlags(outbound, opts.modelId);

  try {
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
      body: JSON.stringify(outbound),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const body = await res.text();
      return {
        modelId: opts.modelId,
        rawText: "",
        latencyMs,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        finishReason: null,
        httpStatus: res.status,
        error: body.slice(0, 500),
        timeout: false,
        empty: true,
        ...flags,
      };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: unknown;
    };
    const rawText = data.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = parseOpenRouterUsage(data.usage, res.headers);
    return {
      modelId: opts.modelId,
      rawText,
      latencyMs,
      inputTokens: parsed.promptTokens,
      outputTokens: parsed.completionTokens,
      reasoningTokens: parsed.reasoningTokens,
      finishReason: data.choices?.[0]?.finish_reason ?? null,
      httpStatus: res.status,
      error: rawText ? null : `empty (finish=${data.choices?.[0]?.finish_reason ?? "unknown"})`,
      timeout: false,
      empty: !rawText,
      ...flags,
    };
  } catch (e) {
    const latencyMs = Date.now() - started;
    const msg = (e as Error).message ?? String(e);
    return {
      modelId: opts.modelId,
      rawText: "",
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      finishReason: null,
      httpStatus: null,
      error: msg.slice(0, 500),
      timeout: /timeout|aborted|AbortError/i.test(msg),
      empty: true,
      ...flags,
    };
  }
}
