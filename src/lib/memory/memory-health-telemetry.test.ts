import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMemoryHealthTelemetry } from "./memory-health-telemetry";
import { EPISODIC_SEMANTIC_MODEL_CANDIDATES } from "./memory-episodic-semantic-config";

describe("memory health telemetry", () => {
  it("emits compact 5+4 fields without prose", () => {
    const payload = buildMemoryHealthTelemetry({
      completedPlayableTurns: 9,
      summarizedThrough: 5,
      summaryHealthState: "SUMMARY_HEALTHY",
      realRawCompleteExchanges: 4,
      openingInRaw: true,
      bridgeInRaw: false,
      episodicCandidateCount: 3,
      episodicInjectedCount: 2,
      episodicDuplicateBlockedCount: 1,
      episodicBudgetBlockedCount: 0,
      episodicSemanticRuntime: { enabled: false, reason: "flag_off" },
      episodicSemanticQueryReason: "disabled",
      statusExtractCallCount: 0,
    });
    assert.equal(payload.memory_policy, "summary5_raw4");
    assert.equal(payload.next_pending_summary_range, "6~10");
    assert.equal(payload.summary_health_state, "SUMMARY_HEALTHY");
    assert.equal(payload.real_raw_complete_exchanges, 4);
    assert.equal(payload.opening_in_raw, true);
    assert.equal(payload.episodic_semantic_runtime_enabled, false);
    assert.equal(payload.episodic_semantic_runtime_model, null);
    assert.equal(payload.episodic_semantic_runtime_reason, "flag_off");
    assert.equal(payload.episodic_semantic_query_reason, "disabled");
    const json = JSON.stringify(payload);
    assert.doesNotMatch(json, /유저:|캐릭터:|안녕/);
  });

  it("reports the active approved semantic model and actual query outcome without exposing env values", () => {
    const payload = buildMemoryHealthTelemetry({
      completedPlayableTurns: 20,
      summarizedThrough: 15,
      summaryHealthState: "SUMMARY_ONE_BATCH_BEHIND",
      realRawCompleteExchanges: 4,
      openingInRaw: false,
      bridgeInRaw: false,
      episodicCandidateCount: 8,
      episodicInjectedCount: 2,
      episodicDuplicateBlockedCount: 0,
      episodicBudgetBlockedCount: 0,
      episodicSemanticRuntime: {
        enabled: true,
        model: EPISODIC_SEMANTIC_MODEL_CANDIDATES.bge_m3,
      },
      episodicSemanticQueryReason: "ok",
      statusExtractCallCount: 0,
    });

    assert.equal(payload.summary_health_state, "SUMMARY_ONE_BATCH_BEHIND");
    assert.equal(payload.episodic_semantic_runtime_enabled, true);
    assert.equal(payload.episodic_semantic_runtime_model, "baai/bge-m3");
    assert.equal(payload.episodic_semantic_runtime_reason, null);
    assert.equal(payload.episodic_semantic_query_reason, "ok");

    const json = JSON.stringify(payload);
    assert.doesNotMatch(json, /EPISODIC_SEMANTIC_DISCOVERY_ENABLED|EPISODIC_SEMANTIC_MODEL=/);
  });
});


  it("does not mislabel disabled memory as healthy", () => {
    const payload = buildMemoryHealthTelemetry({
      completedPlayableTurns: 0,
      summarizedThrough: 0,
      summaryHealthState: "MEMORY_DISABLED",
      realRawCompleteExchanges: 0,
      openingInRaw: false,
      bridgeInRaw: false,
      episodicCandidateCount: 0,
      episodicInjectedCount: 0,
      episodicDuplicateBlockedCount: 0,
      episodicBudgetBlockedCount: 0,
      episodicSemanticRuntime: { enabled: false, reason: "flag_off" },
      episodicSemanticQueryReason: "disabled",
      statusExtractCallCount: 0,
    });
    assert.equal(payload.summary_health_state, "MEMORY_DISABLED");
  });
