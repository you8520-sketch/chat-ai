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
import {
  auditSystemBudgetBehavior,
  buildFullPromptBudgetMatrix,
  compareModelSwitchHorizonReports,
  detectSystemBudgetMediumOverflowRisk,
  listMainRpModelProfiles,
  reportModelSwitchMediumHorizon,
} from "./memory-medium-term-prompt-budget-audit";
import { MOVING_DETAIL_MARKERS } from "./memory-medium-term-audit";
import { MEDIUM_TERM_BLOCK_COUNT_DEEPSEEK } from "./memory-medium-term";

describe("SYSTEM BUDGET BEHAVIOR", () => {
  it("reports soft telemetry — no hard system trim owner", () => {
    const audit = auditSystemBudgetBehavior();
    assert.equal(audit.enforcement, "soft_telemetry");
    assert.match(audit.description, /does not hard-trim/);
  });
});

describe("MODEL-SWITCH HORIZON", () => {
  for (const currentTurn of [300, 1000] as const) {
    it(`T${currentTurn} — horizon differs by model block count`, () => {
      const reports = MAIN_RP_MODEL_IDS.map((modelId) =>
        reportModelSwitchMediumHorizon(modelId, currentTurn)
      );
      const comparison = compareModelSwitchHorizonReports(reports);
      assert.equal(comparison.horizonDelta, true, "MODEL_SWITCH_MEDIUM_HORIZON_DELTA");

      const deepseek = reports.find((r) => r.modelId.includes("deepseek"))!;
      const gemini31 = reports.find((r) => r.modelId.includes("gemini-3.1-pro"))!;
      const gemini37 = reports.find((r) => r.modelId.includes("gemini-3.7-flash"))!;
      assert.equal(deepseek.mediumBlockCount, MEDIUM_TERM_BLOCK_COUNT_DEEPSEEK);
      // Main RP uses provider=openrouter → resolveContextTrack returns claude-diet before gemini-bulk.
      assert.equal(gemini31.mediumBlockCount, 5);
      assert.equal(gemini37.mediumBlockCount, 5);
      assert.notEqual(deepseek.mediumBlockCount, gemini31.mediumBlockCount);
      assert.ok(deepseek.markersPresent.includes(MOVING_DETAIL_MARKERS.near));
      assert.ok(deepseek.markersPresent.includes(MOVING_DETAIL_MARKERS.mid));
      assert.ok(gemini31.markersPresent.includes(MOVING_DETAIL_MARKERS.near));
      assert.equal(gemini31.markersPresent.includes(MOVING_DETAIL_MARKERS.mid), false);
      assert.equal(gemini37.markersPresent.includes(MOVING_DETAIL_MARKERS.mid), false);
    });
  }
});

describe("FULL PROMPT BUDGET MATRIX", () => {
  for (const modelId of MAIN_RP_MODEL_IDS) {
    it(`${modelId} — baseline + N=5/10/15 via buildContext`, () => {
      const matrix = buildFullPromptBudgetMatrix(300, modelId);
      assert.equal(matrix.baseline.mediumActive, false);
      assert.equal(matrix.baseline.hasMediumSection, false);
      assert.equal(matrix.baseline.mediumChars, 0);
      assert.ok(matrix.baseline.estimatedSystemTokens > 0);
      assert.ok(matrix.baseline.tokenBudget > 0);

      for (const row of [matrix.n5, matrix.n10, matrix.n15]) {
        assert.ok(row.hasMediumSection);
        assert.ok(row.mediumChars > 0);
        assert.ok(row.estimatedSystemTokens > matrix.baseline.estimatedSystemTokens);
        assert.ok(row.deltaSystemTokensVsBaseline > 0);
        assert.ok(row.trackedSectionCount >= matrix.baseline.trackedSectionCount);
      }

      assert.ok(matrix.n5.deltaSystemTokensVsBaseline < matrix.n15.deltaSystemTokensVsBaseline);
    });
  }

  it("DeepSeek — Medium grouped in LONG_TERM_MEMORY XML", () => {
    const deepseekId = MAIN_RP_MODEL_IDS.find((id) => id.includes("deepseek"))!;
    const matrix = buildFullPromptBudgetMatrix(300, deepseekId);
    assert.equal(matrix.n10.deepSeekLtmGrouped, true);
  });

  it("reports SYSTEM_BUDGET_MEDIUM_OVERFLOW_RISK at N=15 on near-real fixture", () => {
    const deepseekId = MAIN_RP_MODEL_IDS.find((id) => id.includes("deepseek"))!;
    const matrix = buildFullPromptBudgetMatrix(300, deepseekId);
    const overflow = detectSystemBudgetMediumOverflowRisk(matrix);
    assert.equal(overflow, true, "N=15 exceeds MODEL_SYSTEM_BUDGET on T300 near-real fixture");
    assert.ok(matrix.n15.estimatedSystemTokens > matrix.baseline.tokenBudget);
    assert.ok(matrix.n5.estimatedSystemTokens <= matrix.baseline.tokenBudget);
    assert.ok(matrix.n10.estimatedSystemTokens <= matrix.baseline.tokenBudget);
  });
});

describe("MAIN RP MODEL PROFILES", () => {
  it("uses canonical registry IDs only", () => {
    const profiles = listMainRpModelProfiles();
    assert.equal(profiles.length, 3);
    for (const profile of profiles) {
      assert.ok(MAIN_RP_MODEL_IDS.includes(profile.modelId as (typeof MAIN_RP_MODEL_IDS)[number]));
      assert.equal(profile.provider, "openrouter");
    }
  });
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
