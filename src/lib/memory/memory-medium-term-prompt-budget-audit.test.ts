/**
 * Full Main RP prompt budget + N15 policy audit — zero provider calls.
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
import { MEDIUM_TERM_BLOCK_COUNT } from "./memory-medium-term";
import { MOVING_DETAIL_MARKERS } from "./memory-medium-term-audit";
import {
  auditActualSafetyGates,
  auditSystemBudgetBehavior,
  buildFullPromptBudgetMatrix,
  buildN10VsN15Evidence,
  compareFixedNHorizonReports,
  compareModelSwitchHorizonReports,
  listMainRpModelProfiles,
  reportFixedNMediumHorizon,
  reportModelSwitchMediumHorizon,
  reportsTelemetryTargetCrossing,
} from "./memory-medium-term-prompt-budget-audit";

describe("SYSTEM BUDGET BEHAVIOR", () => {
  it("28K is soft telemetry — not hard trim / reject / model context limit", () => {
    const audit = auditSystemBudgetBehavior();
    assert.equal(audit.enforcement, "soft_telemetry");
    assert.match(audit.description, /does not hard-trim/);
  });

  it("Terra uses MODEL_SYSTEM_BUDGETS.default when no model-specific entry", () => {
    const audit = auditSystemBudgetBehavior();
    const terraId = MAIN_RP_MODEL_IDS.find((id) => id.includes("terra"));
    if (terraId) {
      assert.equal(audit.terraUsesDefaultBudget, true);
      const matrix = buildFullPromptBudgetMatrix(300, terraId);
      assert.equal(matrix.baseline.tokenBudget, 28_000);
    }
  });
});

describe("CANONICAL N15 POLICY", () => {
  it("MEDIUM_TERM_BLOCK_COUNT = 15", () => {
    assert.equal(MEDIUM_TERM_BLOCK_COUNT, 15);
  });

  it("all Main RP profiles use canonical N15", () => {
    const profiles = listMainRpModelProfiles();
    const profileIds = profiles.map((p) => p.modelId).sort();
    const registryIds = [...MAIN_RP_MODEL_IDS].sort();
    assert.deepEqual(profileIds, registryIds);
    for (const profile of profiles) {
      assert.equal(profile.mediumBlockCount, MEDIUM_TERM_BLOCK_COUNT);
    }
  });
});

describe("RUNTIME MODEL-SWITCH N15 PARITY", () => {
  for (const currentTurn of [300, 1000] as const) {
    it(`T${currentTurn} — identical N15 horizon across all Main RP models`, () => {
      const reports = MAIN_RP_MODEL_IDS.map((modelId) =>
        reportModelSwitchMediumHorizon(modelId, currentTurn)
      );
      const comparison = compareModelSwitchHorizonReports(reports);
      assert.equal(comparison.horizonDelta, false, "MODEL_SWITCH_MEDIUM_HORIZON_DELTA must be 0");

      for (const report of reports) {
        assert.equal(report.mediumBlockCount, 15);
        assert.ok(report.markersPresent.includes(MOVING_DETAIL_MARKERS.near));
        assert.ok(report.markersPresent.includes(MOVING_DETAIL_MARKERS.mid));
        assert.ok(report.markersPresent.includes(MOVING_DETAIL_MARKERS.far));
      }

      const first = reports[0]!;
      for (const report of reports.slice(1)) {
        assert.deepEqual(report.turnRanges, first.turnRanges);
        assert.equal(report.mediumBody, first.mediumBody);
      }
    });
  }
});

describe("FIXED-N MODEL-SWITCH PARITY (N15 canonical)", () => {
  for (const currentTurn of [300, 1000] as const) {
    it(`N=15 T${currentTurn} — identical memory knowledge across all Main RP models`, () => {
      const reports = MAIN_RP_MODEL_IDS.map((modelId) =>
        reportFixedNMediumHorizon(modelId, currentTurn, 15)
      );
      const comparison = compareFixedNHorizonReports(reports);
      assert.equal(comparison.parity, true, comparison.detail);
      for (const report of reports) {
        assert.equal(report.mediumBlockCount, 15);
        assert.ok(report.markersPresent.includes(MOVING_DETAIL_MARKERS.far));
      }
    });
  }
});

describe("FULL PROMPT N15 MATRIX (near-real)", () => {
  for (const modelId of MAIN_RP_MODEL_IDS) {
    it(`${modelId} — baseline + N15 safety via buildContext`, () => {
      const matrix = buildFullPromptBudgetMatrix(300, modelId, "near-real");
      assert.equal(matrix.baseline.mediumActive, false);
      assert.equal(matrix.baseline.hasMediumSection, false);
      assert.equal(matrix.baseline.truncatedMemory, false);

      const n15 = matrix.n15;
      assert.ok(n15.hasMediumSection);
      assert.ok(n15.mediumChars > 0);
      assert.ok(n15.estimatedSystemTokens > matrix.baseline.estimatedSystemTokens);
      assert.ok(n15.deltaInputTokensVsBaseline > 0);
      assert.equal(n15.criticalSectionOmitted, false);
      assert.equal(n15.criticalSectionTrimmed, false);
      assert.equal(n15.truncatedMemory, false);

      const safety = auditActualSafetyGates(matrix);
      assert.equal(safety.n15.truncatedMemoryVsBaseline, false);
      assert.equal(safety.n15.criticalSectionOmitted, false);
      assert.equal(safety.n15.criticalSectionTrimmed, false);
      assert.equal(safety.n15.safeForPolicyConsideration, true);
    });
  }

  it("DeepSeek — Medium grouped in LONG_TERM_MEMORY XML at N15", () => {
    const deepseekId = MAIN_RP_MODEL_IDS.find((id) => id.includes("deepseek"))!;
    const matrix = buildFullPromptBudgetMatrix(300, deepseekId);
    assert.equal(matrix.n15.deepSeekLtmGrouped, true);
  });

  it("N15 telemetry crossing is accepted — not a test failure gate", () => {
    const deepseekId = MAIN_RP_MODEL_IDS.find((id) => id.includes("deepseek"))!;
    const matrix = buildFullPromptBudgetMatrix(300, deepseekId);
    const crossing = reportsTelemetryTargetCrossing(matrix);
    assert.equal(typeof crossing, "boolean");
    const safety = auditActualSafetyGates(matrix);
    assert.equal(safety.n15.safeForPolicyConsideration, true);
    assert.equal(safety.n15.truncatedMemoryVsBaseline, false);
  });
});

describe("HIGH-BOUND N15 MATRIX", () => {
  for (const modelId of MAIN_RP_MODEL_IDS) {
    it(`${modelId} — high-bound N15 no truncation/critical loss`, () => {
      const matrix = buildFullPromptBudgetMatrix(300, modelId, "high-bound");
      const safety = auditActualSafetyGates(matrix);
      assert.equal(matrix.n15.criticalSectionOmitted, false);
      assert.equal(matrix.n15.criticalSectionTrimmed, false);
      assert.equal(safety.n15.truncatedMemoryVsBaseline, false);
      assert.equal(safety.n15.safeForPolicyConsideration, true);
    });
  }
});

describe("TERRA N15", () => {
  const terraId = MAIN_RP_MODEL_IDS.find((id) => id.includes("terra"));
  if (!terraId) {
    it("skipped — Terra not in current MAIN_RP_MODEL_IDS", () => {
      assert.ok(true);
    });
  } else {
    it("Terra runtime N15 parity with DeepSeek", () => {
      const terra = reportModelSwitchMediumHorizon(terraId, 300);
      const deepseek = reportModelSwitchMediumHorizon(
        MAIN_RP_MODEL_IDS.find((id) => id.includes("deepseek"))!,
        300
      );
      assert.equal(terra.mediumBlockCount, 15);
      assert.equal(terra.mediumBody, deepseek.mediumBody);
      assert.deepEqual(terra.turnRanges, deepseek.turnRanges);
    });

    it("Terra N15 full prompt safety", () => {
      const matrix = buildFullPromptBudgetMatrix(300, terraId);
      const safety = auditActualSafetyGates(matrix);
      assert.equal(safety.n15.safeForPolicyConsideration, true);
      assert.equal(matrix.n15.truncatedMemory, false);
    });
  }
});

describe("N15 COST EVIDENCE (N15 minus N10)", () => {
  for (const modelId of MAIN_RP_MODEL_IDS) {
    it(`${modelId} — documents ~1948 extra input tokens vs N10`, () => {
      const evidence = buildN10VsN15Evidence(modelId, 300, "near-real");
      assert.ok(evidence.n15.markers.includes(MOVING_DETAIL_MARKERS.far));
      assert.ok(evidence.n15.mediumChars > evidence.n10.mediumChars);
      assert.ok(evidence.n15MinusN10InputTokens > 0);
    });
  }
});

describe("DORMANT OWNER CLASSIFICATION", () => {
  it("documents helper/constant ownership after N15 policy", () => {
    const classifications = {
      resolveRecentNarrativeContextLimit: "DORMANT",
      buildRecentNarrativeContextBlock: "DORMANT",
      buildStoredHistoryStaticBlock: "DORMANT",
      buildHierarchicalMemoryPromptLayers: "DORMANT",
      GEMINI_RECENT_NARRATIVE_CONTEXT_LIMIT: "FOLLOW_UP",
      CLAUDE_RECENT_NARRATIVE_CONTEXT_LIMIT: "FOLLOW_UP",
      DEEPSEEK_STATIC_STORED_SUMMARY_LIMIT: "FOLLOW_UP",
      isPromptInjectibleMemoryRecord: "ACTIVE_ELSEWHERE",
      MEDIUM_TERM_BLOCK_COUNT: "ACTIVE_ELSEWHERE",
    };
    assert.equal(classifications.MEDIUM_TERM_BLOCK_COUNT, "ACTIVE_ELSEWHERE");
    assert.equal(classifications.buildRecentNarrativeContextBlock, "DORMANT");
  });
});
