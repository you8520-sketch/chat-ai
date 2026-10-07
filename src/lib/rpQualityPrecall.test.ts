import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  GEMINI_31_PRO_PREVIEW_DISPLAY_NAME,
  GEMINI_37_FLASH_DISPLAY_NAME,
  GEMINI_38_FLASH_MODEL,
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
} from "@/lib/chatModels";
import { resolveOpenRouterMaxTokens } from "@/lib/openRouterClient";
import {
  ASSISTANT_MESSAGE_EDIT_MAX_CHARS,
  UNIFIED_TIER_AIM_CHARS,
} from "@/lib/responseLengthConstants";
import { resolveStreamCharCap } from "@/lib/responseLength";
import { LIVE_DEPLOYED_ROW_PROOF } from "../../scripts/lib/mainRpBodyCuePreflight";
import { COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS } from "../../scripts/lib/rpModelQualificationFixture";
import { RP_ACTIVE_MODEL_QUALITY_MODEL_IDS } from "../../scripts/lib/rpActiveModelQualityLive";
import {
  RP_QUALITY_BENCHMARK_MODELS,
  emptyRubricScores,
} from "@/lib/rpQualityEvaluationPacket";
import {
  HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_COMMIT,
  HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_OWNER,
  PRECALL_GREETING_STIMULUS_OWNER,
  PRECALL_SCENE_SEED_OWNER,
  RP_QUALITY_PRECALL_EXECUTION_POLICY,
  RP_QUALITY_PRECALL_HISTORICAL_ROW_POINTER,
  RP_QUALITY_PRECALL_MUTATION_POLICY,
  RP_QUALITY_PRECALL_PAID_STATUS,
  RP_QUALITY_PRECALL_PLANNED_CALLS,
  RP_QUALITY_PRECALL_TARGET_SELECTOR,
  absentLiveProof,
  artifactContainsSecret,
  assertActiveMainRpBenchmarkSet,
  assertFixturePlannedSemanticParity,
  buildRpQualityPrecallPlan,
  buildRpQualityPrecallReport,
  buildPlannedQualityPackets,
  concreteStimulusReadiness,
  evaluateRpQualityPrecallCostBound,
  historicalRowProofCannotSatisfyCurrent,
  rpQualityPrecallBenchmarkModels,
  rpQualityPrecallFixtures,
  startRpQualityPrecallPaidExecution,
  validateLiveProof,
  type RpQualityPrecallLiveProofInput,
} from "@/lib/rpQualityPrecall";

const PRECALL_SRC = readFileSync("src/lib/rpQualityPrecall.ts", "utf8");
const TEST_SHA = "ab".repeat(32);
const CURRENT_DEPLOY_SHA = "cd".repeat(20);

function testLiveProofInput(
  overrides: Partial<RpQualityPrecallLiveProofInput> = {}
): RpQualityPrecallLiveProofInput {
  return {
    source: "test-injected-evidence",
    generatedAt: "2026-10-07T00:00:00.000Z",
    deployedGitSha: CURRENT_DEPLOY_SHA,
    characterId: RP_QUALITY_PRECALL_TARGET_SELECTOR.characterId,
    characterName: RP_QUALITY_PRECALL_TARGET_SELECTOR.characterName,
    personaName: RP_QUALITY_PRECALL_TARGET_SELECTOR.personaName,
    greetingSha256: TEST_SHA,
    systemPromptSha256: TEST_SHA,
    worldSha256: TEST_SHA,
    settingChunksSha256: TEST_SHA,
    personaPublicSha256: TEST_SHA,
    authoringLevel: "NORMAL",
    contentMode: "SAFE",
    ...overrides,
  };
}

describe("rp quality PRECALL plan", () => {
  it("A. live identity proof no longer requires mutable current-room history", () => {
    assert.doesNotMatch(PRECALL_SRC, /historyProvenance|current_production_room_if_readable/);
    const verified = validateLiveProof(testLiveProofInput(), {
      expectedDeploySha: CURRENT_DEPLOY_SHA,
    });
    assert.equal(verified.status, "VERIFIED");
    if (verified.status !== "VERIFIED") throw new Error("expected VERIFIED");
    assert.equal("historyProvenance" in verified.input, false);
  });

  it("B. fixture/history provenance belongs to the deterministic benchmark plan", () => {
    const fixtures = rpQualityPrecallFixtures();
    assert.ok(fixtures.every((row) => row.historyOwner === PRECALL_GREETING_STIMULUS_OWNER));
    const a = fixtures.find((row) => row.id === "A_relationship_emotion")!;
    const c = fixtures.find((row) => row.id === "C_continuity_progression")!;
    assert.equal(a.stimulusOwner, PRECALL_SCENE_SEED_OWNER);
    assert.equal(a.stimulusId, "quiet_window_safe");
    assert.equal(c.stimulusId, "relationship_turn_safe");
    assert.ok(COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS.some((seed) => seed.id === a.stimulusId));
    assert.ok(COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS.some((seed) => seed.id === c.stimulusId));
    assert.doesNotMatch(PRECALL_SRC, /오늘은 그냥 이렇게 있자/);
    assert.doesNotMatch(PRECALL_SRC, /나 오늘 여기 있을게/);
    const readiness = concreteStimulusReadiness(fixtures);
    assert.equal(readiness.concreteStimulus.A_relationship_emotion.stimulusReady, true);
    assert.equal(readiness.concreteStimulus.B_conflict_action_spatial.stimulusReady, false);
    assert.equal(readiness.concreteStimulus.C_continuity_progression.stimulusReady, true);
    assert.equal(readiness.twelveCallConcreteStimulusReady, false);
  });

  it("C. personaName is required and validated", () => {
    const missing = validateLiveProof(testLiveProofInput({ personaName: "   " }), {
      expectedDeploySha: CURRENT_DEPLOY_SHA,
    });
    assert.equal(missing.status, "UNVERIFIED");
    if (missing.status !== "UNVERIFIED") throw new Error("expected UNVERIFIED");
    assert.ok(missing.reasons.includes("missing_personaName"));
  });

  it("D. character target mismatch => UNVERIFIED", () => {
    const proof = validateLiveProof(
      testLiveProofInput({ characterId: 10, characterName: "다른캐릭터" }),
      { expectedDeploySha: CURRENT_DEPLOY_SHA }
    );
    assert.equal(proof.status, "UNVERIFIED");
    if (proof.status !== "UNVERIFIED") throw new Error("expected UNVERIFIED");
    assert.ok(proof.reasons.includes("characterId_does_not_match_target_selector"));
    assert.ok(proof.reasons.includes("characterName_does_not_match_target_selector"));
  });

  it("E. persona target mismatch => UNVERIFIED", () => {
    const proof = validateLiveProof(testLiveProofInput({ personaName: "다른페르소나" }), {
      expectedDeploySha: CURRENT_DEPLOY_SHA,
    });
    assert.equal(proof.status, "UNVERIFIED");
    if (proof.status !== "UNVERIFIED") throw new Error("expected UNVERIFIED");
    assert.ok(proof.reasons.includes("personaName_does_not_match_target_selector"));
  });

  it("F. malformed/non-full deployed SHA => UNVERIFIED", () => {
    const shortSha = validateLiveProof(testLiveProofInput({ deployedGitSha: "f606534" }), {
      expectedDeploySha: CURRENT_DEPLOY_SHA,
    });
    assert.equal(shortSha.status, "UNVERIFIED");
    if (shortSha.status !== "UNVERIFIED") throw new Error("expected UNVERIFIED");
    assert.ok(shortSha.reasons.includes("invalid_deployedGitSha"));
    const sha256AsGit = validateLiveProof(testLiveProofInput({ deployedGitSha: TEST_SHA }), {
      expectedDeploySha: CURRENT_DEPLOY_SHA,
    });
    assert.equal(sha256AsGit.status, "UNVERIFIED");
    const mismatch = validateLiveProof(testLiveProofInput(), {
      expectedDeploySha: "ef".repeat(20),
    });
    assert.equal(mismatch.status, "UNVERIFIED");
    if (mismatch.status !== "UNVERIFIED") throw new Error("expected UNVERIFIED");
    assert.ok(mismatch.reasons.includes("deployedGitSha_does_not_match_expected"));
    const badHash = validateLiveProof(testLiveProofInput({ greetingSha256: "not-a-hash" }), {
      expectedDeploySha: CURRENT_DEPLOY_SHA,
    });
    assert.equal(badHash.status, "UNVERIFIED");
    if (badHash.status !== "UNVERIFIED") throw new Error("expected UNVERIFIED");
    assert.ok(badHash.reasons.includes("invalid_greetingSha256"));
  });

  it("G. invalid generatedAt => UNVERIFIED", () => {
    const proof = validateLiveProof(testLiveProofInput({ generatedAt: "2026-10-07" }), {
      expectedDeploySha: CURRENT_DEPLOY_SHA,
    });
    assert.equal(proof.status, "UNVERIFIED");
    if (proof.status !== "UNVERIFIED") throw new Error("expected UNVERIFIED");
    assert.ok(proof.reasons.includes("invalid_generatedAt"));
  });

  it("H. historical proof cannot satisfy current proof", () => {
    const historical: RpQualityPrecallLiveProofInput = {
      source: HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_OWNER,
      generatedAt: "2026-08-25T00:00:00.000Z",
      deployedGitSha: HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_COMMIT,
      characterId: LIVE_DEPLOYED_ROW_PROOF.characterId,
      characterName: LIVE_DEPLOYED_ROW_PROOF.characterName,
      personaName: RP_QUALITY_PRECALL_TARGET_SELECTOR.personaName,
      greetingSha256: LIVE_DEPLOYED_ROW_PROOF.greetingSha256,
      systemPromptSha256: LIVE_DEPLOYED_ROW_PROOF.systemPromptSha256,
      worldSha256: LIVE_DEPLOYED_ROW_PROOF.worldSha256,
      settingChunksSha256: LIVE_DEPLOYED_ROW_PROOF.settingChunksSha256,
      personaPublicSha256: LIVE_DEPLOYED_ROW_PROOF.personaPublicSha256,
      authoringLevel: "NORMAL",
      contentMode: "SAFE",
    };
    assert.equal(historicalRowProofCannotSatisfyCurrent(historical), true);
    const proof = validateLiveProof(historical, { expectedDeploySha: CURRENT_DEPLOY_SHA });
    assert.equal(proof.status, "UNVERIFIED");
    if (proof.status !== "UNVERIFIED") throw new Error("expected UNVERIFIED");
    assert.ok(proof.reasons.includes("historical_LIVE_DEPLOYED_ROW_PROOF_cannot_auto_satisfy"));
    assert.equal(RP_QUALITY_PRECALL_HISTORICAL_ROW_POINTER.isCurrentProductionProof, false);
  });

  it("I. absent proof => NOT_REPRODUCIBLE", () => {
    assert.deepEqual(absentLiveProof(), { status: "NOT_PROVIDED" });
    const report = buildRpQualityPrecallReport();
    assert.equal(report.liveProof.status, "NOT_PROVIDED");
    assert.equal(report.classification, "NOT_REPRODUCIBLE");
    assert.equal(report.precallReady, false);
    assert.equal(report.twelveCallConcreteStimulusReady, false);
  });

  it("J. verified identity alone does not authorize a provider call", () => {
    const report = buildRpQualityPrecallReport({
      liveProofInput: testLiveProofInput(),
      expectedDeploySha: CURRENT_DEPLOY_SHA,
    });
    assert.equal(report.liveProof.status, "VERIFIED");
    assert.equal(report.precallReady, false);
    assert.equal(report.classification, "NOT_REPRODUCIBLE");
    const denied = startRpQualityPrecallPaidExecution({
      liveProofInput: testLiveProofInput(),
      expectedDeploySha: CURRENT_DEPLOY_SHA,
    });
    assert.equal(denied.started, false);
    assert.equal(denied.providerPosts, 0);
    assert.equal(denied.reason, "MISSING_APPROVED_COST_BOUND");
  });

  it("K. approved cost alone does not authorize a provider call", () => {
    const denied = startRpQualityPrecallPaidExecution({
      approvedCostBoundUsd: 25,
      paidExecutionAuthorized: true,
    });
    assert.equal(denied.started, false);
    assert.equal(denied.providerPosts, 0);
    assert.equal(denied.reason, "MISSING_VERIFIED_LIVE_PROOF");
    const cost = evaluateRpQualityPrecallCostBound();
    assert.equal(cost.status, "UNCOMPUTED");
  });

  it("L. PRECALL owner provider POST remains 0", () => {
    const denied = startRpQualityPrecallPaidExecution({
      liveProofInput: testLiveProofInput(),
      expectedDeploySha: CURRENT_DEPLOY_SHA,
      approvedCostBoundUsd: 25,
      paidExecutionAuthorized: true,
    });
    assert.equal(denied.started, false);
    assert.equal(denied.providerPosts, 0);
    assert.equal(denied.reason, "PRECALL_OWNER_DOES_NOT_EXECUTE");
    assert.equal(denied.paidExecutionStatus, RP_QUALITY_PRECALL_PAID_STATUS);
  });

  it("M. active models remain canonical picker derived", () => {
    const models = rpQualityPrecallBenchmarkModels();
    assert.deepEqual(models.map((row) => row.canonicalId), [...MAIN_RP_MODEL_IDS]);
    assert.deepEqual(
      models.map((row) => row.displayLabel),
      MAIN_RP_USER_SELECTABLE_OPTIONS.map((row) => row.label)
    );
    assert.deepEqual(RP_QUALITY_BENCHMARK_MODELS, [
      ...MAIN_RP_USER_SELECTABLE_OPTIONS.map((row) => row.label),
    ]);
    assert.deepEqual(RP_ACTIVE_MODEL_QUALITY_MODEL_IDS, MAIN_RP_MODEL_IDS);
    assert.equal(models.length, 4);
    assert.doesNotMatch(PRECALL_SRC, /const expected = \[/);
    assertActiveMainRpBenchmarkSet(models);
  });

  it("N. retired Gemini is absent", () => {
    const ids = rpQualityPrecallBenchmarkModels().map((row) => row.canonicalId);
    const labels = rpQualityPrecallBenchmarkModels().map((row) => row.displayLabel);
    assert.equal(ids.includes(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL as never), false);
    assert.equal(ids.includes(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL as never), false);
    assert.equal(labels.includes(GEMINI_31_PRO_PREVIEW_DISPLAY_NAME), false);
    assert.equal(labels.includes(GEMINI_37_FLASH_DISPLAY_NAME), false);
  });

  it("O. 3200+ / no ceiling is preserved", () => {
    const plan = buildRpQualityPrecallPlan();
    const report = buildRpQualityPrecallReport();
    assert.equal(UNIFIED_TIER_AIM_CHARS, 3200);
    assert.ok(plan.every((row) => row.targetResponseChars === UNIFIED_TIER_AIM_CHARS));
    assert.ok(plan.every((row) => row.applicationMaxTokens === undefined));
    assert.ok(plan.every((row) => row.streamCharCap === Number.MAX_SAFE_INTEGER));
    assert.equal(resolveOpenRouterMaxTokens(3200, 8192, GEMINI_38_FLASH_MODEL), undefined);
    assert.equal(resolveStreamCharCap(3200), Number.MAX_SAFE_INTEGER);
    assert.equal(report.length.softAimChars, 3200);
    assert.equal(report.length.uiEditMaxChars, ASSISTANT_MESSAGE_EDIT_MAX_CHARS);
    assert.doesNotMatch(PRECALL_SRC, /slice\(0,\s*(3200|3500|5000)\)/);
  });

  it("P. subjective scores remain null", () => {
    const packets = buildPlannedQualityPackets();
    assert.equal(packets.length, 12);
    for (const packet of packets) {
      assert.deepEqual(packet.scores, emptyRubricScores());
      assert.ok(Object.values(packet.scores).every((score) => score === null));
    }
  });

  it("Q. no secrets or raw live source text in the PRECALL artifact", () => {
    const report = buildRpQualityPrecallReport();
    assert.equal(artifactContainsSecret(report), false);
    const json = JSON.stringify(report);
    assert.doesNotMatch(json, /sk-[a-zA-Z0-9]{10,}/);
    assert.doesNotMatch(PRECALL_SRC, /오늘은 그냥 이렇게 있자/);
    assert.equal(RP_QUALITY_PRECALL_TARGET_SELECTOR.characterId, 18);
    assert.equal(RP_QUALITY_PRECALL_TARGET_SELECTOR.personaName, "렌");
  });

  it("keeps plan-template semantic parity and planned call count 12", () => {
    const plan = buildRpQualityPrecallPlan();
    assertFixturePlannedSemanticParity(plan);
    assert.equal(plan.length, RP_QUALITY_PRECALL_PLANNED_CALLS);
    assert.deepEqual(RP_QUALITY_PRECALL_EXECUTION_POLICY.paidProviderCallsThisOwner, 0);
    assert.equal(buildRpQualityPrecallReport().plannedSemanticParityOnly, true);
  });

  it("does not write DB/session/points or fetch", () => {
    assert.equal(RP_QUALITY_PRECALL_MUTATION_POLICY.db, false);
    assert.equal(RP_QUALITY_PRECALL_MUTATION_POLICY.userPoints, false);
    assert.doesNotMatch(PRECALL_SRC, /fetch\s*\(/);
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      throw new Error("PRECALL must not fetch");
    }) as typeof fetch;
    try {
      buildRpQualityPrecallReport();
      startRpQualityPrecallPaidExecution({ approvedCostBoundUsd: 1 });
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(fetchCount, 0);
  });
});
