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
import { RP_ACTIVE_MODEL_QUALITY_MODEL_IDS } from "../../scripts/lib/rpActiveModelQualityLive";
import {
  RP_QUALITY_BENCHMARK_MODELS,
  RP_QUALITY_VERBOSITY_BIAS_INSTRUCTION,
  buildQualityEvaluationContract,
  emptyRubricScores,
} from "@/lib/rpQualityEvaluationPacket";
import {
  HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_COMMIT,
  HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_OWNER,
  RP_QUALITY_PRECALL_EXECUTION_POLICY,
  RP_QUALITY_PRECALL_FIXTURE_IDS,
  RP_QUALITY_PRECALL_HISTORICAL_ROW_POINTER,
  RP_QUALITY_PRECALL_MUTATION_POLICY,
  RP_QUALITY_PRECALL_PAID_STATUS,
  RP_QUALITY_PRECALL_PLANNED_CALLS,
  absentLiveProof,
  artifactContainsSecret,
  assertActiveMainRpBenchmarkSet,
  assertFixturePlannedSemanticParity,
  buildPairedComparisonPackets,
  buildPlannedQualityPackets,
  buildRpQualityPrecallPlan,
  buildRpQualityPrecallReport,
  evaluateRpQualityPrecallCostBound,
  historicalRowProofCannotSatisfyCurrent,
  rpQualityPrecallBenchmarkModels,
  startRpQualityPrecallPaidExecution,
  validateLiveProof,
  type RpQualityPrecallLiveProofInput,
} from "@/lib/rpQualityPrecall";

const PRECALL_SRC = readFileSync("src/lib/rpQualityPrecall.ts", "utf8");
const PACKET_SRC = readFileSync("src/lib/rpQualityEvaluationPacket.ts", "utf8");

const TEST_SHA = "ab".repeat(32);
const CURRENT_DEPLOY_SHA = "cd".repeat(32);

function testLiveProofInput(
  overrides: Partial<RpQualityPrecallLiveProofInput> = {}
): RpQualityPrecallLiveProofInput {
  return {
    source: "test-injected-evidence",
    generatedAt: "2026-10-07T00:00:00.000Z",
    deployedGitSha: CURRENT_DEPLOY_SHA,
    characterId: 1,
    characterName: "test-character",
    greetingSha256: TEST_SHA,
    systemPromptSha256: TEST_SHA,
    worldSha256: TEST_SHA,
    settingChunksSha256: TEST_SHA,
    personaPublicSha256: TEST_SHA,
    historyProvenance: "test-room-fingerprint",
    authoringLevel: "NORMAL",
    contentMode: "SAFE",
    ...overrides,
  };
}

describe("rp quality PRECALL plan", () => {
  it("A. benchmark model rows are derived only from the canonical registry", () => {
    const models = rpQualityPrecallBenchmarkModels();
    assert.deepEqual(
      models.map((row) => row.canonicalId),
      [...MAIN_RP_MODEL_IDS]
    );
    assert.deepEqual(
      models.map((row) => row.displayLabel),
      MAIN_RP_USER_SELECTABLE_OPTIONS.map((row) => row.label)
    );
    assert.deepEqual(RP_QUALITY_BENCHMARK_MODELS, [
      ...MAIN_RP_USER_SELECTABLE_OPTIONS.map((row) => row.label),
    ]);
    assert.deepEqual(RP_ACTIVE_MODEL_QUALITY_MODEL_IDS, MAIN_RP_MODEL_IDS);
    assert.doesNotMatch(PRECALL_SRC, /const\s+PRECALL_MODELS\s*=\s*\[/);
    assertActiveMainRpBenchmarkSet(models);
  });

  it("B. no second literal current-model label list and count is 4", () => {
    const models = rpQualityPrecallBenchmarkModels();
    assert.equal(models.length, 4);
    assert.equal(MAIN_RP_USER_SELECTABLE_OPTIONS.length, 4);
    assert.doesNotMatch(
      PRECALL_SRC,
      /\[\s*"Claude Opus 5\.5"[\s\S]*"DeepSeek V4\.1 Flash"[\s\S]*"GPT-6\.1 Sol"[\s\S]*"Gemini 3\.8 Flash"\s*\]/
    );
    assert.doesNotMatch(PRECALL_SRC, /const expected = \[/);
    assert.equal(PRECALL_SRC.includes("RP_QUALITY_PRECALL_RETIRED_GEMINI_LABELS"), false);
  });

  it("C. retired Gemini 3.1/3.7 are absent from the current benchmark", () => {
    const models = rpQualityPrecallBenchmarkModels();
    const labels = models.map((row) => row.displayLabel);
    const ids = models.map((row) => row.canonicalId);
    assert.equal(ids.includes(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL as never), false);
    assert.equal(ids.includes(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL as never), false);
    assert.equal(labels.includes(GEMINI_31_PRO_PREVIEW_DISPLAY_NAME), false);
    assert.equal(labels.includes(GEMINI_37_FLASH_DISPLAY_NAME), false);
    assert.equal(MAIN_RP_MODEL_IDS.includes(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL as never), false);
    assert.equal(MAIN_RP_MODEL_IDS.includes(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL as never), false);
    const contract = buildQualityEvaluationContract();
    assert.equal(contract.benchmarkModels.includes(GEMINI_31_PRO_PREVIEW_DISPLAY_NAME), false);
    assert.equal(contract.benchmarkModels.includes(GEMINI_37_FLASH_DISPLAY_NAME), false);
  });

  it("D. absent live proof => NOT_REPRODUCIBLE", () => {
    assert.deepEqual(absentLiveProof(), { status: "NOT_PROVIDED" });
    assert.deepEqual(validateLiveProof(undefined), { status: "NOT_PROVIDED" });
    const report = buildRpQualityPrecallReport();
    assert.equal(report.liveProof.status, "NOT_PROVIDED");
    assert.equal(report.classification, "NOT_REPRODUCIBLE");
    assert.equal(report.precallReady, false);
  });

  it("E. live proof is input evidence, not a library-owned environment fact", () => {
    assert.doesNotMatch(PRECALL_SRC, /railwaySsh|UNAUTHORIZED|localDbHasLikeOrRen|status: "UNREADABLE"/);
    const injected = validateLiveProof(testLiveProofInput(), {
      expectedDeploySha: CURRENT_DEPLOY_SHA,
    });
    assert.equal(injected.status, "VERIFIED");
    const report = buildRpQualityPrecallReport({
      liveProofInput: testLiveProofInput(),
      expectedDeploySha: CURRENT_DEPLOY_SHA,
    });
    assert.equal(report.liveProof.status, "VERIFIED");
    assert.equal(report.classification, "PRECALL_READY");
    assert.equal(report.precallReady, true);
    assert.equal(report.providerPosts, 0);
    assert.equal(report.paidExecutionStatus, RP_QUALITY_PRECALL_PAID_STATUS);
  });

  it("F. old recorded LIVE_DEPLOYED_ROW_PROOF cannot satisfy current proof automatically", () => {
    const historical: RpQualityPrecallLiveProofInput = {
      source: HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_OWNER,
      generatedAt: "2026-08-25T00:00:00.000Z",
      deployedGitSha: HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_COMMIT,
      characterId: LIVE_DEPLOYED_ROW_PROOF.characterId,
      characterName: LIVE_DEPLOYED_ROW_PROOF.characterName,
      greetingSha256: LIVE_DEPLOYED_ROW_PROOF.greetingSha256,
      systemPromptSha256: LIVE_DEPLOYED_ROW_PROOF.systemPromptSha256,
      worldSha256: LIVE_DEPLOYED_ROW_PROOF.worldSha256,
      settingChunksSha256: LIVE_DEPLOYED_ROW_PROOF.settingChunksSha256,
      personaPublicSha256: LIVE_DEPLOYED_ROW_PROOF.personaPublicSha256,
      historyProvenance: "historical-recorded-row",
      authoringLevel: "NORMAL",
      contentMode: "SAFE",
    };
    assert.equal(historicalRowProofCannotSatisfyCurrent(historical), true);
    const proof = validateLiveProof(historical, { expectedDeploySha: CURRENT_DEPLOY_SHA });
    assert.equal(proof.status, "UNVERIFIED");
    if (proof.status !== "UNVERIFIED") throw new Error("expected UNVERIFIED");
    assert.ok(
      proof.reasons.includes("historical_LIVE_DEPLOYED_ROW_PROOF_cannot_auto_satisfy")
    );
    const report = buildRpQualityPrecallReport({
      liveProofInput: historical,
      expectedDeploySha: CURRENT_DEPLOY_SHA,
    });
    assert.equal(report.classification, "NOT_REPRODUCIBLE");
    assert.equal(report.precallReady, false);
    assert.equal(
      RP_QUALITY_PRECALL_HISTORICAL_ROW_POINTER.characterId,
      LIVE_DEPLOYED_ROW_PROOF.characterId
    );
    assert.equal(RP_QUALITY_PRECALL_HISTORICAL_ROW_POINTER.isCurrentProductionProof, false);
  });

  it("G. verified proof must match declared/current deploy SHA before PRECALL_READY", () => {
    const mismatched = validateLiveProof(testLiveProofInput(), {
      expectedDeploySha: "ef".repeat(32),
    });
    assert.equal(mismatched.status, "UNVERIFIED");
    const missingExpected = validateLiveProof(testLiveProofInput());
    assert.equal(missingExpected.status, "UNVERIFIED");
    const matched = validateLiveProof(testLiveProofInput(), {
      expectedDeploySha: CURRENT_DEPLOY_SHA,
    });
    assert.equal(matched.status, "VERIFIED");
  });

  it("H. cost approval is required separately after verified proof", () => {
    const denied = startRpQualityPrecallPaidExecution({
      liveProofInput: testLiveProofInput(),
      expectedDeploySha: CURRENT_DEPLOY_SHA,
    });
    assert.equal(denied.started, false);
    assert.equal(denied.providerPosts, 0);
    assert.equal(denied.reason, "MISSING_APPROVED_COST_BOUND");
    const cost = evaluateRpQualityPrecallCostBound();
    assert.equal(cost.status, "UNCOMPUTED");
    assert.equal(cost.approvedBoundUsd, null);
    assert.equal(cost.totalTwelveCallBoundUsd, null);
  });

  it("I. paid authorization is required separately after proof + cost bound", () => {
    const denied = startRpQualityPrecallPaidExecution({
      liveProofInput: testLiveProofInput(),
      expectedDeploySha: CURRENT_DEPLOY_SHA,
      approvedCostBoundUsd: 25,
    });
    assert.equal(denied.started, false);
    assert.equal(denied.providerPosts, 0);
    assert.equal(denied.reason, "NOT_AUTHORIZED_PRECALL_ONLY");
  });

  it("J. PRECALL owner provider POST remains zero even when prerequisites pass", () => {
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
    const noProof = startRpQualityPrecallPaidExecution();
    assert.equal(noProof.reason, "MISSING_VERIFIED_LIVE_PROOF");
    assert.equal(noProof.providerPosts, 0);
  });

  it("K. 3200+ / no max_tokens / MAX_SAFE_INTEGER stream invariant", () => {
    const plan = buildRpQualityPrecallPlan();
    const report = buildRpQualityPrecallReport();
    assert.equal(UNIFIED_TIER_AIM_CHARS, 3200);
    assert.ok(plan.every((row) => row.targetResponseChars === UNIFIED_TIER_AIM_CHARS));
    assert.ok(plan.every((row) => row.applicationMaxTokens === undefined));
    assert.ok(plan.every((row) => row.streamCharCap === Number.MAX_SAFE_INTEGER));
    assert.equal(resolveOpenRouterMaxTokens(3200, 8192, GEMINI_38_FLASH_MODEL), undefined);
    assert.equal(resolveStreamCharCap(3200), Number.MAX_SAFE_INTEGER);
    assert.equal(report.length.softAimChars, 3200);
    assert.equal(report.length.applicationMaxTokens, undefined);
    assert.equal(report.length.longOkClass, "long_ok");
    assert.equal(report.length.centerBandMaxIsMetadataNotCap, 3500);
    assert.equal(report.length.uiEditMaxChars, ASSISTANT_MESSAGE_EDIT_MAX_CHARS);
    assert.equal(ASSISTANT_MESSAGE_EDIT_MAX_CHARS, 5000);
    assert.doesNotMatch(PRECALL_SRC, /slice\(0,\s*(3200|3500|5000)\)/);
    assert.doesNotMatch(PRECALL_SRC, /max_tokens:\s*\d+/);
  });

  it("L. score fields remain null and secrets are absent", () => {
    const packets = buildPlannedQualityPackets();
    assert.equal(packets.length, 12);
    for (const packet of packets) {
      assert.deepEqual(packet.scores, emptyRubricScores());
      assert.ok(Object.values(packet.scores).every((score) => score === null));
      assert.deepEqual(packet.hardGateFlags, {});
      assert.deepEqual(packet.repetitionEvidence, {});
    }
    const contract = buildQualityEvaluationContract();
    assert.equal(contract.cursorScores, false);
    assert.equal(contract.verbosityBiasControl, true);
    assert.equal(contract.verbosityBiasInstruction, RP_QUALITY_VERBOSITY_BIAS_INSTRUCTION);
    assert.match(PACKET_SRC, /verbosityBiasInstruction/);
    const report = buildRpQualityPrecallReport();
    assert.equal(artifactContainsSecret(report), false);
    assert.equal(artifactContainsSecret({ apiKey: "sk-testsecretvalue" }), true);
  });

  it("keeps plan-template semantic parity across four models", () => {
    const plan = buildRpQualityPrecallPlan();
    assertFixturePlannedSemanticParity(plan);
    assert.equal(plan[0]?.plannedSemanticFingerprint != null, true);
    for (const fixtureId of RP_QUALITY_PRECALL_FIXTURE_IDS) {
      const rows = plan.filter((row) => row.fixtureId === fixtureId);
      assert.equal(new Set(rows.map((row) => row.plannedSemanticFingerprint)).size, 1);
      assert.equal(new Set(rows.map((row) => row.adapterFingerprint)).size, 4);
    }
    const report = buildRpQualityPrecallReport();
    assert.equal(report.plannedSemanticParityOnly, true);
  });

  it("keeps retry/fallback/auxiliary at 0 and planned calls at 12", () => {
    const plan = buildRpQualityPrecallPlan();
    assert.ok(plan.every((row) => row.retry === 0 && row.fallback === 0 && row.auxiliary === 0));
    assert.deepEqual(RP_QUALITY_PRECALL_EXECUTION_POLICY, {
      retry: 0,
      fallback: 0,
      auxiliary: 0,
      plannedCalls: 12,
      paidProviderCallsThisOwner: 0,
    });
    assert.equal(RP_QUALITY_PRECALL_PLANNED_CALLS, 12);
    assert.equal(plan.length, 12);
    assert.equal(buildPairedComparisonPackets().length, 18);
  });

  it("does not write chat/session/user points/DB or fetch", () => {
    assert.deepEqual(RP_QUALITY_PRECALL_MUTATION_POLICY, {
      chat: false,
      session: false,
      userPoints: false,
      db: false,
      productionChatSession: false,
      backgroundMemory: false,
      suggestedReply: false,
      regeneration: false,
      continuation: false,
    });
    assert.doesNotMatch(PRECALL_SRC, /\.prepare\(|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|deductPoints|chargeUser/);
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

  it("keeps NORMAL authoring effective policy on the default report", () => {
    const report = buildRpQualityPrecallReport();
    assert.equal(report.authoring.level, "NORMAL");
    assert.equal(report.authoring.capabilities.allowDialogue, true);
    assert.equal(report.authoring.capabilities.allowMajorActions, true);
    assert.equal(report.authoring.capabilities.allowInnerPov, false);
    assert.equal(report.authoring.capabilities.allowIrreversibleFate, false);
    assert.match(report.authoring.evaluationNotes.join(" "), /Do not deduct/);
    assert.equal(report.adultPilot, "SEPARATE_FOLLOW_UP");
    assert.ok(report.fixtures.every((fixture) => fixture.turnKind === "manual"));
    assert.ok(report.fixtures.every((fixture) => fixture.contentMode === "SAFE"));
  });
});
