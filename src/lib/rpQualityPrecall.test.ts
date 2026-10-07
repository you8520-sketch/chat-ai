import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
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
  RP_QUALITY_PRECALL_EXECUTION_POLICY,
  RP_QUALITY_PRECALL_FIXTURE_IDS,
  RP_QUALITY_PRECALL_INTENDED_SOURCE,
  RP_QUALITY_PRECALL_MUTATION_POLICY,
  RP_QUALITY_PRECALL_PAID_STATUS,
  RP_QUALITY_PRECALL_PLANNED_CALLS,
  RP_QUALITY_PRECALL_RETIRED_GEMINI_LABELS,
  artifactContainsSecret,
  assertActiveMainRpBenchmarkSet,
  assertFixtureSemanticParity,
  buildPairedComparisonPackets,
  buildPlannedQualityPackets,
  buildRpQualityPrecallPlan,
  buildRpQualityPrecallReport,
  evaluateLiveDeployedInputProof,
  evaluateRpQualityPrecallCostBound,
  rpQualityPrecallBenchmarkModels,
  startRpQualityPrecallPaidExecution,
} from "@/lib/rpQualityPrecall";

const PRECALL_SRC = readFileSync("src/lib/rpQualityPrecall.ts", "utf8");
const PACKET_SRC = readFileSync("src/lib/rpQualityEvaluationPacket.ts", "utf8");

describe("rp quality PRECALL plan", () => {
  it("A. benchmark models are the current Main RP canonical registry", () => {
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

  it("B. exactly four current active models on current main", () => {
    const models = rpQualityPrecallBenchmarkModels();
    assert.equal(models.length, 4);
    assert.equal(MAIN_RP_USER_SELECTABLE_OPTIONS.length, 4);
    assert.deepEqual(
      [...models.map((row) => row.displayLabel)].sort(),
      ["Claude Opus 5.5", "DeepSeek V4.1 Flash", "GPT-6.1 Sol", "Gemini 3.8 Flash"].sort()
    );
    assert.deepEqual(
      models.map((row) => row.canonicalId),
      [
        CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        GEMINI_38_FLASH_MODEL,
        CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
        CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      ]
    );
  });

  it("C. retired Gemini 3.1/3.7 are absent from the current benchmark", () => {
    const labels = rpQualityPrecallBenchmarkModels().map((row) => row.displayLabel);
    const ids = rpQualityPrecallBenchmarkModels().map((row) => row.canonicalId);
    for (const retired of RP_QUALITY_PRECALL_RETIRED_GEMINI_LABELS) {
      assert.equal(labels.includes(retired), false);
    }
    assert.equal(ids.includes("gemini-3.1-pro-preview" as never), false);
    assert.equal(ids.includes("gemini-3.7-flash" as never), false);
    const contract = buildQualityEvaluationContract();
    assert.equal(contract.benchmarkModels.includes("Gemini 3.1 Pro Preview"), false);
    assert.equal(contract.benchmarkModels.includes("Gemini 3.7 Flash"), false);
  });

  it("D. same fixture semantic inputs are equal across the four models", () => {
    const plan = buildRpQualityPrecallPlan();
    assertFixtureSemanticParity(plan);
    for (const fixtureId of RP_QUALITY_PRECALL_FIXTURE_IDS) {
      const fingerprints = plan
        .filter((row) => row.fixtureId === fixtureId)
        .map((row) => row.semanticFingerprint);
      assert.equal(new Set(fingerprints).size, 1);
    }
  });

  it("E. only model/routing/adapter-owned differences are allowed", () => {
    const plan = buildRpQualityPrecallPlan();
    for (const fixtureId of RP_QUALITY_PRECALL_FIXTURE_IDS) {
      const rows = plan.filter((row) => row.fixtureId === fixtureId);
      assert.equal(new Set(rows.map((row) => row.adapterFingerprint)).size, 4);
      assert.equal(new Set(rows.map((row) => row.model.provider)).size >= 2, true);
      assert.equal(new Set(rows.map((row) => row.model.wireModel)).size, 4);
    }
  });

  it("F. 3200+ soft aim is preserved and no prose ceiling is introduced", () => {
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

  it("G. Cursor score fields remain null", () => {
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
    assert.doesNotMatch(PACKET_SRC, /COMMON_PROSE_BLOCK/);
  });

  it("H. live execution plan has retry=0 / fallback=0 / auxiliary=0", () => {
    const plan = buildRpQualityPrecallPlan();
    assert.ok(plan.every((row) => row.retry === 0 && row.fallback === 0 && row.auxiliary === 0));
    assert.deepEqual(RP_QUALITY_PRECALL_EXECUTION_POLICY, {
      retry: 0,
      fallback: 0,
      auxiliary: 0,
      plannedCalls: 12,
      paidProviderCallsThisOwner: 0,
    });
  });

  it("I. planned call count is 12", () => {
    assert.equal(RP_QUALITY_PRECALL_PLANNED_CALLS, 12);
    assert.equal(buildRpQualityPrecallPlan().length, 12);
    assert.equal(RP_QUALITY_PRECALL_FIXTURE_IDS.length * MAIN_RP_MODEL_IDS.length, 12);
    const report = buildRpQualityPrecallReport();
    assert.equal(report.plannedCalls, 12);
    assert.equal(report.pairedComparisons.length, 18);
    assert.ok(report.pairedComparisons.every((pair) => pair.overall === null));
    assert.ok(report.fixtures.every((fixture) => fixture.turnKind === "manual"));
    assert.ok(report.fixtures.every((fixture) => fixture.contentMode === "SAFE"));
  });

  it("J. runner cannot start without an explicit approved cost bound", () => {
    const denied = startRpQualityPrecallPaidExecution();
    assert.equal(denied.started, false);
    assert.equal(denied.providerPosts, 0);
    assert.equal(denied.reason, "MISSING_APPROVED_COST_BOUND");
    assert.equal(denied.paidExecutionStatus, RP_QUALITY_PRECALL_PAID_STATUS);
    const stillBlocked = startRpQualityPrecallPaidExecution({
      approvedCostBoundUsd: 25,
      paidExecutionAuthorized: true,
    });
    assert.equal(stillBlocked.started, false);
    assert.equal(stillBlocked.providerPosts, 0);
    assert.equal(stillBlocked.reason, "LIVE_DEPLOYED_ROW_UNREADABLE");
    const cost = evaluateRpQualityPrecallCostBound();
    assert.equal(cost.status, "UNCOMPUTED");
    assert.equal(cost.approvedBoundUsd, null);
    assert.equal(cost.totalTwelveCallBoundUsd, null);
    assert.equal(cost.catalogRatesUsdPerMillion.length, 4);
  });

  it("K. benchmark runner does not write chat/session/user points/DB", () => {
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

  it("L. secret values are absent from the artifact", () => {
    const report = buildRpQualityPrecallReport();
    assert.equal(artifactContainsSecret(report), false);
    assert.equal(artifactContainsSecret({ apiKey: "sk-testsecretvalue" }), true);
    assert.equal(
      artifactContainsSecret({ notes: "OPENROUTER_API_KEY=sk-live-should-not-appear" }),
      true
    );
    const json = JSON.stringify(report);
    assert.doesNotMatch(json, /sk-[a-zA-Z0-9]{10,}/);
    assert.doesNotMatch(json, /Bearer\s+[A-Za-z0-9]/);
  });

  it("records intended 라이크/렌 identity without claiming a live reconfirm", () => {
    const proof = evaluateLiveDeployedInputProof();
    assert.equal(proof.status, "UNREADABLE");
    assert.equal(proof.reconfirmed, false);
    assert.equal(proof.syntheticSubstitution, false);
    assert.equal(proof.historicalQualificationDumpUsedAsProduction, false);
    assert.equal(
      RP_QUALITY_PRECALL_INTENDED_SOURCE.characterId,
      LIVE_DEPLOYED_ROW_PROOF.characterId
    );
    assert.equal(
      RP_QUALITY_PRECALL_INTENDED_SOURCE.characterName,
      LIVE_DEPLOYED_ROW_PROOF.characterName
    );
    assert.equal(RP_QUALITY_PRECALL_INTENDED_SOURCE.personaName, "렌");
    const report = buildRpQualityPrecallReport();
    assert.equal(report.classification, "NOT_REPRODUCIBLE");
    assert.equal(report.precallReady, false);
    assert.equal(report.providerPosts, 0);
    assert.equal(report.authoring.level, "NORMAL");
    assert.equal(report.authoring.capabilities.allowDialogue, true);
    assert.equal(report.authoring.capabilities.allowMajorActions, true);
    assert.equal(report.authoring.capabilities.allowInnerPov, false);
    assert.equal(report.authoring.capabilities.allowIrreversibleFate, false);
    assert.match(report.authoring.evaluationNotes.join(" "), /Do not deduct/);
    assert.equal(report.adultPilot, "SEPARATE_FOLLOW_UP");
  });
});
