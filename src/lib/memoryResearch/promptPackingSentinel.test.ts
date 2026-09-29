import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPromptPackingSentinelReport,
  renderPromptPackingSentinelMarkdown,
} from "@/lib/memoryResearch/promptPackingSentinel";

describe("Memory Quality / Token Sentinel", () => {
  it("reports the canonical summary5_raw4 + Medium N15 policy", () => {
    const report = buildPromptPackingSentinelReport();
    assert.equal(report.policy.summaryIntervalTurns, 5);
    assert.equal(report.policy.rawCompleteExchanges, 4);
    assert.equal(report.policy.mediumBlockCount, 15);
    assert.equal(report.providerGenerationCalls, 0);
    assert.equal(report.productionTouched, false);
  });

  it("keeps current Main RP N15 packing free of truncation/critical loss", () => {
    const report = buildPromptPackingSentinelReport();
    assert.ok(report.modelEvidence.length > 0);
    for (const row of report.modelEvidence) {
      assert.equal(row.n15TruncatedMemory, false, row.modelId);
      assert.equal(row.criticalSectionOmitted, false, row.modelId);
      assert.equal(row.criticalSectionTrimmed, false, row.modelId);
      assert.equal(row.safeForPolicyConsideration, true, row.modelId);
      assert.ok(row.n15DeltaInputTokens > 0, row.modelId);
    }
    assert.ok(
      !report.findings.includes("PROMPT_TRUNCATION_OR_CRITICAL_LOSS")
    );
  });

  it("detects no literal Medium↔Global duplication in the canonical audit fixtures", () => {
    const report = buildPromptPackingSentinelReport();
    assert.ok(report.overlapEvidence.length > 0);
    for (const row of report.overlapEvidence) {
      assert.equal(row.mediumGlobalLiteralDuplicateChars, 0);
    }
    assert.ok(
      !report.findings.includes("MEDIUM_GLOBAL_LITERAL_DUPLICATION")
    );
  });

  it("surfaces default-policy episodic starvation when higher-priority dynamic memory consumes the 2500-char budget", () => {
    const report = buildPromptPackingSentinelReport();
    const empty = report.episodicBudgetEvidence.find(
      (row) => row.higherPriorityChars === 0
    );
    const at2400 = report.episodicBudgetEvidence.find(
      (row) => row.higherPriorityChars === 2400
    );
    const at2500 = report.episodicBudgetEvidence.find(
      (row) => row.higherPriorityChars === 2500
    );
    const at3000 = report.episodicBudgetEvidence.find(
      (row) => row.higherPriorityChars === 3000
    );
    assert.ok((empty?.injectedFacts ?? 0) > 0);
    assert.ok((at2400?.injectedFacts ?? 0) > 0);
    assert.equal(at2500?.injectedFacts, 0);
    assert.equal(at3000?.injectedFacts, 0);
    assert.ok(
      report.findings.includes("EPISODIC_DYNAMIC_BUDGET_STARVATION")
    );
  });

  it("renders scheduled evidence without claiming a runtime fix", () => {
    const markdown = renderPromptPackingSentinelMarkdown(
      buildPromptPackingSentinelReport()
    );
    assert.match(markdown, /Memory Quality \/ Token Sentinel/);
    assert.match(markdown, /EPISODIC_DYNAMIC_BUDGET_STARVATION/);
    assert.match(markdown, /provider generation calls: 0/);
    assert.match(markdown, /production touched: false/);
    assert.match(markdown, /evidence-only/);
  });
});
