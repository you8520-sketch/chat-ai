import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  classifyGenerationFailure,
  migrateLegacyProbeResultsWithTimestamp,
  normalizeProbeRunRecord,
  type SandboxBlueprintProbeRunRecord,
} from "./sandboxBlueprintProbeMetrics";

function transportTimeoutRun(partial: Partial<SandboxBlueprintProbeRunRecord> = {}): SandboxBlueprintProbeRunRecord {
  return {
    worldId: "W03_fantasy_adventure",
    category: "fantasy adventure",
    runIndex: 0,
    highRisk: false,
    primaryParseSuccess: false,
    repairTriggered: false,
    repairSuccess: false,
    generationFailure: null,
    semanticReject: true,
    metrics: null,
    planSummary: null,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    error: "body completion deadline exceeded",
    ...partial,
  };
}

describe("TRPG sandbox Blueprint probe metrics", () => {
  it("classifies transport timeout separately from semantic reject", () => {
    const normalized = normalizeProbeRunRecord(transportTimeoutRun());
    assert.equal(normalized.generationFailure, "transport_timeout");
    assert.equal(normalized.semanticReject, false);
    assert.equal(normalized.metrics, null);
  });

  it("sets semanticReject only when a parsed Blueprint fails evaluateSandboxBlueprint", () => {
    const accepted = normalizeProbeRunRecord({
      ...transportTimeoutRun(),
      primaryParseSuccess: true,
      error: null,
      semanticReject: false,
      metrics: {
        STARTING_SITUATION_PRESENT: true,
        CENTRAL_CONFLICT_PRESENT: true,
        GOAL_PRESENT: true,
        ENDING_CONDITIONS_COUNT: 2,
        ENDING_CONDITIONS_VALID: true,
        ENDING_CANDIDATES_COUNT: 1,
        MAJOR_EVENTS_COUNT: 1,
        CLUES_COUNT: 1,
        CLIMAX_PRESENT: true,
        EVALUATE_SANDBOX_BLUEPRINT_PASS: true,
        WORLD_CANON_CONTRADICTION: false,
        PLAYER_ACTION_PREDECIDED: false,
        RAILROAD_MAJOR: false,
        ENDING_CONDITION_VAGUE: false,
        ENDING_CONDITION_DUPLICATES_ENDING_CANDIDATE: false,
        ENDING_CONDITIONS_QUALITY: "PLAYABLE",
        GLOBAL_DIRECTION: "ADEQUATE",
        MAJOR_EVENTS: "OPTIONAL",
        CLUES: "USEFUL",
        CLIMAX: "PLAUSIBLE",
        ENDING_CANDIDATES: "FLEXIBLE",
        PLAYER_AGENCY: "PRESERVED",
      },
      planSummary: {},
    });
    assert.equal(accepted.generationFailure, null);
    assert.equal(accepted.semanticReject, false);

    const rejected = normalizeProbeRunRecord({
      ...accepted,
      metrics: { ...accepted.metrics!, EVALUATE_SANDBOX_BLUEPRINT_PASS: false },
    });
    assert.equal(rejected.semanticReject, true);
  });

  it("reclassifies frozen probe artifact with 4 transport failures and 0 semantic rejects", () => {
    const raw = JSON.parse(
      readFileSync(join("docs/audits/trpg-sandbox-blueprint-quality-probe/probe-results.json"), "utf8")
    ) as { runs: Array<Record<string, unknown>>; generatedAt?: string };
    const summary = migrateLegacyProbeResultsWithTimestamp(raw);
    assert.equal(summary.totalProviderRuns, 16);
    assert.equal(summary.successfulParsedBlueprints, 12);
    assert.equal(summary.transportFailures, 4);
    assert.equal(summary.parseFailures, 0);
    assert.equal(summary.repairFailures, 0);
    assert.equal(summary.semanticBlueprintRejects, 0);
    assert.equal(summary.missingEndingConditionsAmongParsed, 0);
    assert.equal(summary.highRiskTransportFailures, 1);
    assert.equal(summary.highRiskMissingEndingConditions, 0);
    assert.equal(summary.agencyHeuristicHits, 2);
    assert.equal(summary.agencyHumanConfirmedFailures, 0);
    assert.equal(summary.railroadHeuristicHits, 2);
    assert.equal(summary.railroadHumanConfirmedFailures, 0);
    assert.equal(summary.primaryWorldEndToEndPassRate, 9 / 12);
    assert.equal(summary.primaryParsedBlueprintAcceptanceRate, 1);
    assert.equal(summary.parsedBlueprintAcceptanceRate, 1);
    assert.ok(
      summary.runs.every(
        (run) => !(run.generationFailure === "transport_timeout" && run.semanticReject)
      )
    );
  });

  it("maps repair failure when repair was triggered but did not succeed", () => {
    assert.equal(
      classifyGenerationFailure({
        error: "invalid json",
        primaryParseSuccess: false,
        repairTriggered: true,
        repairSuccess: false,
      }),
      "repair_failure"
    );
  });
});
