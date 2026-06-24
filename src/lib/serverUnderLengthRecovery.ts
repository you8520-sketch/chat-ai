import type { ChatMsg, StageUsage } from "@/lib/ai";
import { callOpenRouterAdult } from "@/lib/openRouterAdult";
import { visibleAssistantDisplayCharCount } from "@/lib/chatDisplayLength";
import {
  buildServerUnderLengthRecoveryUserMessage,
  needsServerUnderLengthRecovery,
} from "@/lib/responseLength";
import { traceRecoveryMerge } from "@/lib/recoveryMergeDiagnostic";
import {
  buildRecoveryContinuationRequest,
  buildRecoveryContinuationSystemPrompt,
  SERVER_UNDER_LENGTH_RECOVERY_ENABLED,
  TURN_LENGTH_SUPPLEMENT_API_ENABLED,
  type TurnApiBudget,
} from "@/lib/turnApiBudget";

export type ServerUnderLengthRecoveryOpts = {
  prose: string;
  finishReason: string | undefined | null;
  system: string;
  modelId: string;
  targetResponseChars?: number | null;
  charName: string;
  turnApiBudget?: TurnApiBudget;
  sessionId?: string;
};

export type ServerUnderLengthRecoveryResult = {
  prose: string;
  triggered: boolean;
  charsBefore: number;
  charsAfter: number;
  stage?: StageUsage;
};

/** One-shot server continuation when clean stop finishes below 85% of target — separate from legacy recovery. */
export async function tryServerUnderLengthRecovery(
  opts: ServerUnderLengthRecoveryOpts
): Promise<ServerUnderLengthRecoveryResult> {
  const prior = opts.prose.trim();
  const charsBefore = visibleAssistantDisplayCharCount(prior);

  if (!TURN_LENGTH_SUPPLEMENT_API_ENABLED || !SERVER_UNDER_LENGTH_RECOVERY_ENABLED) {
    return { prose: prior, triggered: false, charsBefore, charsAfter: charsBefore };
  }

  const shouldTrigger = needsServerUnderLengthRecovery(
    prior,
    opts.finishReason,
    opts.targetResponseChars
  );

  if (!shouldTrigger) {
    console.log("[under-length-server-recovery]", {
      triggered: false,
      chars_before: charsBefore,
      chars_after: charsBefore,
      merge_rejected: false,
      merge_rejected_reason: null,
      finish_reason: opts.finishReason ?? null,
    });
    return { prose: prior, triggered: false, charsBefore, charsAfter: charsBefore };
  }

  if (!opts.turnApiBudget?.canSubCall()) {
    console.warn("[under-length-server-recovery] sub-call budget exhausted — skip");
    console.log("[under-length-server-recovery]", {
      triggered: false,
      chars_before: charsBefore,
      chars_after: charsBefore,
      merge_rejected: false,
      merge_rejected_reason: null,
      skipped: "budget",
    });
    return { prose: prior, triggered: false, charsBefore, charsAfter: charsBefore };
  }

  const userMsg = buildServerUnderLengthRecoveryUserMessage();
  const contSystem = `${opts.system}\n\n${buildRecoveryContinuationSystemPrompt(opts.charName)}`;
  const { history, recoveryAssistantPrefill, claudeRecovery } = buildRecoveryContinuationRequest(
    prior,
    userMsg,
    opts.modelId
  );

  opts.turnApiBudget.beforeFetch("server-under-length-recovery");

  const result = await callOpenRouterAdult(
    contSystem,
    history,
    opts.modelId,
    opts.targetResponseChars,
    {
      charName: opts.charName,
      recoveryAssistantPrefill,
      skipAssistantPrefill: !recoveryAssistantPrefill?.trim(),
      claudeRecovery,
      sessionId: opts.sessionId,
    },
    {
      requestKind: "server-under-length-recovery",
      turnApiBudget: opts.turnApiBudget,
      chargeTurnBudget: false,
    }
  );

  const mergeTrace = traceRecoveryMerge({
    prior,
    recoveryRaw: result.text,
    targetResponseChars: opts.targetResponseChars,
    mergeOpts: { claudeRecovery },
  });

  const prose = mergeTrace.finalProse;
  const charsAfter = visibleAssistantDisplayCharCount(prose);
  const mergeRejected = charsAfter === charsBefore;

  console.log("[under-length-server-recovery]", {
    triggered: true,
    chars_before: charsBefore,
    chars_after: charsAfter,
    merge_rejected: mergeRejected,
    merge_rejected_reason: mergeRejected ? mergeTrace.rejectReason : null,
    recovery_tokens_generated: result.usage.outputTokens,
    recovery_raw_chars: visibleAssistantDisplayCharCount(result.text),
    recovery_deduped_tail_chars: visibleAssistantDisplayCharCount(mergeTrace.dedupedTail),
    recovery_capped_tail_chars: visibleAssistantDisplayCharCount(mergeTrace.cappedTail),
    finish_reason: opts.finishReason ?? null,
  });

  return {
    prose,
    triggered: prose.length > prior.length,
    charsBefore,
    charsAfter,
    stage: {
      stage: "server-under-length-recovery",
      model: opts.modelId,
      input: result.usage.inputTokens,
      output: result.usage.outputTokens,
      apiOutputTokens: result.usage.outputTokens,
      estimated: result.usage.estimated,
      finishReason: result.usage.finishReason,
      ...(result.usage.reasoningOutputTokens != null && result.usage.reasoningOutputTokens > 0
        ? { apiReasoningOutputTokens: result.usage.reasoningOutputTokens }
        : {}),
    },
  };
}

/** @deprecated use lastRpUserMessageFromHistory from inputEchoCheck */
export function lastUserMessageFromHistory(history: ChatMsg[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg?.role === "user") return msg.content;
  }
  return "";
}
