/**
 * Provider-evidence benchmark preparation gates (BMARK + TRJ + COST).
 * Zero provider HTTP calls. Zero billing calls.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, before, after } from "node:test";

import {
  SCENE_POLICY_BENCHMARK_FIXTURES,
  RECONVERGENCE_TRAJECTORIES,
  EVENT_RESTRAINT_BENCHMARK_IDS,
  LIVING_BENCHMARK_IDS,
  listPilotFixtures,
  listPilotTrajectories,
} from "@/lib/scenePolicyBenchmarkDataset";
import {
  BENCHMARK_OWNER_MAP,
  BLIND_EVALUATION_RUBRIC_ITEMS,
  SCENE_POLICY_ARM_IDS,
  advanceV2ReconvergenceForBenchmark,
  buildBenchmarkArmPayload,
  buildBlindEvaluationPackage,
  buildLiveTrajectoryTurnFixture,
  buildOfflineTrajectoryTurnFixture,
  buildResultCaptureSchema,
  buildScenePolicyInputFromFixture,
  computeExecutionMatrix,
  listModelCandidateFacts,
  proveSceneOnlyDelta,
  resolveSceneStripTextsForArm,
  runBenchmarkCase,
  runFullBenchmarkPreparation,
  serializeReconvergenceState,
  stripSceneOwnedSections,
  verifyBenchmarkCostOwner,
  verifyThreeArmParity,
} from "@/lib/scenePolicyBenchmarkHarness";
import { buildSceneDirective } from "@/lib/sceneDirective";
import { BENCHMARK_CHAR_NAME } from "@/lib/scenePolicyBenchmarkDataset";
import { estimateTokens } from "@/lib/tokenEstimate";

const ROUTE_SOURCE = readFileSync(
  new URL("../app/api/chat/route.ts", import.meta.url),
  "utf8"
);
const HARNESS_SOURCE = readFileSync(
  new URL("./scenePolicyBenchmarkHarness.ts", import.meta.url),
  "utf8"
);

describe("scene policy benchmark preparation BMARK1-BMARK17", () => {
  let fetchCalls = 0;
  let originalFetch: typeof globalThis.fetch | undefined;

  before(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
      fetchCalls += 1;
      return Promise.reject(new Error("benchmark harness must not call fetch"));
    }) as typeof fetch;
  });

  after(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("BMARK1 dataset IDs unique", () => {
    const ids = SCENE_POLICY_BENCHMARK_FIXTURES.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length);
    const trajIds = RECONVERGENCE_TRAJECTORIES.map((t) => t.id);
    assert.equal(new Set(trajIds).size, trajIds.length);
  });

  it("BMARK2 actual final payload normalized parity on all 32 fixtures", () => {
    for (const fixture of SCENE_POLICY_BENCHMARK_FIXTURES) {
      const result = runBenchmarkCase(fixture);
      assert.equal(
        result.parityValid,
        true,
        `${fixture.id}: ${result.parityDiffs.join("; ")}`
      );
      const fp = result.arms.v1.normalizedFinalPayload.nonSceneFingerprint.composite;
      assert.equal(result.arms.v2.normalizedFinalPayload.nonSceneFingerprint.composite, fp);
      assert.equal(result.arms.living.normalizedFinalPayload.nonSceneFingerprint.composite, fp);
    }
  });

  it("BMARK3 model identical across arms", () => {
    const sample = runBenchmarkCase(SCENE_POLICY_BENCHMARK_FIXTURES[0]!);
    const model = sample.arms.v1.nonSceneFingerprint.model;
    assert.ok(model.length > 0);
    assert.equal(sample.arms.v2.nonSceneFingerprint.model, model);
    assert.equal(sample.arms.living.nonSceneFingerprint.model, model);
  });

  it("BMARK4 temperature identical across arms", () => {
    const sample = runBenchmarkCase(SCENE_POLICY_BENCHMARK_FIXTURES[0]!);
    assert.equal(
      sample.arms.v2.nonSceneFingerprint.temperature,
      sample.arms.v1.nonSceneFingerprint.temperature
    );
    assert.equal(
      sample.arms.living.nonSceneFingerprint.temperature,
      sample.arms.v1.nonSceneFingerprint.temperature
    );
  });

  it("BMARK5 max-output identical across arms", () => {
    const sample = runBenchmarkCase(SCENE_POLICY_BENCHMARK_FIXTURES[0]!);
    assert.equal(
      sample.arms.v2.nonSceneFingerprint.maxOutput,
      sample.arms.v1.nonSceneFingerprint.maxOutput
    );
  });

  it("BMARK6 normalized system messages identical across arms", () => {
    const sample = runBenchmarkCase(SCENE_POLICY_BENCHMARK_FIXTURES[0]!);
    assert.equal(
      sample.arms.v2.nonSceneFingerprint.normalizedMessages,
      sample.arms.v1.nonSceneFingerprint.normalizedMessages
    );
  });

  it("BMARK7 memory-bearing fixture normalized parity", () => {
    const f =
      SCENE_POLICY_BENCHMARK_FIXTURES.find((x) => x.memoryText) ??
      SCENE_POLICY_BENCHMARK_FIXTURES[0]!;
    const sample = runBenchmarkCase(f);
    assert.equal(sample.parityValid, true);
  });

  it("BMARK8 history messages identical across arms", () => {
    const sample = runBenchmarkCase(SCENE_POLICY_BENCHMARK_FIXTURES[0]!);
    for (const arm of ["v2", "living"] as const) {
      assert.deepEqual(sample.arms[arm].history, sample.arms.v1.history);
    }
  });

  it("BMARK9 only scene-owned sections differ in actual final payload", () => {
    const sample = runBenchmarkCase(SCENE_POLICY_BENCHMARK_FIXTURES[0]!);
    const delta = proveSceneOnlyDelta(sample.arms);
    assert.equal(delta.rawPayloadDiffers, true);
    assert.equal(delta.normalizedPayloadMatches, true);
    assert.deepEqual(delta.changedSections, ["scene-policy"]);
  });

  it("BMARK10 output capture schema valid", () => {
    const sample = runBenchmarkCase(listPilotFixtures()[0]!);
    const schema = buildResultCaptureSchema({
      caseId: sample.caseId,
      arm: "v2",
      payload: sample.arms.v2,
      reconvergenceBefore: { state: "separated" },
    });
    assert.equal(schema.benchmark_case_id, sample.caseId);
    assert.equal(schema.arm_id, "v2");
    assert.equal(schema.actual_input_tokens, null);
    assert.equal(schema.raw_output, null);
    assert.ok(schema.generation_parameters.temperature != null || schema.generation_parameters.max_tokens != null);
  });

  it("BMARK11 blind permutation preserves answer key", () => {
    const sample = runBenchmarkCase(SCENE_POLICY_BENCHMARK_FIXTURES[0]!);
    const pkg = buildBlindEvaluationPackage(sample);
    const arms = new Set(Object.values(pkg.answerKey));
    assert.equal(arms.size, 3);
    assert.deepEqual([...arms].sort(), ["living", "v1", "v2"]);
    const again = buildBlindEvaluationPackage(sample);
    assert.deepEqual(again.answerKey, pkg.answerKey);
  });

  it("BMARK12 reconvergence trajectory state serializable", () => {
    const traj = RECONVERGENCE_TRAJECTORIES[0]!;
    const turn = traj.turns[1]!;
    const prior = traj.turns.slice(0, 1);
    const fixture = buildOfflineTrajectoryTurnFixture({ trajectory: traj, turn, priorTurns: prior });
    const serialized = serializeReconvergenceState(turn.reconvergenceStateBefore);
    assert.ok(serialized.includes("separated") || serialized === "null");
    assert.ok(fixture.history.length >= 2);
  });

  it("BMARK13 no provider HTTP call during harness run", () => {
    fetchCalls = 0;
    for (const fixture of listPilotFixtures().slice(0, 2)) {
      runBenchmarkCase(fixture);
    }
    computeExecutionMatrix();
    assert.equal(fetchCalls, 0);
  });

  it("BMARK14 harness does not import billing charge path", () => {
    assert.doesNotMatch(HARNESS_SOURCE, /deductPoints|chargePoints|billTurn/);
    assert.doesNotMatch(HARNESS_SOURCE, /from "@\/app\/api\/chat\/route"/);
  });

  it("BMARK15 cost plan arithmetic deterministic", () => {
    const a = computeExecutionMatrix();
    const b = computeExecutionMatrix();
    assert.deepEqual(a.plans, b.plans);
    for (const plan of a.plans) {
      assert.equal(plan.totalCalls, plan.singleTurnCalls + plan.trajectoryCalls);
      assert.ok(plan.estimatedInputTokens > 0);
      assert.ok(plan.estimatedOutputTokens > 0);
      assert.ok(plan.estimatedUpstreamUsd >= 0);
      assert.equal(plan.outputTokenEstimateMethod, "ESTIMATE_HEURISTIC");
    }
  });

  it("BMARK16 production route untouched", () => {
    assert.doesNotMatch(ROUTE_SOURCE, /scenePolicyBenchmark/);
    assert.match(ROUTE_SOURCE, /materializeSceneDirectivePromptBlock/);
  });

  it("BMARK17 owner map and subsets present", () => {
    assert.ok(BENCHMARK_OWNER_MAP.PROVIDER_COST_OWNER.includes("openRouterModelPricing"));
    assert.equal(EVENT_RESTRAINT_BENCHMARK_IDS.length, 10);
    assert.equal(LIVING_BENCHMARK_IDS.length, 7);
    assert.equal(BLIND_EVALUATION_RUBRIC_ITEMS.length, 18);
    assert.equal(listModelCandidateFacts().length, 4);
  });
});

describe("scene policy benchmark token + representation gates BMARK18-BMARK22", () => {
  it("BMARK18 V1 final payload uses compact [SCENE PACING] only", () => {
    const sample = runBenchmarkCase(SCENE_POLICY_BENCHMARK_FIXTURES[0]!);
    const counts = sample.arms.v1.normalizedFinalPayload.sceneOwnerCounts;
    assert.equal(counts.scenePacing, 1);
    assert.equal(counts.v1Full, 0);
  });

  it("BMARK19 V2 final payload uses V2 full block only", () => {
    const sample = runBenchmarkCase(SCENE_POLICY_BENCHMARK_FIXTURES[0]!);
    const counts = sample.arms.v2.normalizedFinalPayload.sceneOwnerCounts;
    assert.equal(counts.v2Full, 1);
    assert.equal(counts.scenePacing, 0);
  });

  it("BMARK20 Living final payload uses Living full block only", () => {
    const sample = runBenchmarkCase(SCENE_POLICY_BENCHMARK_FIXTURES[0]!);
    const counts = sample.arms.living.normalizedFinalPayload.sceneOwnerCounts;
    assert.equal(counts.livingFull, 1);
    assert.equal(counts.scenePacing, 0);
  });

  it("BMARK21 scenePolicyTokenEstimate matches actual final scene text", () => {
    for (const arm of SCENE_POLICY_ARM_IDS) {
      const payload = buildBenchmarkArmPayload({
        fixture: SCENE_POLICY_BENCHMARK_FIXTURES[0]!,
        arm,
      });
      const expected = estimateTokens(payload.normalizedFinalPayload.sceneOwnedText);
      assert.equal(payload.scenePolicyTokenEstimate, expected, arm);
    }
  });

  it("BMARK22 token accounting documents non-additivity limitation", () => {
    const payload = buildBenchmarkArmPayload({
      fixture: SCENE_POLICY_BENCHMARK_FIXTURES[0]!,
      arm: "v1",
    });
    const sum = payload.basePayloadTokenEstimate + payload.scenePolicyTokenEstimate;
    const total = payload.inputTokenEstimate;
    assert.ok(total > 0);
    assert.ok(
      Math.abs(sum - total) <= total * 0.15,
      `base+scene=${sum} vs total=${total} (estimateTokens is non-additive across joins)`
    );
  });
});

describe("scene policy benchmark trajectory contract TRJ1-TRJ4", () => {
  const traj = RECONVERGENCE_TRAJECTORIES.find((t) => t.id === "R1")!;

  it("TRJ1 arm-specific assistant history isolation turn 2", () => {
    const turn2 = traj.turns[1]!;
    const prior: Array<{ userMessage: string; assistantOutputByArm: Record<string, string> }> = [
      {
        userMessage: traj.turns[0]!.userMessage,
        assistantOutputByArm: { v1: "V1_OUTPUT_1", v2: "V2_OUTPUT_1", living: "LIVING_OUTPUT_1" },
      },
    ];
    const v1Fix = buildLiveTrajectoryTurnFixture({
      trajectory: traj,
      turn: turn2,
      arm: "v1",
      priorTurns: prior,
    });
    const v2Fix = buildLiveTrajectoryTurnFixture({
      trajectory: traj,
      turn: turn2,
      arm: "v2",
      priorTurns: prior,
    });
    const v1Assistant = v1Fix.history.filter((m) => m.role === "assistant").map((m) => m.content);
    const v2Assistant = v2Fix.history.filter((m) => m.role === "assistant").map((m) => m.content);
    assert.deepEqual(v1Assistant, ["V1_OUTPUT_1"]);
    assert.deepEqual(v2Assistant, ["V2_OUTPUT_1"]);
  });

  it("TRJ2 multi-turn history remains arm-isolated through turn 3", () => {
    const turn3 = traj.turns[2]!;
    const prior = [
      {
        userMessage: traj.turns[0]!.userMessage,
        assistantOutputByArm: { v1: "V1_OUTPUT_1", v2: "V2_OUTPUT_1", living: "L1" },
      },
      {
        userMessage: traj.turns[1]!.userMessage,
        assistantOutputByArm: { v1: "V1_OUTPUT_2", v2: "V2_OUTPUT_2", living: "L2" },
      },
    ];
    const v1Fix = buildLiveTrajectoryTurnFixture({
      trajectory: traj,
      turn: turn3,
      arm: "v1",
      priorTurns: prior,
    });
    assert.deepEqual(
      v1Fix.history.filter((m) => m.role === "assistant").map((m) => m.content),
      ["V1_OUTPUT_1", "V1_OUTPUT_2"]
    );
  });

  it("TRJ3 V2 reconvergence state only on V2 live fixture", () => {
    const turn2 = traj.turns[1]!;
    const prior = [
      {
        userMessage: traj.turns[0]!.userMessage,
        assistantOutputByArm: { v1: "V1_OUTPUT_1", v2: "V2_OUTPUT_1", living: "L1" },
      },
    ];
    const v1Fix = buildLiveTrajectoryTurnFixture({
      trajectory: traj,
      turn: turn2,
      arm: "v1",
      priorTurns: prior,
    });
    const v2Fix = buildLiveTrajectoryTurnFixture({
      trajectory: traj,
      turn: turn2,
      arm: "v2",
      priorTurns: prior,
    });
    assert.equal(v1Fix.reconvergenceState, undefined);
    assert.ok(v2Fix.reconvergenceState?.state === "separated");
  });

  it("TRJ4 frozenAssistantResponse is offline-only", () => {
    assert.match(HARNESS_SOURCE, /buildOfflineTrajectoryTurnFixture/);
    assert.match(HARNESS_SOURCE, /Must not be used for live provider trajectory execution/);
    assert.doesNotMatch(
      HARNESS_SOURCE,
      /buildLiveTrajectoryTurnFixture[\s\S]*frozenAssistantResponse/
    );
    const turn2 = traj.turns[1]!;
    const offline = buildOfflineTrajectoryTurnFixture({
      trajectory: traj,
      turn: turn2,
      priorTurns: traj.turns.slice(0, 1),
    });
    assert.match(
      offline.history.filter((m) => m.role === "assistant")[0]?.content ?? "",
      /한서린/
    );
  });

  it("TRJ advanceV2ReconvergenceForBenchmark reuses production transition", () => {
    const fixture = SCENE_POLICY_BENCHMARK_FIXTURES.find((f) => f.reconvergenceState)!;
    const input = buildScenePolicyInputFromFixture(fixture);
    const { nextState } = advanceV2ReconvergenceForBenchmark({
      policyInput: input,
      previousState: fixture.reconvergenceState,
    });
    assert.ok(nextState.state === "separated" || nextState.state === "reconverged");
  });
});

describe("scene policy benchmark cost owner COST1-COST3", () => {
  it("COST1 benchmark default model cost owner confirmed", () => {
    const owner = verifyBenchmarkCostOwner();
    assert.equal(owner.status, "COST_OWNER_CONFIRMED");
    assert.equal(owner.transportProvider, "cheaperinference");
    assert.match(owner.upstreamCostSource, /openRouterModelPricing/);
  });

  it("COST2 MINIMAL pilot call count derived from manifest", () => {
    const matrix = computeExecutionMatrix();
    const minimal = matrix.plans.find((p) => p.name === "MINIMAL")!;
    const pilotFixtures = listPilotFixtures();
    const pilotTrajectories = listPilotTrajectories();
    const expectedSingle = pilotFixtures.length * 3;
    const expectedTraj = pilotTrajectories.reduce((s, t) => s + t.turns.length * 2, 0);
    assert.equal(minimal.singleTurnCalls, expectedSingle);
    assert.equal(minimal.trajectoryCalls, expectedTraj);
    assert.equal(minimal.totalCalls, expectedSingle + expectedTraj);
    assert.equal(minimal.totalCalls, 26);
  });

  it("COST3 call plans include selected fixture and trajectory IDs", () => {
    const matrix = computeExecutionMatrix();
    for (const plan of matrix.plans) {
      assert.ok(plan.singleTurnFixtureIds.length > 0);
      assert.ok(plan.callFormula.includes("×"));
      assert.ok(plan.notes.some((n) => n.includes("avg_input_tokens_per_call")));
    }
    const minimal = matrix.plans.find((p) => p.name === "MINIMAL")!;
    assert.deepEqual(minimal.singleTurnFixtureIds.sort(), ["B01a", "B03a", "B10a", "B13a"].sort());
    assert.deepEqual(minimal.trajectoryIds.sort(), ["R1", "R5"].sort());
  });
});

describe("scene policy benchmark strip safety", () => {
  it("stripSceneOwnedSections does not eat adjacent [RHYTHM] section", () => {
    const fixture = SCENE_POLICY_BENCHMARK_FIXTURES[0]!;
    const v2 = buildBenchmarkArmPayload({ fixture, arm: "v2" });
    const policyInput = buildScenePolicyInputFromFixture(fixture);
    const v1Directive = buildSceneDirective({
      ...policyInput,
      primaryCharacterName: BENCHMARK_CHAR_NAME,
      chatId: policyInput.chatId,
      progressionHistory: [],
    });
    const strips = resolveSceneStripTextsForArm({
      arm: "v2",
      systemPrompt: v2.systemPrompt,
      sceneBlockArtifact: v2.sceneBlockArtifact,
    });
    const stripped = stripSceneOwnedSections(v2.systemPrompt, strips);
    assert.ok(stripped.includes("[RHYTHM]"));
    assert.ok(stripped.includes("[IMMERSIVE PROSE]"));
    assert.ok(!stripped.includes("[PRIVATE SCENE PACING RULE]"));
    void v1Directive;
  });
});

describe("scene policy benchmark — parity sweep sample", () => {
  it("verifyThreeArmParity helper matches runBenchmarkCase", () => {
    const fixture = SCENE_POLICY_BENCHMARK_FIXTURES[2]!;
    const arms = {
      v1: buildBenchmarkArmPayload({ fixture, arm: "v1" }),
      v2: buildBenchmarkArmPayload({ fixture, arm: "v2" }),
      living: buildBenchmarkArmPayload({ fixture, arm: "living" }),
    };
    const parity = verifyThreeArmParity(arms);
    const result = runBenchmarkCase(fixture);
    assert.equal(parity.valid, result.parityValid);
  });

  it("runFullBenchmarkPreparation reports zero invalid cases", () => {
    const prep = runFullBenchmarkPreparation();
    assert.equal(prep.invalidCases.length, 0);
    assert.equal(prep.cases.length, 32);
  });
});
