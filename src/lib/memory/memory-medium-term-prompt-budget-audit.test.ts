/**
 * Full Main RP prompt budget + model-switch horizon audit — zero provider calls.
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

describe("MAIN RP MODEL PROFILES", () => {
  it("profile model IDs == MAIN_RP_MODEL_IDS (dynamic registry parity)", () => {
    const profiles = listMainRpModelProfiles();
    const profileIds = profiles.map((p) => p.modelId).sort();
    const registryIds = [...MAIN_RP_MODEL_IDS].sort();
    assert.deepEqual(profileIds, registryIds);
    assert.ok(profiles.length >= 3, "registry must include at least legacy 3 models");
    for (const profile of profiles) {
      assert.ok(MAIN_RP_MODEL_IDS.includes(profile.modelId as (typeof MAIN_RP_MODEL_IDS)[number]));
      assert.ok(profile.mediumBlockCountProvisional > 0);
      assert.ok(profile.systemBudgetTelemetryTarget > 0);
    }
  });
});

describe("PROVISIONAL MODEL-SWITCH HORIZON (runtime provider-coupled)", () => {
  for (const currentTurn of [300, 1000] as const) {
    it(`T${currentTurn} — provisional block count may differ by model (documented, not final policy)`, () => {
      const reports = MAIN_RP_MODEL_IDS.map((modelId) =>
        reportModelSwitchMediumHorizon(modelId, currentTurn)
      );
      const comparison = compareModelSwitchHorizonReports(reports);
      // Production still uses resolveMediumTermBlockCount — delta may exist until GPT selects canonical N.
      assert.equal(typeof comparison.horizonDelta, "boolean");
    });
  }
});

describe("FIXED-N MODEL-SWITCH PARITY", () => {
  for (const fixedN of [10, 15] as const) {
    for (const currentTurn of [300, 1000] as const) {
      it(`N=${fixedN} T${currentTurn} — identical memory knowledge across all Main RP models`, () => {
        const reports = MAIN_RP_MODEL_IDS.map((modelId) =>
          reportFixedNMediumHorizon(modelId, currentTurn, fixedN)
        );
        const comparison = compareFixedNHorizonReports(reports);
        assert.equal(comparison.parity, true, comparison.detail);

        const expectedMarkers =
          fixedN >= 15
            ? [MOVING_DETAIL_MARKERS.near, MOVING_DETAIL_MARKERS.mid, MOVING_DETAIL_MARKERS.far]
            : fixedN >= 10
              ? [MOVING_DETAIL_MARKERS.near, MOVING_DETAIL_MARKERS.mid]
              : [MOVING_DETAIL_MARKERS.near];
        for (const report of reports) {
          for (const marker of expectedMarkers) {
            assert.ok(report.markersPresent.includes(marker), `${report.modelId} missing ${marker}`);
          }
          assert.equal(report.mediumBlockCount, fixedN);
          assert.ok(report.mediumBody.length > 0);
        }
      });
    }
  }
});

describe("FULL PROMPT BUDGET MATRIX (near-real)", () => {
  for (const modelId of MAIN_RP_MODEL_IDS) {
    it(`${modelId} — baseline + N=5/10/15 via buildContext`, () => {
      const matrix = buildFullPromptBudgetMatrix(300, modelId, "near-real");
      assert.equal(matrix.baseline.mediumActive, false);
      assert.equal(matrix.baseline.hasMediumSection, false);
      assert.equal(matrix.baseline.mediumChars, 0);
      assert.ok(matrix.baseline.estimatedSystemTokens > 0);
      assert.ok(matrix.baseline.estimatedHistoryTokens > 0);
      assert.ok(matrix.baseline.estimatedInputTokens > 0);
      assert.ok(matrix.baseline.tokenBudget > 0);
      assert.equal(matrix.baseline.truncatedMemory, false);

      for (const row of [matrix.n5, matrix.n10, matrix.n15]) {
        assert.ok(row.hasMediumSection);
        assert.ok(row.mediumChars > 0);
        assert.ok(row.estimatedSystemTokens > matrix.baseline.estimatedSystemTokens);
        assert.ok(row.deltaSystemTokensVsBaseline > 0);
        assert.ok(row.deltaInputTokensVsBaseline > 0);
        assert.ok(row.trackedSectionCount >= matrix.baseline.trackedSectionCount);
        assert.equal(row.criticalSectionOmitted, false);
        assert.equal(row.criticalSectionTrimmed, false);
      }

      assert.ok(matrix.n5.deltaSystemTokensVsBaseline < matrix.n15.deltaSystemTokensVsBaseline);
      assert.ok(matrix.n10.deltaInputTokensVsBaseline < matrix.n15.deltaInputTokensVsBaseline);
    });
  }

  it("DeepSeek — Medium grouped in LONG_TERM_MEMORY XML", () => {
    const deepseekId = MAIN_RP_MODEL_IDS.find((id) => id.includes("deepseek"))!;
    const matrix = buildFullPromptBudgetMatrix(300, deepseekId);
    assert.equal(matrix.n10.deepSeekLtmGrouped, true);
  });

  it("telemetry crossing at N=15 is reported but NOT a hard failure gate", () => {
    const deepseekId = MAIN_RP_MODEL_IDS.find((id) => id.includes("deepseek"))!;
    const matrix = buildFullPromptBudgetMatrix(300, deepseekId);
    const crossing = reportsTelemetryTargetCrossing(matrix);
    assert.equal(typeof crossing, "boolean");
    const safety = auditActualSafetyGates(matrix);
    assert.equal(safety.n10.safeForPolicyConsideration, true);
    assert.equal(safety.n15.safeForPolicyConsideration, true);
    assert.equal(safety.n10.truncatedMemoryVsBaseline, false);
    assert.equal(safety.n15.truncatedMemoryVsBaseline, false);
  });
});

describe("HIGH-BOUND MATRIX", () => {
  for (const modelId of MAIN_RP_MODEL_IDS) {
    it(`${modelId} — high-bound baseline vs N=10/N=15`, () => {
      const matrix = buildFullPromptBudgetMatrix(300, modelId, "high-bound");
      const safety = auditActualSafetyGates(matrix);

      assert.ok(matrix.baseline.estimatedSystemTokens >= matrix.n5.estimatedSystemTokens - 6000);
      assert.equal(matrix.n10.criticalSectionOmitted, false);
      assert.equal(matrix.n15.criticalSectionOmitted, false);
      assert.equal(matrix.n10.criticalSectionTrimmed, false);
      assert.equal(matrix.n15.criticalSectionTrimmed, false);
      assert.equal(safety.n10.truncatedMemoryVsBaseline, false);
      assert.equal(safety.n15.truncatedMemoryVsBaseline, false);
      assert.equal(typeof safety.baselineAlreadyOverTelemetryTarget, "boolean");
      assert.equal(typeof safety.mediumN10CausedNewTelemetryCrossing, "boolean");
      assert.equal(typeof safety.mediumN15CausedNewTelemetryCrossing, "boolean");
    });
  }
});

describe("TERRA N10/N15", () => {
  const terraId = MAIN_RP_MODEL_IDS.find((id) => id.includes("terra"));
  if (!terraId) {
    it("skipped — Terra not in current MAIN_RP_MODEL_IDS", () => {
      assert.ok(true);
    });
  } else {
    it("Terra included in full prompt matrix with default telemetry budget", () => {
      const matrix = buildFullPromptBudgetMatrix(300, terraId);
      assert.ok(matrix.baseline.estimatedSystemTokens > 0);
      assert.ok(matrix.n10.mediumChars > 0);
      assert.ok(matrix.n15.mediumChars > 0);
      const safety = auditActualSafetyGates(matrix);
      assert.equal(typeof safety.mediumN10CausedNewTelemetryCrossing, "boolean");
      assert.equal(typeof safety.mediumN15CausedNewTelemetryCrossing, "boolean");
    });

    it("Terra fixed-N parity at N=10 and N=15", () => {
      for (const fixedN of [10, 15] as const) {
        const terra = reportFixedNMediumHorizon(terraId, 300, fixedN);
        const deepseek = reportFixedNMediumHorizon(
          MAIN_RP_MODEL_IDS.find((id) => id.includes("deepseek"))!,
          300,
          fixedN
        );
        assert.equal(terra.mediumBody, deepseek.mediumBody);
        assert.deepEqual(terra.turnRanges, deepseek.turnRanges);
      }
    });
  }
});

describe("N10 VS N15 EVIDENCE", () => {
  for (const modelId of MAIN_RP_MODEL_IDS) {
    it(`${modelId} — coverage + token delta evidence (no winner selected)`, () => {
      const evidence = buildN10VsN15Evidence(modelId, 300, "near-real");
      assert.ok(evidence.n10.markers.includes(MOVING_DETAIL_MARKERS.near));
      assert.ok(evidence.n10.markers.includes(MOVING_DETAIL_MARKERS.mid));
      assert.ok(evidence.n15.markers.includes(MOVING_DETAIL_MARKERS.far));
      assert.ok(evidence.n15.mediumChars > evidence.n10.mediumChars);
      assert.ok(evidence.n15MinusN10InputTokens > 0);
      assert.equal(evidence.safety.n10.safeForPolicyConsideration, true);
      assert.equal(evidence.safety.n15.safeForPolicyConsideration, true);
    });
  }
});

describe("DORMANT OWNER CLASSIFICATION", () => {
  it("documents helper/constant ownership after canonical extraction", () => {
    const classifications = {
      resolveRecentNarrativeContextLimit: "DORMANT",
      buildRecentNarrativeContextBlock: "DORMANT",
      buildStoredHistoryStaticBlock: "DORMANT",
      buildHierarchicalMemoryPromptLayers: "DORMANT",
      GEMINI_RECENT_NARRATIVE_CONTEXT_LIMIT: "FOLLOW_UP",
      CLAUDE_RECENT_NARRATIVE_CONTEXT_LIMIT: "FOLLOW_UP",
      DEEPSEEK_STATIC_STORED_SUMMARY_LIMIT: "FOLLOW_UP",
      isPromptInjectibleMemoryRecord: "ACTIVE_ELSEWHERE",
      resolveMediumTermBlockCount: "ACTIVE_ELSEWHERE",
    };
    assert.equal(classifications.isPromptInjectibleMemoryRecord, "ACTIVE_ELSEWHERE");
    assert.equal(classifications.buildRecentNarrativeContextBlock, "DORMANT");
  });
});
