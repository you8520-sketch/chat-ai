/**
 * Authorial-habit JEV read-only runtime shadow — default OFF.
 *
 * Existing authorialHabitAudit remains the lexical candidate owner.
 * One bounded Decisions call may observe one dominant lexical target per
 * finalized assistant generation. This module never mutates prompt/output,
 * retries/regenerates, or changes user billing.
 */
import {
  callJevDecisions,
  JevDecisionsError,
  JEV_DECISIONS_MODEL,
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
  AUTHORIAL_HABIT_JEV_QUESTION_ID,
  AUTHORIAL_HABIT_TARGETS,
  assertAuthorialHabitJevStateHasNoPrivateIdentifiers,
  buildAuthorialHabitJevQuestions,
  buildAuthorialHabitJevStateFromText,
  evaluateAuthorialHabitTarget,
  parseAuthorialHabitJevVerdict,
  type AuthorialHabitLexicalSignals,
} from "@/lib/authorialHabitJevJudge";
import type {
  AuthorialHabitSemanticVerdict,
  AuthorialHabitTarget,
} from "@/lib/authorialHabitJevCorpus";
import {
  AUTHORIAL_HABIT_JEV_RUNTIME_MAX_CALLS,
  tryReserveAuthorialHabitJevRuntimeCall,
  type AuthorialHabitJevBudgetReservation,
} from "@/lib/authorialHabitJevRuntimeBudget";
import { buildPlatformAsyncTurnLedgerContext } from "@/lib/providerCostLedger";

export const AUTHORIAL_HABIT_JEV_QA_ENV = "AUTHORIAL_HABIT_JEV_QA_ENABLED";
export const AUTHORIAL_HABIT_JEV_QA_REQUEST_KIND = "authorial-habit-jev-qa";
export const AUTHORIAL_HABIT_JEV_QA_CLAIM_DOMAIN = "authorial-habit-jev-qa";
export const AUTHORIAL_HABIT_JEV_JUSTIFIED_CONFIDENCE_GATE = 0.5;

export type AuthorialHabitReviewPriority =
  | "high_priority_review"
  | "low_priority_review"
  | "needs_review";

export type AuthorialHabitRuntimeCandidateTarget = {
  target: AuthorialHabitTarget;
  hitCount: number;
  maxDensityPer1k: number;
};

export type AuthorialHabitRuntimeCandidate = {
  target: AuthorialHabitTarget;
  signals: AuthorialHabitLexicalSignals;
  candidateTargets: AuthorialHabitRuntimeCandidateTarget[];
};

export function isAuthorialHabitJevQaEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[AUTHORIAL_HABIT_JEV_QA_ENV]?.trim() === "1";
}

export function resetAuthorialHabitJevQaSentinelForTests(): void {
  resetGenerationAuxQaClaimsForTests(AUTHORIAL_HABIT_JEV_QA_CLAIM_DOMAIN);
}

export function evaluateAuthorialHabitRuntimeCandidate(
  prose: string
): AuthorialHabitRuntimeCandidate | null {
  const text = prose.trim();
  if (!text) return null;

  const candidates = AUTHORIAL_HABIT_TARGETS.map((target, index) => {
    const evaluated = evaluateAuthorialHabitTarget({
      id: "runtime-shadow",
      source: "runtime-shadow",
      target,
      text,
    });
    return {
      index,
      target,
      evaluated,
    };
  }).filter((row) => row.evaluated.candidate);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const hitDelta = b.evaluated.signals.hitCount - a.evaluated.signals.hitCount;
    if (hitDelta !== 0) return hitDelta;
    const densityDelta =
      b.evaluated.signals.maxDensityPer1k -
      a.evaluated.signals.maxDensityPer1k;
    if (densityDelta !== 0) return densityDelta;
    return a.index - b.index;
  });

  const selected = candidates[0]!;
  return {
    target: selected.target,
    signals: selected.evaluated.signals,
    candidateTargets: candidates.map((row) => ({
      target: row.target,
      hitCount: row.evaluated.signals.hitCount,
      maxDensityPer1k: row.evaluated.signals.maxDensityPer1k,
    })),
  };
}

export function mapAuthorialHabitVerdictToReviewPriority(input: {
  verdict: AuthorialHabitSemanticVerdict | null;
  confidence: number | null;
}): AuthorialHabitReviewPriority {
  if (input.verdict === "HABIT_PRESENT") return "high_priority_review";
  if (
    input.verdict === "CONTEXTUALLY_JUSTIFIED" &&
    input.confidence != null &&
    input.confidence >= AUTHORIAL_HABIT_JEV_JUSTIFIED_CONFIDENCE_GATE
  ) {
    return "low_priority_review";
  }
  return "needs_review";
}

export type AuthorialHabitJevQaEligibility =
  | { eligible: false; reason: string; providerCalls: 0 }
  | { eligible: true; candidate: AuthorialHabitRuntimeCandidate; prose: string };

export function evaluateAuthorialHabitJevQaEligibility(input: {
  env?: NodeJS.ProcessEnv;
  assistantProse: string;
}): AuthorialHabitJevQaEligibility {
  const env = input.env ?? process.env;
  if (!isAuthorialHabitJevQaEnabled(env)) {
    return {
      eligible: false,
      reason: "AUTHORIAL_HABIT_JEV_QA_ENABLED!=1",
      providerCalls: 0,
    };
  }
  const prose = input.assistantProse.trim();
  if (!prose) {
    return { eligible: false, reason: "no_meaningful_final_prose", providerCalls: 0 };
  }
  const candidate = evaluateAuthorialHabitRuntimeCandidate(prose);
  if (!candidate) {
    return {
      eligible: false,
      reason: "deterministic_candidate_zero",
      providerCalls: 0,
    };
  }
  return { eligible: true, candidate, prose };
}

export type AuthorialHabitJevQaLogFields = {
  chatId: number;
  assistantMessageId: number;
  generationSequence: number;
  generationRequestId: string | null;
  selectedTarget: AuthorialHabitTarget;
  candidateTargets: AuthorialHabitRuntimeCandidateTarget[];
  selectedSignals: AuthorialHabitLexicalSignals;
  jevVerdict: AuthorialHabitSemanticVerdict | null;
  choiceConfidence: number | null;
  choiceProbabilities: Partial<Record<AuthorialHabitSemanticVerdict, number>> | null;
  reviewPriority: AuthorialHabitReviewPriority;
  justifiedSuppressionEligible: boolean;
  budgetUsed: number | null;
  budgetLimit: number;
  latencyMs: number;
  providerCostUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  providerCalls: number;
  malformed: boolean;
  failure: string | null;
  model: string;
};

export function logAuthorialHabitJevQaResult(
  fields: AuthorialHabitJevQaLogFields
): void {
  if (process.env.NODE_TEST_CONTEXT) return;
  console.info("[authorial_habit_jev_qa]", {
    event: "authorial_habit_jev_qa",
    ...fields,
  });
}

export type ScheduleAuthorialHabitJevQaInput = {
  chatId: number;
  generationScope: AssistantGenerationScope;
  assistantProse: string;
  env?: NodeJS.ProcessEnv;
  callDecisions?: typeof callJevDecisions;
  reserveBudget?: () => AuthorialHabitJevBudgetReservation;
  skipStaleGenerationGuard?: boolean;
  onResult?: (fields: AuthorialHabitJevQaLogFields) => void;
};

export function scheduleAuthorialHabitJevQa(
  input: ScheduleAuthorialHabitJevQaInput
): { scheduled: boolean; reason: string; providerCallsExpected: 0 | 1 } {
  const eligibility = evaluateAuthorialHabitJevQaEligibility({
    env: input.env,
    assistantProse: input.assistantProse,
  });
  if (!eligibility.eligible) {
    return {
      scheduled: false,
      reason: eligibility.reason,
      providerCallsExpected: 0,
    };
  }

  if (
    !tryClaimGenerationAuxQaJob(
      AUTHORIAL_HABIT_JEV_QA_CLAIM_DOMAIN,
      input.generationScope
    )
  ) {
    return {
      scheduled: false,
      reason: "generation_already_claimed",
      providerCallsExpected: 0,
    };
  }

  const candidate = eligibility.candidate;
  const prose = eligibility.prose;
  const call = input.callDecisions ?? callJevDecisions;
  const reserveBudget =
    input.reserveBudget ?? (() => tryReserveAuthorialHabitJevRuntimeCall());

  void (async () => {
    const started = performance.now();
    let verdict: AuthorialHabitSemanticVerdict | null = null;
    let confidence: number | null = null;
    let probabilities:
      | Partial<Record<AuthorialHabitSemanticVerdict, number>>
      | null = null;
    let malformed = false;
    let failure: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd: number | null = null;
    let providerCalls = 0;
    let budgetUsed: number | null = null;
    let budgetLimit = AUTHORIAL_HABIT_JEV_RUNTIME_MAX_CALLS;

    try {
      if (
        !input.skipStaleGenerationGuard &&
        !isCurrentAssistantGeneration(input.generationScope)
      ) {
        failure = "stale_generation_before_call";
        return;
      }

      const state = buildAuthorialHabitJevStateFromText({
        target: candidate.target,
        text: prose,
        signals: candidate.signals,
      });
      const privacyHits = assertAuthorialHabitJevStateHasNoPrivateIdentifiers(
        state as unknown as Record<string, unknown>
      );
      if (privacyHits.length > 0) {
        failure = `jev_state_invariant_violation:${privacyHits.join(",")}`;
        return;
      }

      let budget: AuthorialHabitJevBudgetReservation;
      try {
        budget = reserveBudget();
      } catch (error) {
        failure = `budget_reservation_error:${(error as Error).message}`.slice(
          0,
          240
        );
        return;
      }
      budgetUsed = budget.used;
      budgetLimit = budget.limit;
      if (!budget.reserved) {
        failure =
          budget.reason === "budget_exhausted"
            ? "runtime_budget_exhausted"
            : "runtime_budget_state_invalid";
        return;
      }

      providerCalls = 1;
      const result = await call({
        state,
        questions: buildAuthorialHabitJevQuestions(),
        timeoutMs: 45_000,
        ledger: {
          requestKind: AUTHORIAL_HABIT_JEV_QA_REQUEST_KIND,
          provenanceContext: buildPlatformAsyncTurnLedgerContext({
            chatId: input.chatId,
            assistantMessageId: input.generationScope.assistantMessageId,
            generationSequence: input.generationScope.generationSequence,
            generationRequestId: input.generationScope.generationRequestId,
            family: "background",
            jobAttemptOrdinal: 1,
            requestedProvider: "openrouter",
            requestedModel: JEV_DECISIONS_MODEL,
            requestKind: AUTHORIAL_HABIT_JEV_QA_REQUEST_KIND,
          }),
        },
      });
      inputTokens = result.usage.inputTokens;
      outputTokens = result.usage.outputTokens;
      costUsd = result.usage.upstreamCostUsd ?? null;
      verdict = parseAuthorialHabitJevVerdict(
        result.answers as Record<string, { type?: string; choice?: string }>
      );
      const answer = result.answers[AUTHORIAL_HABIT_JEV_QUESTION_ID];
      if (answer?.type === "choice") {
        confidence = answer.confidence;
        probabilities = {
          HABIT_PRESENT: answer.probabilities.HABIT_PRESENT,
          CONTEXTUALLY_JUSTIFIED:
            answer.probabilities.CONTEXTUALLY_JUSTIFIED,
          UNCERTAIN: answer.probabilities.UNCERTAIN,
        };
      }
      malformed = verdict == null;
      if (malformed) failure = "jev_malformed_or_unmappable";

      assertNoDuplicateAuxProviderSuccess({
        assistantMessageId: input.generationScope.assistantMessageId,
        generationSequence: input.generationScope.generationSequence,
        requestKind: AUTHORIAL_HABIT_JEV_QA_REQUEST_KIND,
      });

      if (
        !input.skipStaleGenerationGuard &&
        !isCurrentAssistantGeneration(input.generationScope)
      ) {
        failure = failure ?? "stale_generation_after_call";
      }
    } catch (error) {
      failure = ((error as Error).message || "jev_transport_error").slice(0, 240);
      malformed =
        error instanceof JevDecisionsError &&
        error.code === "invalid_response";
    } finally {
      completeGenerationAuxQaJob(
        AUTHORIAL_HABIT_JEV_QA_CLAIM_DOMAIN,
        input.generationScope
      );
      const reviewPriority = mapAuthorialHabitVerdictToReviewPriority({
        verdict,
        confidence,
      });
      const fields: AuthorialHabitJevQaLogFields = {
        chatId: input.chatId,
        assistantMessageId: input.generationScope.assistantMessageId,
        generationSequence: input.generationScope.generationSequence,
        generationRequestId: input.generationScope.generationRequestId,
        selectedTarget: candidate.target,
        candidateTargets: candidate.candidateTargets,
        selectedSignals: candidate.signals,
        jevVerdict: verdict,
        choiceConfidence: confidence,
        choiceProbabilities: probabilities,
        reviewPriority,
        justifiedSuppressionEligible:
          reviewPriority === "low_priority_review",
        budgetUsed,
        budgetLimit,
        latencyMs: Math.round((performance.now() - started) * 10) / 10,
        providerCostUsd: costUsd,
        inputTokens,
        outputTokens,
        providerCalls,
        malformed,
        failure,
        model: JEV_DECISIONS_MODEL,
      };
      logAuthorialHabitJevQaResult(fields);
      input.onResult?.(fields);
    }
  })();

  return { scheduled: true, reason: "scheduled", providerCallsExpected: 1 };
}
