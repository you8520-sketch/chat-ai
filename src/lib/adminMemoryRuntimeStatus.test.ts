import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAdminMemoryRuntimeStatus } from "@/lib/adminMemoryRuntimeStatus";

describe("admin memory runtime status", () => {
  it("uses canonical defaults: memory+recall on, semantic off, summary5_raw4 code-owned", () => {
    const status = buildAdminMemoryRuntimeStatus({} as NodeJS.ProcessEnv);

    assert.equal(status.memoryFeatureEnabled, true);
    assert.equal(status.episodicRecallEnabled, true);
    assert.deepEqual(status.semantic, {
      enabled: false,
      configuredModelKey: null,
      activeModelId: null,
      configVersion: null,
      reason: "flag_off",
    });
    assert.deepEqual(status.policy, {
      id: "summary5_raw4",
      rollingSummaryInterval: 5,
      rawRecentExchanges: 4,
    });
  });

  it("honors the canonical global memory and episodic recall kill switches in effective semantic state", () => {
    const memoryOff = buildAdminMemoryRuntimeStatus({
      MEMORY_FEATURE_ENABLED: "0",
      EPISODIC_MEMORY_RECALL_ENABLED: "1",
      EPISODIC_SEMANTIC_DISCOVERY_ENABLED: "1",
      EPISODIC_SEMANTIC_MODEL: "bge_m3",
    } as NodeJS.ProcessEnv);
    assert.equal(memoryOff.memoryFeatureEnabled, false);
    assert.equal(memoryOff.episodicRecallEnabled, false);
    assert.equal(memoryOff.semantic.enabled, false);
    assert.equal(memoryOff.semantic.reason, "memory_feature_off");

    const recallOff = buildAdminMemoryRuntimeStatus({
      MEMORY_FEATURE_ENABLED: "1",
      EPISODIC_MEMORY_RECALL_ENABLED: "0",
      EPISODIC_SEMANTIC_DISCOVERY_ENABLED: "1",
      EPISODIC_SEMANTIC_MODEL: "bge_m3",
    } as NodeJS.ProcessEnv);
    assert.equal(recallOff.memoryFeatureEnabled, true);
    assert.equal(recallOff.episodicRecallEnabled, false);
    assert.equal(recallOff.semantic.enabled, false);
    assert.equal(recallOff.semantic.reason, "episodic_recall_off");
  });

  it("reports approved BGE semantic runtime when the canonical gate enables it", () => {
    const status = buildAdminMemoryRuntimeStatus({
      EPISODIC_SEMANTIC_DISCOVERY_ENABLED: "1",
      EPISODIC_SEMANTIC_MODEL: "bge_m3",
    } as NodeJS.ProcessEnv);

    assert.equal(status.semantic.enabled, true);
    assert.equal(status.semantic.reason, "ACTIVE");
    assert.equal(status.semantic.configuredModelKey, "bge_m3");
    assert.equal(status.semantic.activeModelId, "baai/bge-m3");
    assert.match(status.semantic.configVersion ?? "", /approved/);
  });

  it("shows provisional Qwen as configured but not active", () => {
    const status = buildAdminMemoryRuntimeStatus({
      EPISODIC_SEMANTIC_DISCOVERY_ENABLED: "true",
      EPISODIC_SEMANTIC_MODEL: "qwen3_embedding_8b",
    } as NodeJS.ProcessEnv);

    assert.equal(status.semantic.enabled, false);
    assert.equal(status.semantic.configuredModelKey, "qwen3_embedding_8b");
    assert.equal(status.semantic.activeModelId, null);
    assert.equal(status.semantic.reason, "config_provisional_live_benchmark_pending");
  });

  it("does not let the legacy MEMORY_5PLUS4_ENABLED env own the current 5+4 policy", () => {
    const disabledLegacy = buildAdminMemoryRuntimeStatus({
      MEMORY_5PLUS4_ENABLED: "0",
    } as NodeJS.ProcessEnv);
    const enabledLegacy = buildAdminMemoryRuntimeStatus({
      MEMORY_5PLUS4_ENABLED: "1",
    } as NodeJS.ProcessEnv);

    assert.deepEqual(disabledLegacy.policy, enabledLegacy.policy);
    assert.deepEqual(disabledLegacy.policy, {
      id: "summary5_raw4",
      rollingSummaryInterval: 5,
      rawRecentExchanges: 4,
    });
  });
});
