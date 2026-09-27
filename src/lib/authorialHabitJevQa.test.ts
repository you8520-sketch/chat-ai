import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { callJevDecisions } from "@/lib/jevDecisions";
import { AUTHORIAL_HABIT_JEV_CORPUS } from "@/lib/authorialHabitJevCorpus";
import {
  AUTHORIAL_HABIT_JEV_QA_ENV,
  AUTHORIAL_HABIT_JEV_JUSTIFIED_CONFIDENCE_GATE,
  evaluateAuthorialHabitJevQaEligibility,
  evaluateAuthorialHabitRuntimeCandidate,
  mapAuthorialHabitVerdictToReviewPriority,
  resetAuthorialHabitJevQaSentinelForTests,
  scheduleAuthorialHabitJevQa,
  type AuthorialHabitJevQaLogFields,
} from "@/lib/authorialHabitJevQa";
import { resetAuxProviderSuccessSentinelForTests } from "@/lib/auxProviderProvenance";

const endHabit = AUTHORIAL_HABIT_JEV_CORPUS.find((row) => row.id === "AH_END_01")!;
const handHabit = AUTHORIAL_HABIT_JEV_CORPUS.find((row) => row.id === "AH_HAND_01")!;

beforeEach(() => {
  resetAuthorialHabitJevQaSentinelForTests();
  resetAuxProviderSuccessSentinelForTests();
});

function fakeChoiceCall(input: {
  choice: "HABIT_PRESENT" | "CONTEXTUALLY_JUSTIFIED" | "UNCERTAIN";
  confidence: number;
  probabilities?: Record<string, number>;
  cost?: number;
}): typeof callJevDecisions {
  return (async () => ({
    answers: {
      authorial_habit_verdict: {
        type: "choice" as const,
        choice: input.choice,
        probabilities:
          input.probabilities ?? {
            HABIT_PRESENT: input.choice === "HABIT_PRESENT" ? 0.8 : 0.1,
            CONTEXTUALLY_JUSTIFIED:
              input.choice === "CONTEXTUALLY_JUSTIFIED" ? 0.8 : 0.1,
            UNCERTAIN: input.choice === "UNCERTAIN" ? 0.8 : 0.1,
          },
        confidence: input.confidence,
      },
    },
    usage: {
      inputTokens: 100,
      outputTokens: 10,
      estimated: false,
      upstreamCostUsd: input.cost ?? 0.00003,
    },
    responseModel: "typesafe/jev-1.13-test",
  })) as typeof callJevDecisions;
}

function waitForResult(
  schedule: (onResult: (fields: AuthorialHabitJevQaLogFields) => void) => void
): Promise<AuthorialHabitJevQaLogFields> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("authorial JEV result timeout")), 2_000);
    schedule((fields) => {
      clearTimeout(timer);
      resolve(fields);
    });
  });
}

describe("authorial habit runtime shadow eligibility", () => {
  it("is default OFF and schedules zero provider calls while disabled", () => {
    const result = evaluateAuthorialHabitJevQaEligibility({
      env: {} as NodeJS.ProcessEnv,
      assistantProse: handHabit.text,
    });
    assert.deepEqual(result, {
      eligible: false,
      reason: "AUTHORIAL_HABIT_JEV_QA_ENABLED!=1",
      providerCalls: 0,
    });
  });

  it("reuses existing lexical target groups and deterministically selects the strongest target", () => {
    const candidate = evaluateAuthorialHabitRuntimeCandidate(endHabit.text);
    assert.ok(candidate);
    assert.equal(candidate.target, "gaze_silence_wait_end");
    assert.ok(candidate.signals.hitCount > 0);
    assert.ok(
      candidate.candidateTargets.some(
        (row) => row.target === "gaze_silence_wait_end"
      )
    );
  });

  it("keeps low-confidence JUSTIFIED in review and only strong JUSTIFIED low-priority", () => {
    assert.equal(AUTHORIAL_HABIT_JEV_JUSTIFIED_CONFIDENCE_GATE, 0.5);
    assert.equal(
      mapAuthorialHabitVerdictToReviewPriority({
        verdict: "CONTEXTUALLY_JUSTIFIED",
        confidence: 0.31,
      }),
      "needs_review"
    );
    assert.equal(
      mapAuthorialHabitVerdictToReviewPriority({
        verdict: "CONTEXTUALLY_JUSTIFIED",
        confidence: 0.82,
      }),
      "low_priority_review"
    );
    assert.equal(
      mapAuthorialHabitVerdictToReviewPriority({
        verdict: "HABIT_PRESENT",
        confidence: 0.1,
      }),
      "high_priority_review"
    );
  });
});

describe("authorial habit runtime shadow scheduling", () => {
  it("fails closed at the 50k budget boundary without a provider call", async () => {
    let calls = 0;
    const result = await waitForResult((onResult) => {
      const scheduled = scheduleAuthorialHabitJevQa({
        chatId: 1,
        generationScope: {
          assistantMessageId: 1001,
          generationSequence: 0,
          generationRequestId: "budget-cap",
        },
        assistantProse: handHabit.text,
        env: { [AUTHORIAL_HABIT_JEV_QA_ENV]: "1" } as NodeJS.ProcessEnv,
        skipStaleGenerationGuard: true,
        reserveBudget: () => ({
          reserved: false,
          used: 50_000,
          limit: 50_000,
          reason: "budget_exhausted",
        }),
        callDecisions: (async (...args: Parameters<typeof callJevDecisions>) => {
          calls += 1;
          return fakeChoiceCall({
            choice: "HABIT_PRESENT",
            confidence: 0.8,
          })(...args);
        }) as typeof callJevDecisions,
        onResult,
      });
      assert.equal(scheduled.scheduled, true);
    });

    assert.equal(calls, 0);
    assert.equal(result.providerCalls, 0);
    assert.equal(result.failure, "runtime_budget_exhausted");
    assert.equal(result.budgetUsed, 50_000);
    assert.equal(result.budgetLimit, 50_000);
  });

  it("suppresses duplicate scheduling for the same generation while the first call owns the claim", async () => {
    let release!: () => void;
    let calls = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstResult = waitForResult((onResult) => {
      const first = scheduleAuthorialHabitJevQa({
        chatId: 1,
        generationScope: {
          assistantMessageId: 1002,
          generationSequence: 3,
          generationRequestId: "dup",
        },
        assistantProse: handHabit.text,
        env: { [AUTHORIAL_HABIT_JEV_QA_ENV]: "1" } as NodeJS.ProcessEnv,
        skipStaleGenerationGuard: true,
        reserveBudget: () => ({
          reserved: true,
          used: 1,
          limit: 50_000,
          reason: "reserved",
        }),
        callDecisions: (async () => {
          calls += 1;
          await gate;
          return fakeChoiceCall({
            choice: "HABIT_PRESENT",
            confidence: 0.8,
          })({} as never);
        }) as typeof callJevDecisions,
        onResult,
      });
      assert.equal(first.scheduled, true);

      const duplicate = scheduleAuthorialHabitJevQa({
        chatId: 1,
        generationScope: {
          assistantMessageId: 1002,
          generationSequence: 3,
          generationRequestId: "dup",
        },
        assistantProse: handHabit.text,
        env: { [AUTHORIAL_HABIT_JEV_QA_ENV]: "1" } as NodeJS.ProcessEnv,
        skipStaleGenerationGuard: true,
        reserveBudget: () => ({
          reserved: true,
          used: 2,
          limit: 50_000,
          reason: "reserved",
        }),
        callDecisions: fakeChoiceCall({
          choice: "HABIT_PRESENT",
          confidence: 0.8,
        }),
      });
      assert.deepEqual(duplicate, {
        scheduled: false,
        reason: "generation_already_claimed",
        providerCallsExpected: 0,
      });
      release();
    });

    const result = await firstResult;
    assert.equal(calls, 1);
    assert.equal(result.providerCalls, 1);
    assert.equal(result.jevVerdict, "HABIT_PRESENT");
    assert.equal(result.reviewPriority, "high_priority_review");
  });

  it("records low-confidence JUSTIFIED as needs_review without suppress eligibility", async () => {
    const result = await waitForResult((onResult) => {
      scheduleAuthorialHabitJevQa({
        chatId: 2,
        generationScope: {
          assistantMessageId: 1003,
          generationSequence: 0,
          generationRequestId: "low-confidence",
        },
        assistantProse: endHabit.text,
        env: { [AUTHORIAL_HABIT_JEV_QA_ENV]: "1" } as NodeJS.ProcessEnv,
        skipStaleGenerationGuard: true,
        reserveBudget: () => ({
          reserved: true,
          used: 12,
          limit: 50_000,
          reason: "reserved",
        }),
        callDecisions: fakeChoiceCall({
          choice: "CONTEXTUALLY_JUSTIFIED",
          confidence: 0.31,
          probabilities: {
            HABIT_PRESENT: 0.2,
            CONTEXTUALLY_JUSTIFIED: 0.54,
            UNCERTAIN: 0.26,
          },
        }),
        onResult,
      });
    });

    assert.equal(result.providerCalls, 1);
    assert.equal(result.jevVerdict, "CONTEXTUALLY_JUSTIFIED");
    assert.equal(result.choiceConfidence, 0.31);
    assert.equal(result.reviewPriority, "needs_review");
    assert.equal(result.justifiedSuppressionEligible, false);
  });

  it("marks only strong JUSTIFIED as low-priority observation", async () => {
    const result = await waitForResult((onResult) => {
      scheduleAuthorialHabitJevQa({
        chatId: 2,
        generationScope: {
          assistantMessageId: 1004,
          generationSequence: 0,
          generationRequestId: "high-confidence",
        },
        assistantProse: endHabit.text,
        env: { [AUTHORIAL_HABIT_JEV_QA_ENV]: "1" } as NodeJS.ProcessEnv,
        skipStaleGenerationGuard: true,
        reserveBudget: () => ({
          reserved: true,
          used: 13,
          limit: 50_000,
          reason: "reserved",
        }),
        callDecisions: fakeChoiceCall({
          choice: "CONTEXTUALLY_JUSTIFIED",
          confidence: 0.82,
          probabilities: {
            HABIT_PRESENT: 0.01,
            CONTEXTUALLY_JUSTIFIED: 0.88,
            UNCERTAIN: 0.11,
          },
        }),
        onResult,
      });
    });

    assert.equal(result.reviewPriority, "low_priority_review");
    assert.equal(result.justifiedSuppressionEligible, true);
  });
});
