import { OPENROUTER_GEMINI_31_FLASH_MODEL } from "@/lib/chatModels";
import { callOpenRouterCompletion } from "@/lib/openRouterCompletion";
import { isDemoEnv } from "@/lib/demo";
import {
  COMMENT_SEMANTIC_MODERATION_SYSTEM,
  buildCommentSemanticModerationUserPrompt,
  parseCommentSemanticModerationVerdict,
  type CommentSemanticModerationInput,
  type CommentSemanticVerdict,
} from "@/lib/commentSemanticModerationPolicy";
export {
  countAuthorModerationBlocks,
  insertCommentModerationLog,
  maybeBanCommentAuthor,
} from "@/lib/commentModerationStorage";

export type CommentAiVerdict = CommentSemanticVerdict;

export type CommentAiResponseSource =
  | "model"
  | "parse_fail_block"
  | "transport_fail_block"
  | "dev_skip";

export type CommentAiModerationResult = {
  verdict: CommentAiVerdict;
  reason: string;
  estimated: boolean;
  /** Present when a provider response (or mock) was obtained. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    estimated: boolean;
    upstreamCostUsd?: number;
  };
  /** Distinguishes actual model verdict from fail-closed fallbacks. */
  responseSource: CommentAiResponseSource;
};

export async function moderateCommentWithAi(
  input: CommentSemanticModerationInput & {
    /**
     * Benchmark-only OpenRouter credential override. Production callers omit
     * this and continue using the canonical production key resolver.
     */
    openRouterApiKey?: string;
    /** When false, skip background cost ledger writes (benchmark). Default true. */
    persistBackgroundLedger?: boolean;
  }
): Promise<CommentAiModerationResult> {
  if (isDemoEnv() && process.env.SKIP_COMMENT_MODERATION === "1") {
    return { verdict: "ALLOW", reason: "dev skip", estimated: true, responseSource: "dev_skip" };
  }

  const userPrompt = buildCommentSemanticModerationUserPrompt(input);

  try {
    const { text, usage } = await callOpenRouterCompletion({
      system: COMMENT_SEMANTIC_MODERATION_SYSTEM,
      history: [{ role: "user", content: userPrompt }],
      model: process.env.COMMENT_MODERATION_MODEL?.trim() || OPENROUTER_GEMINI_31_FLASH_MODEL,
      temperature: 0.1,
      maxTokens: 64,
      requestKind: "comment-moderation",
      timeoutMs: 30_000,
      openRouterApiKeyOverride: input.openRouterApiKey,
      persistBackgroundLedger: input.persistBackgroundLedger,
    });
    const usageOut = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimated: usage.estimated,
      ...(usage.upstreamCostUsd != null ? { upstreamCostUsd: usage.upstreamCostUsd } : {}),
    };
    const parsed = parseCommentSemanticModerationVerdict(text);
    if (parsed) {
      return { ...parsed, estimated: false, usage: usageOut, responseSource: "model" };
    }
    return {
      verdict: "BLOCK",
      reason: "AI 응답 파싱 실패 — 보수적 차단",
      estimated: false,
      usage: usageOut,
      responseSource: "parse_fail_block",
    };
  } catch (err) {
    console.error("[comment-moderation] AI failed", err);
    return {
      verdict: "BLOCK",
      reason: "AI 검수 실패 — 보수적 차단",
      estimated: true,
      responseSource: "transport_fail_block",
    };
  }
}
