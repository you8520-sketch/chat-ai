import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildMemoryPromptPackingAudit,
  renderMemoryPromptPackingAuditMarkdown,
} from "@/lib/memoryResearch/promptPackingAudit";

const audit = buildMemoryPromptPackingAudit(
  300,
  new Date("2026-09-29T00:00:00.000Z"),
  {
    rollingSummarySource: readFileSync(
      "src/lib/memory/memory-rolling-summary.ts",
      "utf8"
    ),
  }
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

  it("audits durable-state shadow ownership without calling semantic overlap waste", () => {
    assert.equal(audit.layerOverlap.sourcePolicyScan, "PROVIDED");
    assert.deepEqual(audit.layerOverlap.durableAutoFields, [
      "items",
      "itemsRemove",
      "promisesAdd",
      "promisesRemove",
    ]);

    const promises = audit.layerOverlap.shadowDomains.find(
      (row) => row.domain === "promises"
    );
    const items = audit.layerOverlap.shadowDomains.find(
      (row) => row.domain === "items"
    );
    assert.ok(promises);
    assert.deepEqual(promises.narrativeLayers, [
      "rolling_summary",
      "medium_term",
      "global_current_memory",
    ]);
    assert.equal(promises.canonicalCurrentStateOwner, "relationship_durable");
    assert.ok(promises.policyEvidence.every((row) => row.endsWith("=true")));

    assert.ok(items);
    assert.deepEqual(items.narrativeLayers, [
      "rolling_summary",
      "medium_term",
    ]);
    assert.equal(items.canonicalCurrentStateOwner, "relationship_durable");
    assert.ok(items.policyEvidence.every((row) => row.endsWith("=true")));

    assert.equal(audit.interpretation.literalDuplicateClaim, "FIXTURE_LITERAL_ONLY");
    assert.equal(audit.interpretation.semanticDuplicateClaim, "NOT_MEASURED");
    assert.equal(
      audit.interpretation.stateShadowClaim,
      "INTENTIONAL_TRAJECTORY_SHADOW"
    );
    assert.ok(
      audit.layerOverlap.literalFixture.every(
        (row) => row.mediumGlobalLiteralDuplicateChars === 0
      )
    );

    const md = renderMemoryPromptPackingAuditMarkdown(audit);
    assert.match(md, /Cross-layer state shadow audit/);
    assert.match(md, /semantic duplication verdict: \*\*NOT_MEASURED\*\*/);
    assert.match(md, /providerGenerationCalls: 0/);
    assert.match(md, /productionTouched: false/);
  });

  it("fails the durable-shadow contract if the canonical summary policy stops preserving current-state transitions", () => {
    const drifted = buildMemoryPromptPackingAudit(
      300,
      new Date("2026-09-29T00:00:00.000Z"),
      { rollingSummarySource: "summary policy without durable state contract" }
    );
    const invariant = drifted.invariants.find(
      (row) => row.id === "durable-shadow-owner-contract"
    );
    assert.equal(invariant?.ok, false);
  });
});
