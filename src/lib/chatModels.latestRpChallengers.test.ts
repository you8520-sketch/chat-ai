import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  DEFAULT_SELECTED_AI,
  OPENROUTER_AION_30_MODEL,
  OPENROUTER_GLM_52_MODEL,
  OPENROUTER_MINIMAX_M3_MODEL,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isLatestRpChallengerDiagnosticSelectable,
  isUserApiSelectableAI,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";
import { resolveOpenRouterModelId } from "@/lib/openRouterConfig";
import {
  isAion30OpenRouterModel,
  isMinimaxM3OpenRouterModel,
  isOpenRouterRpReasoningDisabledModel,
  OPENROUTER_RP_REASONING_AION_30,
  OPENROUTER_RP_REASONING_OFF,
} from "@/lib/openRouterClient";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";

const CHALLENGERS = [
  OPENROUTER_AION_30_MODEL,
  OPENROUTER_MINIMAX_M3_MODEL,
  OPENROUTER_GLM_52_MODEL,
] as const;

describe("latest OpenRouter RP challengers diagnostic registry", () => {
  it("registers all three models but keeps them out of the public picker", () => {
    assert.equal(DEFAULT_SELECTED_AI, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    for (const id of CHALLENGERS) {
      assert.ok(SELECTED_AI_OPTIONS.some((o) => o.id === id), id);
      assert.ok(!USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === id), id);
      assert.equal(isValidSelectedAI(id), true);
    }
    assert.equal(selectedAILabel(OPENROUTER_AION_30_MODEL), "Aion 3.0");
    assert.equal(selectedAILabel(OPENROUTER_MINIMAX_M3_MODEL), "MiniMax M3");
    assert.equal(selectedAILabel(OPENROUTER_GLM_52_MODEL), "GLM 5.2");
  });

  it("normalizes challenger selection to default without diagnostic env", () => {
    const prev = process.env.LATEST_RP_CHALLENGER_DIAGNOSTIC_SELECTABLE;
    try {
      delete process.env.LATEST_RP_CHALLENGER_DIAGNOSTIC_SELECTABLE;
      assert.equal(isLatestRpChallengerDiagnosticSelectable(), false);
      for (const id of CHALLENGERS) {
        assert.equal(resolveSelectedAI(id), DEFAULT_SELECTED_AI);
        assert.equal(isUserApiSelectableAI(id), false);
      }
    } finally {
      if (prev === undefined) delete process.env.LATEST_RP_CHALLENGER_DIAGNOSTIC_SELECTABLE;
      else process.env.LATEST_RP_CHALLENGER_DIAGNOSTIC_SELECTABLE = prev;
    }
  });

  it("allows challenger API selection when diagnostic env is set", () => {
    const prev = process.env.LATEST_RP_CHALLENGER_DIAGNOSTIC_SELECTABLE;
    try {
      process.env.LATEST_RP_CHALLENGER_DIAGNOSTIC_SELECTABLE = "1";
      for (const id of CHALLENGERS) {
        assert.equal(resolveSelectedAI(id), id);
        assert.equal(isUserApiSelectableAI(id), true);
        assert.equal(resolveOpenRouterModelId(id), id);
      }
    } finally {
      if (prev === undefined) delete process.env.LATEST_RP_CHALLENGER_DIAGNOSTIC_SELECTABLE;
      else process.env.LATEST_RP_CHALLENGER_DIAGNOSTIC_SELECTABLE = prev;
    }
  });

  it("keeps receipt rates for challengers", () => {
    assert.equal(resolveOpenRouterModelRates(OPENROUTER_AION_30_MODEL).inputUsdPerM, 3);
    assert.equal(resolveOpenRouterModelRates(OPENROUTER_MINIMAX_M3_MODEL).outputUsdPerM, 1.2);
    assert.ok(resolveOpenRouterModelRates(OPENROUTER_GLM_52_MODEL).inputUsdPerM > 0);
  });

  it("applies reasoning policy detectors", () => {
    assert.equal(isAion30OpenRouterModel(OPENROUTER_AION_30_MODEL), true);
    assert.equal(isMinimaxM3OpenRouterModel(OPENROUTER_MINIMAX_M3_MODEL), true);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_MINIMAX_M3_MODEL), true);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_GLM_52_MODEL), true);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_AION_30_MODEL), false);
    assert.equal(OPENROUTER_RP_REASONING_AION_30.effort, "minimal");
    assert.equal(OPENROUTER_RP_REASONING_OFF.effort, "none");
  });
});
