/**
 * Completion-integrity JEV runtime QA triage — deterministic isolation tests.
 * Covers eligibility, generation-scoped exactly-once, priority mapping,
 * privacy payload, provenance/ledger, and non-mutation invariants (no live provider).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";

import { resolveAuxProviderOwner } from "@/lib/auxProviderProvenance";
import {
  MAX_COMPLETED_AUX_QA_CLAIMS_PER_DOMAIN,
  completeGenerationAuxQaJob,
  resetGenerationAuxQaClaimsForTests,
  tryClaimGenerationAuxQaJob,
} from "@/lib/generationScopedAuxQaClaim";
import { evaluateCompletionIntegrityCandidate } from "@/lib/completionIntegrityCandidate";
import {
  COMPLETION_INTEGRITY_JEV_QA_ENV,
  COMPLETION_INTEGRITY_JEV_QA_QUESTION_ID,
  COMPLETION_INTEGRITY_JEV_QA_REQUEST_KIND,
  assertCompletionIntegrityJevStateHasNoPrivateIdentifiers,
  buildCompletionIntegrityJevQaQuestions,
  buildCompletionIntegrityJevQaState,
  evaluateCompletionIntegrityJevQaEligibility,
  mapCompletionVerdictToReviewPriority,
  resetCompletionIntegrityJevQaSentinelForTests,
  scheduleCompletionIntegrityJevQa,
  takeFinalProseTail,
} from "@/lib/completionIntegrityJevQa";
import {
  resetSceneBoundaryJevQaSentinelForTests,
  scheduleSceneBoundaryJevQa,
  SCENE_BOUNDARY_JEV_QA_ENV,
  SCENE_BOUNDARY_JEV_QA_QUESTION_ID,
} from "@/lib/sceneBoundaryJevQa";
import type { BoundaryExecutionContract } from "@/lib/sceneDirectiveV2";

const ABRUPT_PROSE = "서린은 민의 손목을 잡은 채 조금 더 끌";
const COMPLETE_PROSE = "서린은 창문을 닫고 천천히 소파에 앉았다.";
const TOKEN_LIMIT_COMPLETE = "그는 마지막 문장을 다 쓰고 펜을 내려놓았다.";

const BOUNDARY_CONTRACT: BoundaryExecutionContract = {
  lifecycle: "temporary_quiet",
  noContactKind: "temporary_quiet",
  blocksPhysicalApproach: true,
  blocksRemoteContact: true,
  blocksGiftOrDropOff: true,
  blocksBoundaryNegotiation: true,
  blocksFutureMeetingInitiative: true,
  allowsIndependentRoutine: true,
  allowsInternalAftereffect: true,
};

function scope(seq = 0) {
  return {
    assistantMessageId: 92001,
    generationSequence: seq,
    generationRequestId: "req-completion-qa-1",
  };
}

function mockCall(choice: string | null) {
  return (async () => {
    if (choice == null) {
      return {
        answers: {
          [COMPLETION_INTEGRITY_JEV_QA_QUESTION_ID]: {
            type: "choice" as const,
            choice: "NOT_REAL",
            probabilities: { NOT_REAL: 1 },
            confidence: 0.1,
          },
        },
        usage: { inputTokens: 10, outputTokens: 5, estimated: false, upstreamCostUsd: 0.0001 },
        responseModel: "typesafe/jev-1.13-test",
      };
    }
    return {
      answers: {
        [COMPLETION_INTEGRITY_JEV_QA_QUESTION_ID]: {
          type: "choice" as const,
          choice,
          probabilities: { ABRUPT_CUT: 0.3, COMPLETE: 0.4, UNCERTAIN: 0.3 },
          confidence: 0.8,
        },
      },
      usage: { inputTokens: 12, outputTokens: 6, estimated: false, upstreamCostUsd: 0.0002 },
      responseModel: "typesafe/jev-1.13-test",
    };
  }) as typeof import("@/lib/jevDecisions").callJevDecisions;
}

beforeEach(() => {
  resetCompletionIntegrityJevQaSentinelForTests();
  resetSceneBoundaryJevQaSentinelForTests();
});

afterEach(() => {
  resetCompletionIntegrityJevQaSentinelForTests();
  resetSceneBoundaryJevQaSentinelForTests();
});

describe("completion-integrity JEV eligibility", () => {
  it("1 feature flag OFF → provider 0 / not eligible", () => {
    const r = evaluateCompletionIntegrityJevQaEligibility({
      env: {},
      finalProse: ABRUPT_PROSE,
      finishReason: "MAX_TOKENS",
      localRecoveryApplied: false,
    });
    assert.equal(r.eligible, false);
    if (!r.eligible) assert.match(r.reason, /COMPLETION_INTEGRITY_JEV_QA_ENABLED/);
  });

  it("2 no deterministic candidate → provider 0", () => {
    const r = evaluateCompletionIntegrityJevQaEligibility({
      env: { [COMPLETION_INTEGRITY_JEV_QA_ENV]: "1" },
      finalProse: COMPLETE_PROSE,
      finishReason: "STOP",
      localRecoveryApplied: false,
    });
    assert.equal(r.eligible, false);
    if (!r.eligible) assert.match(r.reason, /deterministic_candidate_zero/);
  });

  it("3 no meaningful final prose → provider 0", () => {
    const r = evaluateCompletionIntegrityJevQaEligibility({
      env: { [COMPLETION_INTEGRITY_JEV_QA_ENV]: "1" },
      finalProse: "   ",
      finishReason: "MAX_TOKENS",
      localRecoveryApplied: false,
    });
    assert.equal(r.eligible, false);
    if (!r.eligible) assert.match(r.reason, /no_meaningful_final_prose/);
  });

  it("4 candidate + finalized path → eligible (schedule max 1 covered below)", () => {
    const r = evaluateCompletionIntegrityJevQaEligibility({
      env: { [COMPLETION_INTEGRITY_JEV_QA_ENV]: "1" },
      finalProse: ABRUPT_PROSE,
      finishReason: "MAX_TOKENS",
      localRecoveryApplied: false,
    });
    assert.equal(r.eligible, true);
    if (r.eligible) {
      assert.ok(r.reasons.includes("endsIncomplete") || r.reasons.includes("tokenLimitFinish"));
    }
  });
});

describe("generation-scoped exactly-once + lifecycle", () => {
  it("4/9 same generation schedules at most one; duplicate/requeue additional 0", async () => {
    let calls = 0;
    const callDecisions = (async () => {
      calls += 1;
      return mockCall("ABRUPT_CUT")({} as never);
    }) as typeof import("@/lib/jevDecisions").callJevDecisions;

    const env = { [COMPLETION_INTEGRITY_JEV_QA_ENV]: "1" } as NodeJS.ProcessEnv;
    const base = {
      chatId: 1,
      generationScope: scope(0),
      finalProse: ABRUPT_PROSE,
      finishReason: "MAX_TOKENS" as string | null,
      localRecoveryApplied: false,
      localRecoveryActions: [] as string[],
      env,
      callDecisions,
      skipStaleGenerationGuard: true,
    };

    const first = scheduleCompletionIntegrityJevQa(base);
    const second = scheduleCompletionIntegrityJevQa(base);
    assert.equal(first.scheduled, true);
    assert.equal(first.providerCallsExpected, 1);
    assert.equal(second.scheduled, false);
    assert.equal(second.reason, "generation_already_claimed");
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(calls, 1);

    const third = scheduleCompletionIntegrityJevQa(base);
    assert.equal(third.scheduled, false);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 1);
  });

  it("7–8 reconnect / GET / re-render same generation → additional 0 (claim sentinel)", async () => {
    let calls = 0;
    const callDecisions = (async () => {
      calls += 1;
      return mockCall("COMPLETE")({} as never);
    }) as typeof import("@/lib/jevDecisions").callJevDecisions;
    const env = { [COMPLETION_INTEGRITY_JEV_QA_ENV]: "1" } as NodeJS.ProcessEnv;
    assert.equal(
      scheduleCompletionIntegrityJevQa({
        chatId: 1,
        generationScope: scope(2),
        finalProse: TOKEN_LIMIT_COMPLETE,
        finishReason: "LENGTH",
        localRecoveryApplied: false,
        localRecoveryActions: [],
        env,
        callDecisions,
        skipStaleGenerationGuard: true,
      }).scheduled,
      true
    );
    await new Promise((r) => setTimeout(r, 20));
    // Simulate reconnect / GET scheduling again for the same generation.
    assert.equal(
      scheduleCompletionIntegrityJevQa({
        chatId: 1,
        generationScope: scope(2),
        finalProse: TOKEN_LIMIT_COMPLETE,
        finishReason: "LENGTH",
        localRecoveryApplied: false,
        localRecoveryActions: [],
        env,
        callDecisions,
        skipStaleGenerationGuard: true,
      }).scheduled,
      false
    );
    assert.equal(calls, 1);
  });

  it("10 regeneration N+1 gets independent max-1 slot", async () => {
    let calls = 0;
    const callDecisions = (async () => {
      calls += 1;
      return mockCall("ABRUPT_CUT")({} as never);
    }) as typeof import("@/lib/jevDecisions").callJevDecisions;
    const env = { [COMPLETION_INTEGRITY_JEV_QA_ENV]: "1" } as NodeJS.ProcessEnv;
    assert.equal(
      scheduleCompletionIntegrityJevQa({
        chatId: 1,
        generationScope: scope(0),
        finalProse: ABRUPT_PROSE,
        finishReason: "MAX_TOKENS",
        localRecoveryApplied: false,
        localRecoveryActions: [],
        env,
        callDecisions,
        skipStaleGenerationGuard: true,
      }).scheduled,
      true
    );
    assert.equal(
      scheduleCompletionIntegrityJevQa({
        chatId: 1,
        generationScope: scope(1),
        finalProse: ABRUPT_PROSE,
        finishReason: "MAX_TOKENS",
        localRecoveryApplied: false,
        localRecoveryActions: [],
        env,
        callDecisions,
        skipStaleGenerationGuard: true,
      }).scheduled,
      true
    );
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(calls, 2);
  });

  it("5–6 failed/interrupted generations are not scheduled by route gate (source invariant)", () => {
    const route = fs.readFileSync("src/app/api/chat/route.ts", "utf8");
    assert.match(route, /assistantFinalizedThisRequest/);
    assert.match(route, /scheduleCompletionIntegrityJevQa/);
    // Schedule is nested under assistantFinalizedThisRequest — same neighborhood as scene-boundary.
    const callSite = route.indexOf("scheduleCompletionIntegrityJevQa({");
    const gateSite = route.lastIndexOf("if (assistantFinalizedThisRequest)", callSite);
    assert.ok(callSite > 0 && gateSite > 0 && callSite > gateSite);
  });

  it("11–12 stale before call skips provider; claim still completes so slot is spent", async () => {
    let calls = 0;
    const callDecisions = (async () => {
      calls += 1;
      return mockCall("ABRUPT_CUT")({} as never);
    }) as typeof import("@/lib/jevDecisions").callJevDecisions;

    // Force stale by not skipping guard; without a DB row current-generation is false.
    const scheduled = scheduleCompletionIntegrityJevQa({
      chatId: 1,
      generationScope: scope(9),
      finalProse: ABRUPT_PROSE,
      finishReason: "MAX_TOKENS",
      localRecoveryApplied: false,
      localRecoveryActions: [],
      env: { [COMPLETION_INTEGRITY_JEV_QA_ENV]: "1" },
      callDecisions,
      skipStaleGenerationGuard: false,
    });
    assert.equal(scheduled.scheduled, true);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(calls, 0);
    // After stale abort, same generation cannot schedule again (completed claim).
    const again = scheduleCompletionIntegrityJevQa({
      chatId: 1,
      generationScope: scope(9),
      finalProse: ABRUPT_PROSE,
      finishReason: "MAX_TOKENS",
      localRecoveryApplied: false,
      localRecoveryActions: [],
      env: { [COMPLETION_INTEGRITY_JEV_QA_ENV]: "1" },
      callDecisions,
      skipStaleGenerationGuard: true,
    });
    assert.equal(again.scheduled, false);
    assert.equal(again.reason, "generation_already_claimed");
  });

  it("scene-boundary and completion-integrity claims do not collide", async () => {
    let boundaryCalls = 0;
    let completionCalls = 0;
    const boundaryCall = (async () => {
      boundaryCalls += 1;
      return {
        answers: {
          [SCENE_BOUNDARY_JEV_QA_QUESTION_ID]: {
            type: "choice" as const,
            choice: "COMPLIANT",
            probabilities: { VIOLATION: 0, COMPLIANT: 1, INSUFFICIENT_CONTEXT: 0 },
            confidence: 0.8,
          },
        },
        usage: { inputTokens: 5, outputTokens: 3, estimated: false },
        responseModel: "typesafe/jev-1.13-test",
      };
    }) as typeof import("@/lib/jevDecisions").callJevDecisions;
    const completionCall = (async () => {
      completionCalls += 1;
      return mockCall("ABRUPT_CUT")({} as never);
    }) as typeof import("@/lib/jevDecisions").callJevDecisions;

    const gen = scope(5);
    assert.equal(
      scheduleSceneBoundaryJevQa({
        chatId: 1,
        generationScope: gen,
        boundaryExecution: BOUNDARY_CONTRACT,
        assistantProse: "서린은 민에게 메시지를 전송했다.",
        v2Mode: "shadow",
        env: {
          [SCENE_BOUNDARY_JEV_QA_ENV]: "1",
          SCENE_DIRECTIVE_V2_MODE: "shadow",
        },
        callDecisions: boundaryCall,
        skipStaleGenerationGuard: true,
      }).scheduled,
      true
    );
    assert.equal(
      scheduleCompletionIntegrityJevQa({
        chatId: 1,
        generationScope: gen,
        finalProse: ABRUPT_PROSE,
        finishReason: "MAX_TOKENS",
        localRecoveryApplied: false,
        localRecoveryActions: [],
        env: { [COMPLETION_INTEGRITY_JEV_QA_ENV]: "1" },
        callDecisions: completionCall,
        skipStaleGenerationGuard: true,
      }).scheduled,
      true
    );
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(boundaryCalls, 1);
    assert.equal(completionCalls, 1);
  });
});

describe("generation-scoped aux QA claim retention", () => {
  it("keeps completed duplicate-suppression history bounded per domain", () => {
    const domain = "bounded-history-test";
    resetGenerationAuxQaClaimsForTests(domain);
    for (let i = 0; i <= MAX_COMPLETED_AUX_QA_CLAIMS_PER_DOMAIN; i += 1) {
      const s = {
        assistantMessageId: 100000 + i,
        generationSequence: 0,
      };
      assert.equal(tryClaimGenerationAuxQaJob(domain, s), true);
      completeGenerationAuxQaJob(domain, s);
    }

    // The oldest completed key is evicted from the bounded process-local window.
    assert.equal(
      tryClaimGenerationAuxQaJob(domain, { assistantMessageId: 100000, generationSequence: 0 }),
      true
    );
    // A recent completed key remains suppressed.
    assert.equal(
      tryClaimGenerationAuxQaJob(domain, {
        assistantMessageId: 100000 + MAX_COMPLETED_AUX_QA_CLAIMS_PER_DOMAIN,
        generationSequence: 0,
      }),
      false
    );
    resetGenerationAuxQaClaimsForTests(domain);
  });
});

describe("semantic priority mapping", () => {
  it("13–17 ABRUPT/COMPLETE/UNCERTAIN/malformed/failure → review priorities", () => {
    assert.equal(mapCompletionVerdictToReviewPriority("ABRUPT_CUT"), "high_priority_review");
    assert.equal(mapCompletionVerdictToReviewPriority("COMPLETE"), "low_priority_review");
    assert.equal(mapCompletionVerdictToReviewPriority("UNCERTAIN"), "needs_review");
    assert.equal(mapCompletionVerdictToReviewPriority(null), "needs_review");
  });

  it("malformed / provider failure do not throw to caller", async () => {
    const failing = (async () => {
      throw new Error("simulated_timeout");
    }) as typeof import("@/lib/jevDecisions").callJevDecisions;
    assert.equal(
      scheduleCompletionIntegrityJevQa({
        chatId: 1,
        generationScope: scope(3),
        finalProse: ABRUPT_PROSE,
        finishReason: "MAX_TOKENS",
        localRecoveryApplied: false,
        localRecoveryActions: [],
        env: { [COMPLETION_INTEGRITY_JEV_QA_ENV]: "1" },
        callDecisions: failing,
        skipStaleGenerationGuard: true,
      }).scheduled,
      true
    );
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(
      scheduleCompletionIntegrityJevQa({
        chatId: 1,
        generationScope: scope(4),
        finalProse: ABRUPT_PROSE,
        finishReason: "MAX_TOKENS",
        localRecoveryApplied: false,
        localRecoveryActions: [],
        env: { [COMPLETION_INTEGRITY_JEV_QA_ENV]: "1" },
        callDecisions: mockCall(null),
        skipStaleGenerationGuard: true,
      }).scheduled,
      true
    );
    await new Promise((r) => setTimeout(r, 20));
  });
});

describe("invariants — no mutation / billing / blocking", () => {
  it("18–25 QA owner cannot mutate savedText / billing / continuation / regen", () => {
    const src = fs.readFileSync("src/lib/completionIntegrityJevQa.ts", "utf8");
    assert.doesNotMatch(src, /savedText\s*=/);
    assert.doesNotMatch(src, /deductPoints|chargeUser|userPoints|billingWaiver|refund/i);
    assert.doesNotMatch(src, /scheduleRegenerat|triggerRegenerat|forceRegenerat|continueNarrative/);
    assert.doesNotMatch(src, /blockResponse\s*\(|suppressOutput\s*\(/);
    assert.doesNotMatch(src, /updateGenerationStatus|markAssistantFailed/);
    const route = fs.readFileSync("src/app/api/chat/route.ts", "utf8");
    assert.doesNotMatch(route, /await\s+scheduleCompletionIntegrityJevQa/);
    assert.match(route, /COMPLETION_INTEGRITY|scheduleCompletionIntegrityJevQa/);
  });

  it("candidate adapter reuses responseLength owners only", () => {
    const cand = evaluateCompletionIntegrityCandidate({
      finalProse: ABRUPT_PROSE,
      finishReason: "MAX_TOKENS",
      localRecoveryApplied: false,
    });
    assert.equal(cand.candidate, true);
    assert.ok(cand.reasons.includes("endsIncomplete"));
    assert.ok(cand.reasons.includes("tokenLimitFinish"));
    const src = fs.readFileSync("src/lib/completionIntegrityCandidate.ts", "utf8");
    assert.match(src, /endsIncomplete/);
    assert.match(src, /needsResponseLengthFix/);
    assert.match(src, /isTokenLimitFinish/);
    assert.doesNotMatch(src, /new RegExp|\/\[가-힣\]\{20,\}/);
  });
});

describe("provenance + privacy", () => {
  it("26–29 requestKind OTHER_ASYNC + generation-correlated ledger", async () => {
    assert.equal(
      resolveAuxProviderOwner({ requestKind: COMPLETION_INTEGRITY_JEV_QA_REQUEST_KIND }),
      "OTHER_ASYNC"
    );
    let capturedLedger: unknown = null;
    const callDecisions = (async (opts: unknown) => {
      capturedLedger = (opts as { ledger?: unknown }).ledger ?? null;
      return mockCall("ABRUPT_CUT")({} as never);
    }) as typeof import("@/lib/jevDecisions").callJevDecisions;

    const generationScope = scope(7);
    assert.equal(
      scheduleCompletionIntegrityJevQa({
        chatId: 88,
        generationScope,
        finalProse: ABRUPT_PROSE,
        finishReason: "MAX_TOKENS",
        localRecoveryApplied: true,
        localRecoveryActions: ["predicate:다."],
        env: { [COMPLETION_INTEGRITY_JEV_QA_ENV]: "1" },
        callDecisions,
        skipStaleGenerationGuard: true,
      }).scheduled,
      true
    );
    await new Promise((r) => setTimeout(r, 25));
    const ledger = capturedLedger as {
      requestKind?: string;
      provenanceContext?: {
        chatId?: number;
        assistantMessageId?: number;
        generationSequence?: number;
        generationRequestId?: string | null;
        family?: string;
        fundingClass?: string;
        executionPhase?: string;
        requestKind?: string;
      };
    };
    assert.equal(ledger.requestKind, COMPLETION_INTEGRITY_JEV_QA_REQUEST_KIND);
    assert.equal(ledger.provenanceContext?.chatId, 88);
    assert.equal(ledger.provenanceContext?.assistantMessageId, generationScope.assistantMessageId);
    assert.equal(ledger.provenanceContext?.generationSequence, generationScope.generationSequence);
    assert.equal(ledger.provenanceContext?.generationRequestId, generationScope.generationRequestId);
    assert.equal(ledger.provenanceContext?.family, "background");
    assert.equal(ledger.provenanceContext?.fundingClass, "platform_funded");
    assert.equal(ledger.provenanceContext?.executionPhase, "async_post_turn");
    assert.equal(ledger.provenanceContext?.requestKind, COMPLETION_INTEGRITY_JEV_QA_REQUEST_KIND);

    const src = fs.readFileSync("src/lib/completionIntegrityJevQa.ts", "utf8");
    assert.match(src, /assertNoDuplicateAuxProviderSuccess/);
  });

  it("30–34 bounded tail only; no private identifiers in state", () => {
    const long = "가".repeat(1200) + ABRUPT_PROSE;
    const state = buildCompletionIntegrityJevQaState({
      candidateReasons: ["endsIncomplete", "tokenLimitFinish"],
      finishReason: "MAX_TOKENS",
      localRecoveryApplied: false,
      localRecoveryActions: [],
      finalProse: long,
    });
    assert.ok(state.finalProseTail.length <= 800);
    assert.equal(state.finalProseTail, takeFinalProseTail(long));
    assert.deepEqual(assertCompletionIntegrityJevStateHasNoPrivateIdentifiers(state as unknown as Record<string, unknown>), []);
    const json = JSON.stringify(state);
    assert.doesNotMatch(
      json,
      /personaSecret|Persona Secret|billing|accountId|userId|apiKey|OPENROUTER|systemPrompt|memoryDb/i
    );
    assert.equal(Object.keys(buildCompletionIntegrityJevQaQuestions()).length, 1);
    assert.deepEqual(
      Object.keys(buildCompletionIntegrityJevQaQuestions()[COMPLETION_INTEGRITY_JEV_QA_QUESTION_ID]!.criteria as object).sort(),
      ["ABRUPT_CUT", "COMPLETE", "UNCERTAIN"]
    );
  });
});

describe("route / adjacent ownership", () => {
  it("route schedules after finalize with final prose extract + recovery metadata", () => {
    const route = fs.readFileSync("src/app/api/chat/route.ts", "utf8");
    assert.match(route, /localSentenceRecoveryApplied/);
    assert.match(route, /localSentenceRecoveryActions/);
    assert.match(route, /extractProseWithoutHtml\(savedText\)/);
    assert.match(route, /scheduleCompletionIntegrityJevQa/);
    assert.match(route, /finishReason:\s*primaryStage\?\.finishReason\s*\?\?\s*mainFinishReason/);
  });

  it("default OFF — env gate present; no Railway activation in tree", () => {
    assert.equal(
      evaluateCompletionIntegrityJevQaEligibility({
        env: { [COMPLETION_INTEGRITY_JEV_QA_ENV]: "0" },
        finalProse: ABRUPT_PROSE,
        finishReason: "MAX_TOKENS",
        localRecoveryApplied: false,
      }).eligible,
      false
    );
    const src = fs.readFileSync("src/lib/completionIntegrityJevQa.ts", "utf8");
    assert.match(src, /COMPLETION_INTEGRITY_JEV_QA_ENABLED/);
  });
});
