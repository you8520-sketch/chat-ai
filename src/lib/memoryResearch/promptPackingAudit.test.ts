import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMemoryPromptPackingAudit,
  renderMemoryPromptPackingAuditMarkdown,
} from "@/lib/memoryResearch/promptPackingAudit";

const audit = buildMemoryPromptPackingAudit(
  300,
  new Date("2026-09-29T00:00:00.000Z")
);

describe("memory prompt-packing sentinel", () => {
  it("locks the current summary5/raw4 owner split without enabling duplicate Medium on exact Global", () => {
    assert.equal(audit.architecture.policyId, "summary5_raw4");
    assert.equal(audit.architecture.rollingSummaryInterval, 5);
    assert.equal(audit.architecture.rawRecentExchanges, 4);
    assert.equal(audit.architecture.mediumTermBlockCount, 15);
    assert.equal(audit.architecture.exactProjectionInjectsMedium, false);
    assert.equal(audit.architecture.compactProjectionInjectsMedium, true);
    assert.equal(audit.architecture.failureFallbackInjectsMedium, false);
    assert.equal(audit.architecture.storedFallbackInjectsMedium, false);
    assert.equal(audit.architecture.manualGlobalInjectsMedium, false);
    assert.ok(audit.invariants.every((i) => i.ok), JSON.stringify(audit.invariants));
  });

  it("records N15 token pressure for every active Main RP model without provider calls", () => {
    assert.ok(audit.models.length > 0);
    for (const model of audit.models) {
      assert.ok(model.n15DeltaInputTokens > 0, model.modelId);
      assert.ok(model.n15MediumTokens > 0, model.modelId);
      assert.equal(model.n15TruncatedMemory, false, model.modelId);
      assert.equal(model.n15CriticalSectionOmitted, false, model.modelId);
      assert.equal(model.n15CriticalSectionTrimmed, false, model.modelId);
      assert.equal(model.n15SafeForPolicyConsideration, true, model.modelId);
    }
  });


  it("surfaces the current default episodic dynamic-budget starvation condition without failing production invariants", () => {
    const probe = audit.episodicDynamicBudget;
    assert.ok(probe.dynamicMemoryTotalMaxChars > 0);
    const baseline = probe.rows.find((row) => row.higherPriorityChars === 0);
    const belowCap = probe.rows
      .filter((row) => row.higherPriorityChars < probe.dynamicMemoryTotalMaxChars)
      .at(-1);
    const atCap = probe.rows.find(
      (row) => row.higherPriorityChars === probe.dynamicMemoryTotalMaxChars
    );
    assert.ok((baseline?.injectedFacts ?? 0) > 0);
    assert.ok((belowCap?.injectedFacts ?? 0) > 0);
    assert.equal(atCap?.injectedFacts, 0);
    assert.equal(probe.starvationDetected, true);
    assert.ok(audit.invariants.every((i) => i.ok), JSON.stringify(audit.invariants));
  });

  it("does not mislabel semantic overlap as measured duplicate waste", () => {
    assert.equal(audit.interpretation.literalDuplicateClaim, "NOT_MEASURED");
    const md = renderMemoryPromptPackingAuditMarkdown(audit);
    assert.match(md, /providerGenerationCalls: 0/);
    assert.match(md, /productionTouched: false/);
  });
});
