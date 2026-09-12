import { callBackgroundMemory } from "@/lib/ai";
import { CompatibleCompletionError } from "@/lib/openRouterCompletion";
import type { StatusWidgetExtractCaller } from "@/lib/statusWidget/extract";
import {
  buildPostTurnSharedInitialSystem,
  buildPostTurnSharedInitialUserBlock,
} from "./prompt";
import { parsePostTurnSharedInitialResponse } from "./parse";
import {
  POST_TURN_SHARED_INITIAL_REQUEST_KIND,
  type PostTurnSharedInitialInput,
  type PostTurnSharedInitialRunResult,
} from "./types";

function emptySharedRunResult(
  overrides: Partial<PostTurnSharedInitialRunResult> = {}
): PostTurnSharedInitialRunResult {
  return {
    attempted: false,
    transportOk: false,
    text: "",
    usage: null,
    parsed: null,
    httpStatus: null,
    finishReason: null,
    errorCode: null,
    ...overrides,
  };
}

/** Canonical owner — exactly one physical shared initial provider call per eligible turn. */
export async function runPostTurnSharedInitial(
  input: PostTurnSharedInitialInput,
  caller?: StatusWidgetExtractCaller,
  ledgerContext?: import("@/lib/providerCostLedger").ProviderCostLedgerContext
): Promise<PostTurnSharedInitialRunResult> {
  const invoke =
    caller ??
    (async (system, history, opts) =>
      callBackgroundMemory(system, history, undefined, opts.requestKind, {
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        modelId: opts.modelId,
        ledgerContext,
      }));

  const system = buildPostTurnSharedInitialSystem(input);
  const userBlock = buildPostTurnSharedInitialUserBlock(input);
  if (!userBlock.trim()) {
    return emptySharedRunResult();
  }

  try {
    const { text, usage } = await invoke(
      system,
      [{ role: "user", content: userBlock }],
      {
        requestKind: POST_TURN_SHARED_INITIAL_REQUEST_KIND,
        modelId: input.primaryModelId,
        maxTokens: undefined,
        temperature: 0.4,
      }
    );
    const parsed = parsePostTurnSharedInitialResponse(text ?? "", input);
    return {
      attempted: true,
      transportOk: true,
      text: text ?? "",
      usage: usage ?? null,
      parsed,
      httpStatus: 200,
      finishReason: usage?.finishReason ?? null,
      errorCode: null,
    };
  } catch (e) {
    console.error("[POST-TURN-SHARED-INITIAL] provider call failed", (e as Error).message);
    if (e instanceof CompatibleCompletionError) {
      return emptySharedRunResult({
        attempted: true,
        transportOk: false,
        usage: e.usage,
        httpStatus: e.httpStatus,
        finishReason: e.finishReason,
        errorCode: e.name,
      });
    }
    const message = e instanceof Error ? e.message : String(e);
    const statusMatch = message.match(/\b([45]\d{2})\b/);
    return emptySharedRunResult({
      attempted: true,
      transportOk: false,
      httpStatus: statusMatch ? Number(statusMatch[1]) : null,
      errorCode: e instanceof Error ? e.name || "Error" : "Error",
    });
  }
}

/**
 * Canonical post-turn inference owner for status-OFF turns: the SAME shared
 * runner in relationship-only mode. No separate relationship orchestrator.
 */
export async function runPostTurnRelationshipOnlyInitial(
  input: {
    charName: string;
    personaName: string;
    userMessage: string;
    assistantProse: string;
    primaryModelId: string;
    previousAssistantMessage?: string | null;
    /** Also produce suggested replies in the same inference (status OFF + suggestions ON). */
    includeSuggestions?: boolean;
    /** Relationship consumer active (default true for the relationship owner). */
    includeRelationship?: boolean;
    personaDescription?: string | null;
    personaSpeechExamples?: string | null;
    userPersona?: string | null;
  },
  caller?: StatusWidgetExtractCaller,
  ledgerContext?: import("@/lib/providerCostLedger").ProviderCostLedgerContext
): Promise<PostTurnSharedInitialRunResult> {
  return runPostTurnSharedInitial(
    {
      mode: "relationship_only",
      charName: input.charName,
      personaName: input.personaName,
      userMessage: input.userMessage,
      assistantProse: input.assistantProse,
      primaryModelId: input.primaryModelId,
      userPersona: input.userPersona ?? null,
      personaDescription: input.personaDescription ?? null,
      personaSpeechExamples: input.personaSpeechExamples ?? null,
      includeSuggestions: input.includeSuggestions === true,
      includeRelationship: input.includeRelationship !== false,
      relationshipRegenContext: input.previousAssistantMessage?.trim()
        ? { previousAssistantMessage: input.previousAssistantMessage }
        : null,
    },
    caller,
    ledgerContext
  );
}
