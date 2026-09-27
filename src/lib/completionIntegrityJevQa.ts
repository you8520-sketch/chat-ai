/**
 * Main RP completion-integrity JEV read-only QA triage — default OFF.
 *
 * FEATURE / RUNTIME SHADOW:
 *   deterministic truncation candidates → one Decisions call per assistant generation
 *   → structured priority annotation only
 *
 * Never blocks, continues, regenerates, mutates savedText/billing, or changes
 * generation status. GPT classification:
 *   JEV_COMPLETION_INTEGRITY_QA_TRIAGE_SELECTED_READ_ONLY
 *   JEV_COMPLETION_INTEGRITY_ENFORCEMENT_NOT_SELECTED
 */
import {
  callJevDecisions,
  JEV_DECISIONS_MODEL,
  type JevDecisionQuestions,
} from "@/lib/jevDecisions";
import {
  isCurrentAssistantGeneration,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";
import { assertNoDuplicateAuxProviderSuccess } from "@/lib/auxProviderProvenance";
import {
  completeGenerationAuxQaJob,
  resetGenerationAuxQaClaimsForTests,
  tryClaimGenerationAuxQaJob,
} from "@/lib/generationScopedAuxQaClaim";
import {
  evaluateCompletionIntegrityCandidate,
  type CompletionCandidateReason,
} from "@/lib/completionIntegrityCandidate";

export const COMPLETION_INTEGRITY_JEV_QA_ENV = "COMPLETION_INTEGRITY_JEV_QA_ENABLED";
export const COMPLETION_INTEGRITY_JEV_QA_REQUEST_KIND = "completion-integrity-jev-qa";
export const COMPLETION_INTEGRITY_JEV_QA_QUESTION_ID = "completion_verdict";
export const COMPLETION_INTEGRITY_JEV_QA_CLAIM_DOMAIN = "completion-integrity-jev-qa";

export const COMPLETION_INTEGRITY_JEV_VERDICTS = [
  "ABRUPT_CUT",
  "COMPLETE",
  "UNCERTAIN",
] as const;

export type CompletionIntegrityJevVerdict =
  (typeof COMPLETION_INTEGRITY_JEV_VERDICTS)[number];

export type CompletionIntegrityReviewPriority =
  | "high_priority_review"
  | "low_priority_review"
  | "needs_review";

const TAIL_MAX_CHARS = 800;

const FORBIDDEN_STATE_KEYS = [
  "userId",
  "user_id",
  "accountId",
  "account_id",
  "billing",
  "personaSecret",
  "persona_secret",
  "memoryDb",
  "memory_db",
  "openRouterApiKey",
  "apiKey",
  "credential",
  "password",
  "email",
  "systemPrompt",
  "characterSetting",
] as const;

export function isCompletionIntegrityJevQaEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[COMPLETION_INTEGRITY_JEV_QA_ENV]?.trim() === "1";
}

export function resetCompletionIntegrityJevQaSentinelForTests(): void {
  resetGenerationAuxQaClaimsForTests(COMPLETION_INTEGRITY_JEV_QA_CLAIM_DOMAIN);
}

export function mapCompletionVerdictToReviewPriority(
  verdict: CompletionIntegrityJevVerdict | null
): CompletionIntegrityReviewPriority {
  if (verdict === "ABRUPT_CUT") return "high_priority_review";
  if (verdict === "COMPLETE") return "low_priority_review";
  return "needs_review";
}

export function takeFinalProseTail(prose: string, maxChars = TAIL_MAX_CHARS): string {
  const t = prose.trimEnd();
  if (t.length <= maxChars) return t;
  return t.slice(-maxChars);
}

export function buildCompletionIntegrityJevQaQuestions(): JevDecisionQuestions {
  return {
    [COMPLETION_INTEGRITY_JEV_QA_QUESTION_ID]: {
      type: "choice",
      instructions:
        "Decide whether the delivered assistant prose appears physically/semantically cut off before its current sentence, utterance, or action completes. Do not judge whether the larger story could continue.",
      criteria: {
        ABRUPT_CUT:
          "Output ends inside an unfinished word/predicate/clause/utterance/action or otherwise clearly looks like generation stopped before completing the immediate expression.",
        COMPLETE:
          "Current response is semantically self-contained enough to end here, even if the larger scene remains unresolved or intentionally open-ended.",
        UNCERTAIN:
          "Bounded tail/context is insufficient to distinguish intentional fragment/style from actual generation cut.",
      },
    },
  };
}

export type CompletionIntegrityJevQaState = {
  task: "main_rp_completion_integrity";
  candidateReasons: CompletionCandidateReason[];
  finishReason: string | null;
  localRecoveryApplied: boolean;
  localRecoveryActions: string[];
  finalProseTail: string;
};

export function buildCompletionIntegrityJevQaState(input: {
  candidateReasons: CompletionCandidateReason[];
  finishReason: string | null;
  localRecoveryApplied: boolean;
  localRecoveryActions: string[];
  finalProse: string;
}): CompletionIntegrityJevQaState {
  return {
    task: "main_rp_completion_integrity",
    candidateReasons: [...input.candidateReasons],
    finishReason: input.finishReason,
    localRecoveryApplied: input.localRecoveryApplied,
    localRecoveryActions: [...input.localRecoveryActions],
    finalProseTail: takeFinalProseTail(input.finalProse),
  };
}

export function assertCompletionIntegrityJevStateHasNoPrivateIdentifiers(
  state: Record<string, unknown>
): string[] {
  const hits: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (typeof value !== "object") return;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      for (const forbidden of FORBIDDEN_STATE_KEYS) {
        if (lower === forbidden.toLowerCase() || lower.includes(forbidden.toLowerCase())) {
          hits.push(`${path}.${k}`);
        }
      }
      walk(v, `${path}.${k}`);
    }
  };
  walk(state, "state");
  return hits;
}

export function parseCompletionIntegrityJevVerdict(
  answers: Record<string, { type?: string; choice?: string }>
): CompletionIntegrityJevVerdict | null {
  const row = answers[COMPLETION_INTEGRITY_JEV_QA_QUESTION_ID];
  if (!row || row.type !== "choice" || typeof row.choice !== "string") return null;
  const choice = row.choice.trim();
  if ((COMPLETION_INTEGRITY_JEV_VERDICTS as readonly string[]).includes(choice)) {
    return choice as CompletionIntegrityJevVerdict;
  }
  return null;
}

export type CompletionIntegrityJevQaEligibility =
  | { eligible: false; reason: string; providerCalls: 0 }
  | {
      eligible: true;
      reasons: CompletionCandidateReason[];
      finalProse: string;
    };

export function evaluateCompletionIntegrityJevQaEligibility(input: {
  env?: NodeJS.ProcessEnv;
  finalProse: string;
  finishReason: string | null;
  localRecoveryApplied: boolean;
}): CompletionIntegrityJevQaEligibility {
  const env = input.env ?? process.env;
  if (!isCompletionIntegrityJevQaEnabled(env)) {
    return {
      eligible: false,
      reason: "COMPLETION_INTEGRITY_JEV_QA_ENABLED!=1",
      providerCalls: 0,
    };
  }
  const prose = input.finalProse.trim();
  if (!prose) {
    return { eligible: false, reason: "no_meaningful_final_prose", providerCalls: 0 };
  }
  const evaled = evaluateCompletionIntegrityCandidate({
    finalProse: prose,
    finishReason: input.finishReason,
    localRecoveryApplied: input.localRecoveryApplied,
  });
  if (!evaled.candidate) {
    return { eligible: false, reason: "deterministic_candidate_zero", providerCalls: 0 };
  }
  return { eligible: true, reasons: evaled.reasons, finalProse: prose };
}

export type ScheduleCompletionIntegrityJevQaInput = {
  chatId: number;
  generationScope: AssistantGenerationScope;
  finalProse: string;
  finishReason: string | null;
  localRecoveryApplied: boolean;
  localRecoveryActions: string[];
  env?: NodeJS.ProcessEnv;
  /** Test seam — skip network. */
  callDecisions?: typeof callJevDecisions;
  /** Test seam — skip DB generation-current guard. */
  skipStaleGenerationGuard?: boolean;
};

/**
 * Fire-and-forget read-only QA. Never throws to the Main RP path.
 * At most one Decisions call per (assistantMessageId, generationSequence).
 */
export function scheduleCompletionIntegrityJevQa(
  input: ScheduleCompletionIntegrityJevQaInput
): { scheduled: boolean; reason: string; providerCallsExpected: 0 | 1 } {
  const eligibility = evaluateCompletionIntegrityJevQaEligibility({
    env: input.env,
    finalProse: input.finalProse,
    finishReason: input.finishReason,
    localRecoveryApplied: input.localRecoveryApplied,
  });
  if (!eligibility.eligible) {
    return { scheduled: false, reason: eligibility.reason, providerCallsExpected: 0 };
  }

  if (!tryClaimGenerationAuxQaJob(COMPLETION_INTEGRITY_JEV_QA_CLAIM_DOMAIN, input.generationScope)) {
    return { scheduled: false, reason: "generation_already_claimed", providerCallsExpected: 0 };
  }

  const reasons = eligibility.reasons;
  const prose = eligibility.finalProse;
  const call = input.callDecisions ?? callJevDecisions;
  const recoveryActions = [...input.localRecoveryActions];

  void (async () => {
    const started = performance.now();
    let verdict: CompletionIntegrityJevVerdict | null = null;
    let malformed = false;
    let failure: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd: number | null = null;
    let providerCalls = 0;

    try {
      if (
        !input.skipStaleGenerationGuard &&
        !isCurrentAssistantGeneration(input.generationScope)
      ) {
        failure = "stale_generation_before_call";
        return;
      }
      const state = buildCompletionIntegrityJevQaState({
        candidateReasons: reasons,
        finishReason: input.finishReason,
        localRecoveryApplied: input.localRecoveryApplied,
        localRecoveryActions: recoveryActions,
        finalProse: prose,
      });
      providerCalls = 1;
      const result = await call({
        state,
        questions: buildCompletionIntegrityJevQaQuestions(),
        timeoutMs: 45_000,
        ledger: {
          requestKind: COMPLETION_INTEGRITY_JEV_QA_REQUEST_KIND,
          provenanceContext: {
            chatId: input.chatId,
            assistantMessageId: input.generationScope.assistantMessageId,
            generationSequence: input.generationScope.generationSequence,
            generationRequestId: input.generationScope.generationRequestId,
            family: "background",
            fundingClass: "platform_funded",
            executionPhase: "async_post_turn",
            jobAttemptOrdinal: 1,
            requestedProvider: "openrouter",
            requestedModel: JEV_DECISIONS_MODEL,
            requestKind: COMPLETION_INTEGRITY_JEV_QA_REQUEST_KIND,
          },
        },
      });
      inputTokens = result.usage.inputTokens;
      outputTokens = result.usage.outputTokens;
      costUsd = result.usage.upstreamCostUsd ?? null;
      verdict = parseCompletionIntegrityJevVerdict(
        result.answers as Record<string, { type?: string; choice?: string }>
      );
      malformed = verdict == null;
      if (malformed) failure = "jev_malformed_or_unmappable";
      assertNoDuplicateAuxProviderSuccess({
        assistantMessageId: input.generationScope.assistantMessageId,
        generationSequence: input.generationScope.generationSequence,
        requestKind: COMPLETION_INTEGRITY_JEV_QA_REQUEST_KIND,
      });
      if (
        !input.skipStaleGenerationGuard &&
        !isCurrentAssistantGeneration(input.generationScope)
      ) {
        failure = failure ?? "stale_generation_after_call";
      }
    } catch (e) {
      failure = ((e as Error).message || "jev_transport_error").slice(0, 240);
      malformed = true;
    } finally {
      completeGenerationAuxQaJob(COMPLETION_INTEGRITY_JEV_QA_CLAIM_DOMAIN, input.generationScope);
      const latencyMs = Math.round((performance.now() - started) * 10) / 10;
      const reviewPriority = mapCompletionVerdictToReviewPriority(verdict);
      logCompletionIntegrityJevQaResult({
        chatId: input.chatId,
        assistantMessageId: input.generationScope.assistantMessageId,
        generationSequence: input.generationScope.generationSequence,
        generationRequestId: input.generationScope.generationRequestId,
        finishReason: input.finishReason,
        candidateReasons: reasons,
        localRecoveryApplied: input.localRecoveryApplied,
        localRecoveryActions: recoveryActions,
        jevVerdict: verdict,
        reviewPriority,
        latencyMs,
        providerCostUsd: costUsd,
        inputTokens,
        outputTokens,
        providerCalls,
        malformed,
        failure,
        model: JEV_DECISIONS_MODEL,
      });
    }
  })();

  return { scheduled: true, reason: "scheduled", providerCallsExpected: 1 };
}

export type CompletionIntegrityJevQaLogFields = {
  chatId: number;
  assistantMessageId: number;
  generationSequence: number;
  generationRequestId: string | null;
  finishReason: string | null;
  candidateReasons: CompletionCandidateReason[];
  localRecoveryApplied: boolean;
  localRecoveryActions: string[];
  jevVerdict: CompletionIntegrityJevVerdict | null;
  reviewPriority: CompletionIntegrityReviewPriority;
  latencyMs: number;
  providerCostUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  providerCalls: number;
  malformed: boolean;
  failure: string | null;
  model: string;
};

/** Structured console observability — no secrets, no full prose, no DB write. */
export function logCompletionIntegrityJevQaResult(
  fields: CompletionIntegrityJevQaLogFields
): void {
  if (process.env.NODE_TEST_CONTEXT) return;
  console.info("[completion_integrity_jev_qa]", {
    event: "completion_integrity_jev_qa",
    ...fields,
  });
}
