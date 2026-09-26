/**
 * Scene-boundary JEV runtime QA triage — deterministic isolation tests.
 * Covers V2 shadow parity gates, eligibility, exactly-once, failure mapping,
 * privacy payload shape, and billing/provenance boundaries (no live provider).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  getSceneDirectiveV2Mode,
  isSceneDirectiveV2ComputeEnabled,
  isSceneDirectiveV2InjectEnabled,
  materializeSceneDirectivePromptBlock,
  resolveScenePacingPromptOwner,
} from "@/lib/sceneDirectiveV2Policy";
import type { BoundaryExecutionContract } from "@/lib/sceneDirectiveV2";
import { resolveAuxProviderOwner } from "@/lib/auxProviderProvenance";
import {
  SCENE_BOUNDARY_JEV_QA_ENV,
  SCENE_BOUNDARY_JEV_QA_QUESTION_ID,
  SCENE_BOUNDARY_JEV_QA_REQUEST_KIND,
  buildSceneBoundaryJevQaQuestions,
  buildSceneBoundaryJevQaState,
  evaluateSceneBoundaryJevQaEligibility,
  mapVerdictToReviewPriority,
  resetSceneBoundaryJevQaSentinelForTests,
  scheduleSceneBoundaryJevQa,
} from "@/lib/sceneBoundaryJevQa";

const CONTRACT: BoundaryExecutionContract = {
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

const VIOLATION_PROSE = "서린은 민에게 메시지를 전송했다.";
const CLEAN_PROSE = "서린은 자신의 집 현관문을 열고 들어섰다.";

function scope(seq = 0) {
  return {
    assistantMessageId: 91001,
    generationSequence: seq,
    generationRequestId: "req-boundary-qa-1",
  };
}

beforeEach(() => {
  resetSceneBoundaryJevQaSentinelForTests();
});

afterEach(() => {
  resetSceneBoundaryJevQaSentinelForTests();
});

describe("V2 shadow prompt / namespace parity (existing owner)", () => {
  it("1–2 OFF and SHADOW select the same non-V2 prompt owner; SHADOW does not inject", () => {
    assert.equal(getSceneDirectiveV2Mode({ SCENE_DIRECTIVE_V2_MODE: "off" }), "off");
    assert.equal(getSceneDirectiveV2Mode({ SCENE_DIRECTIVE_V2_MODE: "shadow" }), "shadow");
    assert.equal(isSceneDirectiveV2InjectEnabled({ SCENE_DIRECTIVE_V2_MODE: "shadow" }), false);
    assert.equal(isSceneDirectiveV2ComputeEnabled({ SCENE_DIRECTIVE_V2_MODE: "shadow" }), true);

    const offOwner = resolveScenePacingPromptOwner({ v2Mode: "off", livingEnabled: false });
    const shadowOwner = resolveScenePacingPromptOwner({ v2Mode: "shadow", livingEnabled: false });
    assert.equal(offOwner, "legacy_v1");
    assert.equal(shadowOwner, "legacy_v1");

    const legacy = "[SCENE PACING]\nlegacy";
    const v2 = "[EVENT RESTRAINT V2]\nv2";
    const living = "[LIVING SCENE DIRECTIVE]\nliving";
    const offBlock = materializeSceneDirectivePromptBlock({
      scenePacingOwner: offOwner,
      v2Block: v2,
      livingBlock: living,
      legacyBlock: legacy,
    });
    const shadowBlock = materializeSceneDirectivePromptBlock({
      scenePacingOwner: shadowOwner,
      v2Block: v2,
      livingBlock: living,
      legacyBlock: legacy,
    });
    assert.equal(offBlock, shadowBlock);
    assert.equal(offBlock, legacy);
    assert.ok(!shadowBlock.includes("EVENT RESTRAINT V2"));
  });

  it("3–4 route uses production namespace only when inject enabled; shadow otherwise", () => {
    const route = fs.readFileSync("src/app/api/chat/route.ts", "utf8");
    assert.match(route, /sceneDirectiveV2Inject\s*\?\s*"production"\s*:\s*"shadow"/);
    assert.equal(isSceneDirectiveV2InjectEnabled({ SCENE_DIRECTIVE_V2_MODE: "shadow" }), false);
    assert.equal(isSceneDirectiveV2InjectEnabled({ SCENE_DIRECTIVE_V2_MODE: "on" }), true);
  });

  it("5–6 SHADOW is compute-only (no Main RP / Luna provider added by V2)", () => {
    assert.equal(isSceneDirectiveV2ComputeEnabled({ SCENE_DIRECTIVE_V2_MODE: "shadow" }), true);
    assert.equal(isSceneDirectiveV2InjectEnabled({ SCENE_DIRECTIVE_V2_MODE: "shadow" }), false);
    // V2 build is local deterministic — no fetch in sceneDirectiveV2.ts
    const v2src = fs.readFileSync("src/lib/sceneDirectiveV2.ts", "utf8");
    assert.doesNotMatch(v2src, /\bfetch\s*\(/);
  });
});

describe("JEV eligibility gates", () => {
  it("7 V2 OFF → not eligible", () => {
    const r = evaluateSceneBoundaryJevQaEligibility({
      env: {
        [SCENE_BOUNDARY_JEV_QA_ENV]: "1",
        SCENE_DIRECTIVE_V2_MODE: "off",
      },
      v2Mode: "off",
      boundaryExecution: CONTRACT,
      assistantProse: VIOLATION_PROSE,
    });
    assert.equal(r.eligible, false);
  });

  it("8 boundaryExecution null → not eligible", () => {
    const r = evaluateSceneBoundaryJevQaEligibility({
      env: {
        [SCENE_BOUNDARY_JEV_QA_ENV]: "1",
        SCENE_DIRECTIVE_V2_MODE: "shadow",
      },
      v2Mode: "shadow",
      boundaryExecution: null,
      assistantProse: VIOLATION_PROSE,
    });
    assert.equal(r.eligible, false);
    if (!r.eligible) assert.match(r.reason, /boundaryExecution/);
  });

  it("9 lexical scanner 0 signals → not eligible", () => {
    const r = evaluateSceneBoundaryJevQaEligibility({
      env: {
        [SCENE_BOUNDARY_JEV_QA_ENV]: "1",
        SCENE_DIRECTIVE_V2_MODE: "shadow",
      },
      v2Mode: "shadow",
      boundaryExecution: CONTRACT,
      assistantProse: CLEAN_PROSE,
    });
    assert.equal(r.eligible, false);
    if (!r.eligible) assert.match(r.reason, /lexical_scanner_zero/);
  });

  it("feature flag absent → not eligible even with V2 shadow + signals", () => {
    const r = evaluateSceneBoundaryJevQaEligibility({
      env: { SCENE_DIRECTIVE_V2_MODE: "shadow" },
      v2Mode: "shadow",
      boundaryExecution: CONTRACT,
      assistantProse: VIOLATION_PROSE,
    });
    assert.equal(r.eligible, false);
  });

  it("10 candidate + canonical boundary → eligible", () => {
    const r = evaluateSceneBoundaryJevQaEligibility({
      env: {
        [SCENE_BOUNDARY_JEV_QA_ENV]: "1",
        SCENE_DIRECTIVE_V2_MODE: "shadow",
      },
      v2Mode: "shadow",
      boundaryExecution: CONTRACT,
      assistantProse: VIOLATION_PROSE,
    });
    assert.equal(r.eligible, true);
    if (r.eligible) assert.ok(r.suspicionSignals.includes("remote_contact"));
  });
});

describe("generation-scoped exactly-once + failure mapping", () => {
  it("11/15 same generation schedules at most one call; requeue is no-op", async () => {
    let calls = 0;
    const callDecisions = (async () => {
      calls += 1;
      return {
        answers: {
          [SCENE_BOUNDARY_JEV_QA_QUESTION_ID]: {
            type: "choice" as const,
            choice: "VIOLATION",
            probabilities: { VIOLATION: 1, COMPLIANT: 0, INSUFFICIENT_CONTEXT: 0 },
            confidence: 0.9,
          },
        },
        usage: { inputTokens: 10, outputTokens: 5, estimated: false, upstreamCostUsd: 0.0001 },
        responseModel: "typesafe/jev-1.13-test",
      };
    }) as typeof import("@/lib/jevDecisions").callJevDecisions;

    const env = {
      [SCENE_BOUNDARY_JEV_QA_ENV]: "1",
      SCENE_DIRECTIVE_V2_MODE: "shadow",
    } as NodeJS.ProcessEnv;

    const first = scheduleSceneBoundaryJevQa({
      chatId: 1,
      generationScope: scope(0),
      boundaryExecution: CONTRACT,
      assistantProse: VIOLATION_PROSE,
      v2Mode: "shadow",
      env,
      callDecisions,
      skipStaleGenerationGuard: true,
    });
    const second = scheduleSceneBoundaryJevQa({
      chatId: 1,
      generationScope: scope(0),
      boundaryExecution: CONTRACT,
      assistantProse: VIOLATION_PROSE,
      v2Mode: "shadow",
      env,
      callDecisions,
      skipStaleGenerationGuard: true,
    });
    assert.equal(first.scheduled, true);
    assert.equal(first.providerCallsExpected, 1);
    assert.equal(second.scheduled, false);
    assert.equal(second.reason, "generation_already_claimed");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls, 1);

    // After completion, same generation still claimed
    const third = scheduleSceneBoundaryJevQa({
      chatId: 1,
      generationScope: scope(0),
      boundaryExecution: CONTRACT,
      assistantProse: VIOLATION_PROSE,
      v2Mode: "shadow",
      env,
      callDecisions,
      skipStaleGenerationGuard: true,
    });
    assert.equal(third.scheduled, false);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 1);
  });

  it("16 regeneration generation N+1 gets an independent max-1 slot", async () => {
    let calls = 0;
    const callDecisions = (async () => {
      calls += 1;
      return {
        answers: {
          [SCENE_BOUNDARY_JEV_QA_QUESTION_ID]: {
            type: "choice" as const,
            choice: "COMPLIANT",
            probabilities: { VIOLATION: 0, COMPLIANT: 1, INSUFFICIENT_CONTEXT: 0 },
            confidence: 0.8,
          },
        },
        usage: { inputTokens: 8, outputTokens: 4, estimated: false },
        responseModel: "typesafe/jev-1.13-test",
      };
    }) as typeof import("@/lib/jevDecisions").callJevDecisions;

    const env = {
      [SCENE_BOUNDARY_JEV_QA_ENV]: "1",
      SCENE_DIRECTIVE_V2_MODE: "on",
    } as NodeJS.ProcessEnv;

    assert.equal(
      scheduleSceneBoundaryJevQa({
        chatId: 1,
        generationScope: scope(0),
        boundaryExecution: CONTRACT,
        assistantProse: VIOLATION_PROSE,
        v2Mode: "on",
        env,
        callDecisions,
        skipStaleGenerationGuard: true,
      }).scheduled,
      true
    );
    assert.equal(
      scheduleSceneBoundaryJevQa({
        chatId: 1,
        generationScope: scope(1),
        boundaryExecution: CONTRACT,
        assistantProse: VIOLATION_PROSE,
        v2Mode: "on",
        env,
        callDecisions,
        skipStaleGenerationGuard: true,
      }).scheduled,
      true
    );
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(calls, 2);
  });

  it("18–20 transport failure / malformed map to needs_review semantics; never throw to caller", async () => {
    assert.equal(mapVerdictToReviewPriority(null), "needs_review");
    assert.equal(mapVerdictToReviewPriority("VIOLATION"), "high_priority_review");
    assert.equal(mapVerdictToReviewPriority("COMPLIANT"), "low_priority_review");
    assert.equal(mapVerdictToReviewPriority("INSUFFICIENT_CONTEXT"), "needs_review");

    const failing = (async () => {
      throw new Error("simulated_timeout");
    }) as typeof import("@/lib/jevDecisions").callJevDecisions;

    const scheduled = scheduleSceneBoundaryJevQa({
      chatId: 1,
      generationScope: scope(3),
      boundaryExecution: CONTRACT,
      assistantProse: VIOLATION_PROSE,
      v2Mode: "shadow",
      env: {
        [SCENE_BOUNDARY_JEV_QA_ENV]: "1",
        SCENE_DIRECTIVE_V2_MODE: "shadow",
      },
      callDecisions: failing,
      skipStaleGenerationGuard: true,
    });
    assert.equal(scheduled.scheduled, true);
    await new Promise((r) => setTimeout(r, 20));
  });
});

describe("privacy payload + billing provenance", () => {
  it("26–29 payload is contract + signals + assistant prose only", () => {
    const state = buildSceneBoundaryJevQaState({
      boundaryExecution: CONTRACT,
      suspicionSignals: ["remote_contact"],
      assistantProse: VIOLATION_PROSE,
    });
    const json = JSON.stringify(state);
    assert.doesNotMatch(json, /personaSecret|Persona Secret|billing|accountId|userId|apiKey|OPENROUTER/i);
    assert.ok("boundaryExecution" in state);
    assert.ok("suspicionSignals" in state);
    assert.ok("assistantOutputUnderReview" in state);
    assert.equal(Object.keys(buildSceneBoundaryJevQaQuestions()).length, 1);
  });

  it("23–25 QA request kind is OTHER_ASYNC background, not Main RP", () => {
    assert.equal(
      resolveAuxProviderOwner({ requestKind: SCENE_BOUNDARY_JEV_QA_REQUEST_KIND }),
      "OTHER_ASYNC"
    );
    assert.notEqual(
      resolveAuxProviderOwner({ requestKind: SCENE_BOUNDARY_JEV_QA_REQUEST_KIND }),
      "STATUS_WIDGET"
    );
    const src = fs.readFileSync("src/lib/sceneBoundaryJevQa.ts", "utf8");
    assert.match(src, /requestKind:\s*SCENE_BOUNDARY_JEV_QA_REQUEST_KIND/);
    assert.doesNotMatch(src, /main-rp/);
    assert.doesNotMatch(src, /deductPoints|chargeUser|userPoints/i);
  });

  it("21–22 no regeneration / blocking in QA owner", () => {
    const src = fs.readFileSync("src/lib/sceneBoundaryJevQa.ts", "utf8");
    assert.doesNotMatch(src, /blockResponse\s*\(|suppressOutput\s*\(|rewriteProse\s*\(/);
    assert.doesNotMatch(src, /scheduleRegenerat|triggerRegenerat|forceRegenerat/);
    const route = fs.readFileSync("src/app/api/chat/route.ts", "utf8");
    assert.match(route, /scheduleSceneBoundaryJevQa/);
    assert.match(route, /assistantFinalizedThisRequest/);
  });
  it("route does not await JEV before user response completes (fire-and-forget schedule)", () => {
    const route = fs.readFileSync("src/app/api/chat/route.ts", "utf8");
    assert.doesNotMatch(route, /await\s+scheduleSceneBoundaryJevQa/);
  });
});
