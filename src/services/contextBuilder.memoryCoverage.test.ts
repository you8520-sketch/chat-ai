import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  GEMINI_CHAT_FLASH_25,
  OPENROUTER_QWEN_37_MAX_MODEL,
} from "@/lib/chatModels";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { HISTORY_TOKEN_BUDGET } from "@/lib/contextTrack";
import { estimateTokens } from "@/lib/tokenEstimate";
import {
  countPlayableHistoryTurns,
  rawRecentTurnsToHistory,
  resolveMemoryCoverageTurnFloor,
  selectLongerHistorySuffix,
  trimHistoryToBudget,
  type DialogueTurn,
} from "@/lib/hybridMemory";
import { buildContext } from "@/services/contextBuilder";
import type { ChatMsg } from "@/lib/ai";

function makeTurns(count: number, assistantChars = 400): DialogueTurn[] {
  return Array.from({ length: count }, (_, index) => ({
    user: `user-${index + 1}:${"가".repeat(200)}`,
    assistant: `assistant-${index + 1}:${"나".repeat(assistantChars)}`,
  }));
}

function buildCoverageContext(opts: {
  provider: "gemini" | "openrouter" | "cheaperinference";
  modelId: string;
  history: ChatMsg[];
  completedTurns: number;
  completedTurnsForMemoryCoverage?: number;
  summarizedTurnCount: number;
  floor: number;
  preserveAdultHandoffRawHistory?: boolean;
  adultHandoffRequiredTurnFloor?: number;
  suppressMemoryCoverageDegradedLog?: boolean;
}) {
  return buildContext({
    charName: "테스트",
    chunks: [],
    userNickname: "사용자",
    shortTermHistory: opts.history,
    currentUserMessage: "현재 입력",
    nsfw: false,
    provider: opts.provider,
    modelId: opts.modelId,
    completedTurns: opts.completedTurns,
    completedTurnsForMemoryCoverage: opts.completedTurnsForMemoryCoverage,
    summarizedTurnCount: opts.summarizedTurnCount,
    historyMinTurnFloor: opts.floor,
    preserveAdultHandoffRawHistory: opts.preserveAdultHandoffRawHistory,
    adultHandoffRequiredTurnFloor: opts.adultHandoffRequiredTurnFloor,
    suppressMemoryCoverageDegradedLog: opts.suppressMemoryCoverageDegradedLog,
  });
}

describe("contextBuilder memory coverage", () => {
  const providers = [
    { label: "Gemini/general", provider: "gemini" as const, modelId: GEMINI_CHAT_FLASH_25 },
    { label: "OpenRouter", provider: "openrouter" as const, modelId: OPENROUTER_QWEN_37_MAX_MODEL },
    {
      label: "CheaperInference DeepSeek",
      provider: "cheaperinference" as const,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    },
  ];

  for (const fixture of providers) {
    it(`${fixture.label} uses the route-resolved floor during payload re-trim`, () => {
      const completedTurns = 20;
      const summarizedTurnCount = 6;
      const floor = resolveMemoryCoverageTurnFloor({ completedTurns, summarizedTurnCount });
      const initialHistory = trimHistoryToBudget(
        rawRecentTurnsToHistory(makeTurns(completedTurns)),
        HISTORY_TOKEN_BUDGET,
        floor
      );
      const built = buildCoverageContext({
        ...fixture,
        history: initialHistory,
        completedTurns,
        summarizedTurnCount,
        floor,
      });
      const priorHistory = built.history.slice(0, -1);

      assert.equal(built.meta.memoryCoverage?.requestedFloor, 14);
      assert.equal(built.meta.memoryCoverage?.effectiveFloor, 14);
      assert.equal(built.meta.memoryCoverage?.gapTurns, 0);
      assert.equal(built.meta.memoryCoverage?.degraded, false);
      assert.ok(countPlayableHistoryTurns(priorHistory) >= 14);
      assert.equal(priorHistory.length % 2, 0, "history must keep complete pairs");
      assert.deepEqual(priorHistory, initialHistory);
      assert.match(priorHistory.at(-1)?.content ?? "", /assistant-20/);
    });
  }

  it("keeps requested/effective floor at four when memory is disabled upstream", () => {
    const completedTurns = 20;
    const full = rawRecentTurnsToHistory(makeTurns(completedTurns));
    const mainHistory = trimHistoryToBudget(full, HISTORY_TOKEN_BUDGET, 4);
    const built = buildCoverageContext({
      provider: "openrouter",
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      history: mainHistory,
      completedTurns,
      summarizedTurnCount: 0,
      floor: 4,
    });

    assert.equal(built.meta.memoryCoverage?.requestedFloor, 4);
    assert.equal(built.meta.memoryCoverage?.effectiveFloor, 4);
    assert.equal(built.meta.memoryCoverage?.degraded, false);
    const builtPriorHistory = built.history.slice(0, -1);
    assert.ok(builtPriorHistory.length <= mainHistory.length);
    assert.deepEqual(selectLongerHistorySuffix(builtPriorHistory, mainHistory), mainHistory);
  });

  it("uses one eligible turn instead of 101 global turns immediately after reset", () => {
    const built = buildCoverageContext({
      provider: "openrouter",
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      history: rawRecentTurnsToHistory(makeTurns(4, 200)),
      completedTurns: 101,
      completedTurnsForMemoryCoverage: 1,
      summarizedTurnCount: 0,
      floor: 4,
    });

    assert.equal(built.meta.memoryCoverage?.requestedFloor, 4);
    assert.equal(built.meta.memoryCoverage?.firstRawPlayableTurn, 1);
    assert.equal(built.meta.memoryCoverage?.gapTurns, 0);
    assert.equal(built.meta.memoryCoverage?.degraded, false);
  });

  it("preserves the larger adult handoff/coverage suffix without a second trim", () => {
    const completedTurns = 20;
    const summarizedTurnCount = 6;
    const floor = resolveMemoryCoverageTurnFloor({ completedTurns, summarizedTurnCount });
    const full = rawRecentTurnsToHistory(makeTurns(completedTurns));
    const existingHandoff = full.slice(-12);
    const coverageRequired = trimHistoryToBudget(full, HISTORY_TOKEN_BUDGET, floor);
    const selected = selectLongerHistorySuffix(existingHandoff, coverageRequired);
    const built = buildCoverageContext({
      provider: "cheaperinference",
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      history: selected,
      completedTurns,
      summarizedTurnCount,
      floor,
      preserveAdultHandoffRawHistory: true,
      adultHandoffRequiredTurnFloor: 6,
    });
    const priorHistory = built.history.slice(0, -1);

    assert.equal(selected, coverageRequired);
    assert.equal(priorHistory.length, selected.length);
    assert.equal(built.meta.memoryCoverage?.degraded, false);
    assert.equal(built.meta.memoryCoverage?.adultRequiredFloor, 6);
    assert.equal(built.meta.memoryCoverage?.gapTurns, 0);
    assert.equal(priorHistory.length % 2, 0);
  });

  it("does not count the opening greeting as a playable coverage turn", () => {
    const completedTurns = 7;
    const summarizedTurnCount = 0;
    const floor = resolveMemoryCoverageTurnFloor({ completedTurns, summarizedTurnCount });
    const turns = [
      { user: OPENING_TURN_USER, assistant: "이미 발생한 오프닝 장면" },
      ...makeTurns(completedTurns),
    ];
    const initialHistory = trimHistoryToBudget(
      rawRecentTurnsToHistory(turns),
      HISTORY_TOKEN_BUDGET,
      floor
    );
    const built = buildCoverageContext({
      provider: "openrouter",
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      history: initialHistory,
      completedTurns,
      summarizedTurnCount,
      floor,
    });
    const priorHistory = built.history.slice(0, -1);

    assert.equal(floor, 7);
    assert.equal(countPlayableHistoryTurns(initialHistory), 7);
    assert.equal(built.meta.memoryCoverage?.firstRawPlayableTurn, 1);
    assert.equal(built.meta.memoryCoverage?.gapTurns, 0);
    assert.equal(priorHistory.length % 2, 0);
  });

  it("keeps the existing adult handoff when it already exceeds coverage", () => {
    const full = rawRecentTurnsToHistory(makeTurns(8, 200));
    const existingHandoff = full.slice(-12);
    const coverageRequired = full.slice(-8);
    assert.equal(selectLongerHistorySuffix(existingHandoff, coverageRequired), existingHandoff);
  });

  it("keeps normal caught-up adult handoff byte-identical before assembly", () => {
    const full = rawRecentTurnsToHistory(makeTurns(6, 200));
    const handoff = full.slice(-12);
    const coverage = trimHistoryToBudget(full, HISTORY_TOKEN_BUDGET, 4);
    const selected = selectLongerHistorySuffix(handoff, coverage);
    assert.equal(selected, handoff);
    assert.deepEqual(selected, handoff);

    const built = buildCoverageContext({
      provider: "cheaperinference",
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      history: selected,
      completedTurns: 6,
      summarizedTurnCount: 6,
      floor: 4,
      preserveAdultHandoffRawHistory: true,
      adultHandoffRequiredTurnFloor: 6,
    });
    assert.equal(built.meta.memoryCoverage?.effectiveFloor, 6);
    assert.equal(built.meta.memoryCoverage?.degraded, false);
    assert.equal(built.history.slice(0, -1).length, handoff.length);
  });

  for (const path of ["first adult handoff", "silent fallback"] as const) {
    it(`${path} hard-caps Gemini-sized coverage instead of replaying unbounded raw`, () => {
      const completedTurns = 20;
      const summarizedTurnCount = 6;
      const floor = resolveMemoryCoverageTurnFloor({ completedTurns, summarizedTurnCount });
      const full = rawRecentTurnsToHistory(makeTurns(completedTurns, 15_000));
      const handoff = full.slice(-12);
      const coverage = trimHistoryToBudget(full, HISTORY_TOKEN_BUDGET, floor);
      const selected = selectLongerHistorySuffix(handoff, coverage);
      const built = buildCoverageContext({
        provider: "cheaperinference",
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        history: selected,
        completedTurns,
        summarizedTurnCount,
        floor,
        preserveAdultHandoffRawHistory: true,
        adultHandoffRequiredTurnFloor: 6,
        suppressMemoryCoverageDegradedLog: true,
      });
      const coverageMeta = built.meta.memoryCoverage!;
      const priorHistory = built.history.slice(0, -1);
      const priorTokens = priorHistory.reduce(
        (sum, message) => sum + estimateTokens(message.content),
        0
      );

      assert.equal(coverageMeta.requestedFloor, 14);
      assert.equal(coverageMeta.adultRequiredFloor, 6);
      assert.ok(
        countPlayableHistoryTurns(priorHistory) <= 4,
        `expected 4-turn hard ceiling, got ${countPlayableHistoryTurns(priorHistory)}`
      );
      assert.ok(priorTokens < 80_000, `expected a large cut from unbounded raw, got ${priorTokens}`);
      assert.equal(priorHistory.length % 2, 0);
    });
  }

  it("hard-caps an oversized adult baseline instead of sending the full handoff", () => {
    const completedTurns = 6;
    const floor = 4;
    const handoff = rawRecentTurnsToHistory(makeTurns(completedTurns, 40_000));
    const built = buildCoverageContext({
      provider: "cheaperinference",
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      history: handoff,
      completedTurns,
      summarizedTurnCount: completedTurns,
      floor,
      preserveAdultHandoffRawHistory: true,
      adultHandoffRequiredTurnFloor: 6,
      suppressMemoryCoverageDegradedLog: true,
    });
    const priorHistory = built.history.slice(0, -1);
    const priorTokens = priorHistory.reduce(
      (sum, message) => sum + estimateTokens(message.content),
      0
    );

    assert.ok(
      countPlayableHistoryTurns(priorHistory) <= 4,
      `expected 4-turn hard ceiling, got ${countPlayableHistoryTurns(priorHistory)}`
    );
    assert.ok(priorTokens < handoff.reduce((sum, message) => sum + estimateTokens(message.content), 0));
    assert.equal(priorHistory.length % 2, 0);
  });

  it("trims a former unbounded payload instead of injecting the whole chat", () => {
    const completedTurns = 20;
    const summarizedTurnCount = 0;
    const floor = resolveMemoryCoverageTurnFloor({ completedTurns, summarizedTurnCount });
    const oversized = rawRecentTurnsToHistory(makeTurns(completedTurns, 10_000));
    const built = buildCoverageContext({
      provider: "openrouter",
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      history: oversized,
      completedTurns,
      summarizedTurnCount,
      floor,
      suppressMemoryCoverageDegradedLog: true,
    });
    const priorHistory = built.history.slice(0, -1);
    const priorTokens = priorHistory.reduce(
      (sum, message) => sum + estimateTokens(message.content),
      0
    );

    assert.ok(
      countPlayableHistoryTurns(priorHistory) <= 4,
      `expected 4-turn hard ceiling, got ${countPlayableHistoryTurns(priorHistory)}`
    );
    assert.ok(priorTokens < oversized.reduce((sum, message) => sum + estimateTokens(message.content), 0));
    assert.ok(priorHistory.length < oversized.length);
    assert.equal(priorHistory.length % 2, 0);
  });
});
