/**
 * Provider-evidence benchmark preparation gates (BMARK1–BMARK17).
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
} from "@/lib/scenePolicyBenchmarkDataset";
import {
  BENCHMARK_OWNER_MAP,
  BLIND_EVALUATION_RUBRIC_ITEMS,
  SCENE_POLICY_ARM_IDS,
  buildBenchmarkArmPayload,
  buildBlindEvaluationPackage,
  buildResultCaptureSchema,
  buildTrajectoryTurnFixture,
  computeExecutionMatrix,
  listModelCandidateFacts,
  runBenchmarkCase,
  runFullBenchmarkPreparation,
  serializeReconvergenceState,
  verifyThreeArmParity,
} from "@/lib/scenePolicyBenchmarkHarness";

const ROUTE_SOURCE = readFileSync(
  new URL("../app/api/chat/route.ts", import.meta.url),
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

  it("BMARK2 V1/V2/Living same non-scene fingerprint on pilot fixtures", () => {
    for (const fixture of listPilotFixtures().slice(0, 2)) {
      const result = runBenchmarkCase(fixture);
      assert.equal(
        result.parityValid,
        true,
        `${fixture.id}: ${result.parityDiffs.join("; ")}`
      );
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

  it("BMARK6 canon identical across arms", () => {
    const sample = runBenchmarkCase(SCENE_POLICY_BENCHMARK_FIXTURES[0]!);
    assert.equal(sample.arms.v2.nonSceneFingerprint.canon, sample.arms.v1.nonSceneFingerprint.canon);
  });

  it("BMARK7 memory identical across arms", () => {
    const f = SCENE_POLICY_BENCHMARK_FIXTURES.find((x) => x.memoryText) ?? SCENE_POLICY_BENCHMARK_FIXTURES[0]!;
    const sample = runBenchmarkCase(f);
    assert.equal(sample.arms.v2.nonSceneFingerprint.memory, sample.arms.v1.nonSceneFingerprint.memory);
  });

  it("BMARK8 history identical across arms", () => {
    const sample = runBenchmarkCase(SCENE_POLICY_BENCHMARK_FIXTURES[0]!);
    assert.equal(sample.arms.v2.nonSceneFingerprint.history, sample.arms.v1.nonSceneFingerprint.history);
  });

  it("BMARK9 only scene block differs across arms", () => {
    const sample = runBenchmarkCase(SCENE_POLICY_BENCHMARK_FIXTURES[0]!);
    const blocks = new Set(SCENE_POLICY_ARM_IDS.map((a) => sample.arms[a].sceneBlock));
    assert.equal(blocks.size, 3);
    assert.notEqual(sample.arms.v1.sceneBlock, sample.arms.v2.sceneBlock);
    assert.notEqual(sample.arms.v1.sceneBlock, sample.arms.living.sceneBlock);
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
    const fixture = buildTrajectoryTurnFixture({ trajectory: traj, turn, priorTurns: prior });
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
    const harnessSource = readFileSync(
      new URL("./scenePolicyBenchmarkHarness.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(harnessSource, /deductPoints|chargePoints|billTurn/);
    assert.doesNotMatch(harnessSource, /from "@\/app\/api\/chat\/route"/);
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
});
