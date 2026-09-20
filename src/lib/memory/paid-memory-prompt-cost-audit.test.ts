/**
 * DURABLE_REGRESSION — peak input pressure + turn price audit invariants (zero provider calls).
 */
import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { FREE_CAPABILITY, SUBSCRIBED_CAPABILITY } from "@/lib/subscriptionMemoryCapability";
import {
  AUDIT_CODE_CLASSIFICATION,
  AUDIT_OUTPUT_PRESET_CHARS,
  PAID_MEMORY_CONFIGS,
  PRODUCT_MODEL,
  assemblePaidMemoryPromptRow,
  auditDuplicationOverlap,
  buildAbsoluteMaxInputTable,
  buildInputAmplificationTable,
  buildTurnPriceRow,
  classifyInputPressureBand,
  classifyInputThresholds,
  clearPaidMemoryAuditRowCache,
  computePaidMemoryDeltas,
  generatePaidMemoryAuditReport,
  simulateGlobalMaintenanceLifecycle,
} from "./paid-memory-prompt-cost-audit";

function configById(id: (typeof PAID_MEMORY_CONFIGS)[number]["id"]) {
  return PAID_MEMORY_CONFIGS.find((c) => c.id === id)!;
}

describe("peak input pressure + turn price audit", () => {
  it("classifies audit code as ONE_OFF_FORENSIC", () => {
    assert.equal(AUDIT_CODE_CLASSIFICATION, "ONE_OFF_FORENSIC");
  });

  it("documents subscription as memory add-on + usage billing", () => {
    assert.equal(PRODUCT_MODEL.subscriptionType, "MONTHLY_MEMORY_ADDON_PLUS_USAGE_BILLING");
    assert.equal(PRODUCT_MODEL.normalUsageBilling, "CONTINUES");
  });

  it("classifies input pressure bands", () => {
    assert.equal(classifyInputPressureBand(20_000), "UNDER_28K");
    assert.equal(classifyInputPressureBand(30_000), "28K_TO_40K");
    assert.equal(classifyInputPressureBand(45_000), "40K_TO_50K");
    assert.equal(classifyInputPressureBand(55_000), "50K_TO_60K");
    assert.equal(classifyInputPressureBand(65_000), "60K_OR_MORE");
    const t = classifyInputThresholds(45_000);
    assert.equal(t.crossed28k, true);
    assert.equal(t.crossed40k, true);
    assert.equal(t.crossed50k, false);
  });

  it("FREE vs PAID capability caps match production", () => {
    const free = PAID_MEMORY_CONFIGS.find((c) => c.id === "FREE_CURRENT")!;
    const paid = PAID_MEMORY_CONFIGS.find((c) => c.id === "PAID_CURRENT")!;
    assert.deepEqual(free.capability, FREE_CAPABILITY);
    assert.deepEqual(paid.capability, SUBSCRIBED_CAPABILITY);
    assert.equal(free.simulatedGlobalCapacity, MEMORY_CAPACITY_FIXED);
  });

  it("uses real buildContext assembly for all Main RP models (T300 NORMAL)", () => {
    clearPaidMemoryAuditRowCache();
    for (const modelId of MAIN_RP_MODEL_IDS) {
      const row = assemblePaidMemoryPromptRow({
        modelId,
        config: configById("PAID_CURRENT"),
        currentTurn: 300,
        load: "NORMAL",
      });
      assert.ok(row.localEstimatedTokensTotal > 0);
      assert.ok(row.sectionInventory.length > 5);
      assert.ok(row.sectionInventory.every((s) => s.pctOfTotalInput >= 0));
      assert.equal(row.criticalSectionOmitted, false);
      assert.equal(row.mediumPresent, true);
    }
  });

  it("PAID peak input >= FREE peak at T2000", () => {
    clearPaidMemoryAuditRowCache();
    const modelId = MAIN_RP_MODEL_IDS[0]!;
    const free = assemblePaidMemoryPromptRow({
      modelId,
      config: configById("FREE_CURRENT"),
      currentTurn: 2000,
      load: "PEAK_MEMORY",
    });
    const paid = assemblePaidMemoryPromptRow({
      modelId,
      config: configById("PAID_CURRENT"),
      currentTurn: 2000,
      load: "PEAK_MEMORY",
    });
    assert.ok(paid.localEstimatedTokensTotal >= free.localEstimatedTokensTotal);
    assert.ok(paid.userLorebookChars >= free.userLorebookChars);
  });

  it("PAID_GLOBAL_15K adds Global without critical section loss", () => {
    clearPaidMemoryAuditRowCache();
    const modelId = MAIN_RP_MODEL_IDS[0]!;
    const paid = assemblePaidMemoryPromptRow({
      modelId,
      config: configById("PAID_CURRENT"),
      currentTurn: 2000,
      load: "PEAK_MEMORY",
    });
    const g15 = assemblePaidMemoryPromptRow({
      modelId,
      config: configById("PAID_GLOBAL_15K"),
      currentTurn: 2000,
      load: "PEAK_MEMORY",
    });
    assert.equal(g15.criticalSectionOmitted, false);
    assert.equal(g15.mediumPresent, paid.mediumPresent);
    assert.ok(g15.globalChars >= paid.globalChars);
  });

  it("turn price increases with input for input-sensitive models (same output)", () => {
    clearPaidMemoryAuditRowCache();
    const modelId = MAIN_RP_MODEL_IDS[0]!;
    const freePrice = buildTurnPriceRow({
      modelId,
      configId: "FREE_CURRENT",
      currentTurn: 2000,
      load: "PEAK_MEMORY",
      outputPresetChars: AUDIT_OUTPUT_PRESET_CHARS.canonical,
    });
    const paidPrice = buildTurnPriceRow({
      modelId,
      configId: "PAID_CURRENT",
      currentTurn: 2000,
      load: "PEAK_MEMORY",
      outputPresetChars: AUDIT_OUTPUT_PRESET_CHARS.canonical,
    });
    assert.ok(paidPrice.pCharge >= freePrice.pCharge);
    assert.ok(paidPrice.inputTokens >= freePrice.inputTokens);
  });

  it("computes isolated delta pairs FREE→PAID→G15→G20", () => {
    clearPaidMemoryAuditRowCache();
    const modelId = MAIN_RP_MODEL_IDS[0]!;
    const deltas = computePaidMemoryDeltas(modelId);
    assert.equal(deltas.length, 3);
    assert.equal(deltas[0]!.from, "FREE_CURRENT");
    assert.equal(deltas[1]!.to, "PAID_GLOBAL_15K");
  });

  it("absolute max table reports per-model peaks", () => {
    clearPaidMemoryAuditRowCache();
    const modelId = MAIN_RP_MODEL_IDS[0]!;
    const abs = buildAbsoluteMaxInputTable(modelId);
    assert.ok(abs.freeMaxInput > 0);
    assert.ok(abs.paidCurrentMaxInput >= abs.freeMaxInput);
  });

  it("input amplification ratio at T2000 peak", () => {
    clearPaidMemoryAuditRowCache();
    const modelId = MAIN_RP_MODEL_IDS[0]!;
    const amp = buildInputAmplificationTable(modelId, 2000, "PEAK_MEMORY");
    assert.ok(amp.paidCurrentRatio >= 1);
    assert.ok(amp.global15Ratio >= 1);
  });

  it("duplication audit returns YES/NO classification", () => {
    clearPaidMemoryAuditRowCache();
    const modelId = MAIN_RP_MODEL_IDS[0]!;
    const dup = auditDuplicationOverlap({
      modelId,
      config: configById("PAID_CURRENT"),
      currentTurn: 1000,
      load: "PEAK_MEMORY",
    });
    assert.ok(["YES", "NO"].includes(dup.duplicatePromptBloat));
  });

  it("global maintenance simulation models incremental overflow", () => {
    const rows = simulateGlobalMaintenanceLifecycle(10_000);
    const t2000 = rows.find((r) => r.currentTurn === 2000);
    assert.ok(t2000);
    assert.ok(t2000!.rebuiltSourceChars > 10_000);
  });
});

describe("full audit report smoke", () => {
  it("generates report with zero provider calls", { timeout: 900_000 }, () => {
    clearPaidMemoryAuditRowCache();
    const report = generatePaidMemoryAuditReport("d593069fdaf476bfb6d547d675034925e8175e96", {
      originMainSha: "73d563496eb6183cbc8bfdf514882cdcacee8d9c",
    });
    assert.equal(report.providerGenerationCalls, 0);
    assert.equal(report.runtimeChange, "NO");
    assert.equal(report.competitorBenchmark, "NOT_PERFORMED_IN_THIS_AUDIT");
    assert.equal(report.matrix.length, MAIN_RP_MODEL_IDS.length * 4 * 4 * 2);
    assert.equal(report.absoluteMaxTable.length, MAIN_RP_MODEL_IDS.length);
    assert.ok(report.primaryDecisionTable.length > 0);
    assert.ok(report.turnPriceMatrix.length > 0);
    for (const modelId of MAIN_RP_MODEL_IDS) {
      assert.ok(report.summaryByModel[modelId]);
    }
  });
});
