import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFixtureResult,
  buildTrpgNarrationSceneMessages,
  evaluateCompatibilityProbe,
  heroEventPositions,
  loadFixtures,
  renderReviewPacket,
  runCurrentRawArm,
  runDeterministicArm,
  sha256Canonical,
  summarizeInvocationCounts,
  type TrpgBenchmarkFixture,
} from "./trpg-image-scene-selection.harness";

describe("trpg image scene selection benchmark harness", () => {
  it("loads exactly 10 fixtures with stable SHA256", () => {
    const file = loadFixtures();
    assert.equal(file.fixtures.length, 10);
    const ids = file.fixtures.map((row) => row.fixtureId);
    assert.deepEqual(ids, ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10"]);
    const shas = new Set(
      file.fixtures.map((row) =>
        sha256Canonical({
          location: row.location,
          actions: row.actions,
          narration: row.narration,
        })
      )
    );
    assert.equal(shas.size, 10);
  });

  it("runs CURRENT_RAW and DETERMINISTIC arms without provider calls", () => {
    const fixture = loadFixtures().fixtures[0]!;
    const raw = runCurrentRawArm(fixture);
    assert.ok(raw.situation.includes("GM SCENE:"));
    assert.ok(raw.chars > 0);
    const messages = buildTrpgNarrationSceneMessages(fixture.narration);
    const deterministic = runDeterministicArm(messages);
    assert.ok(deterministic.events.length > 0);
    assert.ok(Array.isArray(deterministic.heroEventIds));
  });

  it("serializes fixture result with GPT score pending", () => {
    const fixture = loadFixtures().fixtures[3]!;
    const result = buildFixtureResult(fixture, null);
    const json = JSON.stringify(result);
    assert.match(json, /GPT_SCORE_PENDING/);
    assert.doesNotMatch(json, /expectedWinner|bestHeroEvent|AIShouldWin/);
  });

  it("renders review packet blocks for all fixtures", () => {
    const fixtures = loadFixtures().fixtures.map((fixture) => buildFixtureResult(fixture, null));
    const packet = renderReviewPacket({
      version: 1,
      baseMainSha: "base",
      benchmarkHeadSha: "head",
      nodeVersion: process.version,
      resolvedPrimaryModel: "primary",
      resolvedFallbackModel: "fallback",
      scenePlanMaxProviderAttempts: 2,
      scenePlanRetryCount: 0,
      compatibility: { status: "PENDING", probeFixtureIds: ["F1", "F5"], checks: {} },
      invocationCounts: summarizeInvocationCounts(fixtures, 0),
      latenciesMs: [],
      fixtures,
    });
    for (const id of ["F1", "F4", "F10"]) {
      assert.match(packet, new RegExp(`${id} —`));
    }
    assert.match(packet, /GPT SCORE/);
    assert.match(packet, /PENDING/);
  });

  it("computes hero event positions for late-climax fixture", () => {
    const fixture = loadFixtures().fixtures.find((row) => row.fixtureId === "F4")!;
    const deterministic = runDeterministicArm(buildTrpgNarrationSceneMessages(fixture.narration));
    const positions = heroEventPositions(deterministic.events, deterministic.heroEventIds);
    assert.ok(positions.length > 0);
    assert.ok(positions.every((value) => value >= 0 && value <= 1));
  });

  it("evaluates compatibility probe structure", () => {
    const fixture = loadFixtures().fixtures[0] as TrpgBenchmarkFixture;
    const base = buildFixtureResult(fixture, null);
    const pass = evaluateCompatibilityProbe([
      {
        ...base,
        aiPlanner: {
          outcome: "PRIMARY_MODEL_SUCCESS",
          resolvedPrimaryModel: "primary",
          resolvedFallbackModel: "fallback",
          model: "primary",
          attempts: 1,
          usedFallback: false,
          latencyMs: 100,
          inputTokens: null,
          outputTokens: null,
          providerCostUsd: null,
          events: base.deterministic.events,
          heroEventIds: base.deterministic.heroEventIds,
          heroScene: base.deterministic.heroScene,
          sceneBackground: base.deterministic.sceneBackground,
          recommendedPanelCount: base.deterministic.recommendedPanelCount,
          panels: [],
          heroEventPositions: base.deterministic.heroEventPositions,
        },
        objective: {
          ...base.objective,
          heroIdsValid: true,
          provenanceValid: true,
          inventedEvent: false,
          rewritesPartyAction: false,
        },
      },
    ]);
    assert.equal(pass.status, "PASS");
  });
});
