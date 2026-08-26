import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { OPENROUTER_QWEN_37_MAX_MODEL } from "@/lib/chatModels";
import { HISTORY_TOKEN_BUDGET } from "@/lib/contextTrack";
import {
  GENERAL_ROUTE_BRIDGE_USER_MARKER,
  analyzeProviderHistoryHealth,
  countRealPlayableHistoryTurns,
  trimProviderHistoryToBudget,
} from "@/lib/providerHistoryPolicy";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveMemoryCoverageGap,
  selectLongerHistorySuffix,
  trimHistoryToBudget,
  type DialogueTurn,
} from "@/lib/hybridMemory";
import { buildContext } from "@/services/contextBuilder";
import type { ChatMsg } from "@/lib/ai";

const ENV_KEY = "MEMORY_5PLUS4_ENABLED";

function saveEnv(): string | undefined {
  return process.env[ENV_KEY];
}

function restoreEnv(value: string | undefined): void {
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
}

function makeTurns(count: number, assistantChars = 2500): DialogueTurn[] {
  return Array.from({ length: count }, (_, index) => ({
    user: `user-${index + 1}:${"가".repeat(200)}`,
    assistant: `assistant-${index + 1}:${"나".repeat(assistantChars)}`,
  }));
}

function buildCoverageContext(opts: {
  history: ChatMsg[];
  completedTurns: number;
  completedTurnsForMemoryCoverage?: number;
  summarizedTurnCount: number;
  historyMinTurnFloor?: number;
  providerHistoryMinRealPlayableExchanges?: number;
  providerHistoryAbsoluteTurnFloor?: number;
  providerHistoryProtectOpening?: boolean;
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
    provider: "openrouter",
    modelId: OPENROUTER_QWEN_37_MAX_MODEL,
    completedTurns: opts.completedTurns,
    completedTurnsForMemoryCoverage: opts.completedTurnsForMemoryCoverage,
    summarizedTurnCount: opts.summarizedTurnCount,
    historyMinTurnFloor: opts.historyMinTurnFloor ?? 4,
    providerHistoryMinRealPlayableExchanges: opts.providerHistoryMinRealPlayableExchanges,
    providerHistoryAbsoluteTurnFloor: opts.providerHistoryAbsoluteTurnFloor,
    providerHistoryProtectOpening: opts.providerHistoryProtectOpening,
    preserveAdultHandoffRawHistory: opts.preserveAdultHandoffRawHistory,
    adultHandoffRequiredTurnFloor: opts.adultHandoffRequiredTurnFloor,
    suppressMemoryCoverageDegradedLog: opts.suppressMemoryCoverageDegradedLog,
  });
}

describe("contextBuilder memory coverage — 5+4 owner contract MC1-MC10", () => {
  let savedFlag: string | undefined;

  beforeEach(() => {
    savedFlag = saveEnv();
  });

  afterEach(() => {
    restoreEnv(savedFlag);
  });

  it("MC1 after historical 1-6 seal, route RAW stays 4 and coverage gap is 0", () => {
    const completedTurns = 6;
    const summarizedTurnCount = 6;
    const history = trimProviderHistoryToBudget(
      rawRecentTurnsToHistory(makeTurns(completedTurns), 4),
      HISTORY_TOKEN_BUDGET,
      { minRealPlayableExchanges: 4, protectOpening: false }
    );
    const built = buildCoverageContext({
      history,
      completedTurns,
      summarizedTurnCount,
      historyMinTurnFloor: 4,
      providerHistoryMinRealPlayableExchanges: 4,
      providerHistoryAbsoluteTurnFloor: 4,
    });
    const prior = built.history.slice(0, -1);
    assert.equal(countRealPlayableHistoryTurns(prior), 4);
    assert.equal(built.meta.memoryCoverage?.requestedFloor, 4);
    assert.equal(built.meta.memoryCoverage?.effectiveFloor, 4);
    assert.equal(built.meta.memoryCoverage?.firstRawPlayableTurn, 3);
    assert.equal(built.meta.memoryCoverage?.gapTurns, 0);
    assert.equal(prior.length % 2, 0);
  });

  it("MC2 buildContext keeps REAL RAW <=4 and does not lag-expand floor", () => {
    const completedTurns = 20;
    const summarizedTurnCount = 6;
    const history = trimProviderHistoryToBudget(
      rawRecentTurnsToHistory(makeTurns(completedTurns), 4),
      HISTORY_TOKEN_BUDGET,
      { minRealPlayableExchanges: 4, protectOpening: false }
    );
    const built = buildCoverageContext({
      history,
      completedTurns,
      summarizedTurnCount,
      historyMinTurnFloor: 4,
      providerHistoryMinRealPlayableExchanges: 4,
      providerHistoryAbsoluteTurnFloor: 4,
    });
    const prior = built.history.slice(0, -1);
    assert.ok(countRealPlayableHistoryTurns(prior) <= 4);
    assert.equal(built.meta.memoryCoverage?.requestedFloor, 4);
    assert.equal(built.meta.memoryCoverage?.effectiveFloor, 4);
    assert.notEqual(built.meta.memoryCoverage?.requestedFloor, 14);
  });

  it("MC3 buildContext does not re-expand 4 RAW into legacy coverage floor 14", () => {
    process.env[ENV_KEY] = "1";
    const history = trimProviderHistoryToBudget(
      rawRecentTurnsToHistory(makeTurns(20), 4),
      HISTORY_TOKEN_BUDGET,
      { minRealPlayableExchanges: 4, protectOpening: false }
    );
    const built = buildCoverageContext({
      history,
      completedTurns: 20,
      summarizedTurnCount: 6,
      historyMinTurnFloor: 4,
      providerHistoryMinRealPlayableExchanges: 4,
      providerHistoryAbsoluteTurnFloor: 4,
    });
    assert.equal(built.meta.memoryCoverage?.effectiveFloor, 4);
    assert.equal(countRealPlayableHistoryTurns(built.history.slice(0, -1)), 4);
  });

  it("MC4 opening is not counted as real playable RAW", () => {
    process.env[ENV_KEY] = "1";
    const rows: Array<{ role: "user" | "assistant"; content: string; model?: string }> = [
      { role: "assistant", model: "greeting", content: "오프닝 장면" },
    ];
    for (let t = 1; t <= 4; t++) {
      rows.push({ role: "user", content: `user-${t}` });
      rows.push({ role: "assistant", content: `assistant-${t}`, model: "test" });
    }
    const history = trimProviderHistoryToBudget(
      rawRecentTurnsToHistory(messagesToTurns(rows), 4, {
        summarizedTurnCount: 0,
        memoryFeatureEnabled: true,
      }),
      HISTORY_TOKEN_BUDGET,
      { minRealPlayableExchanges: 4, protectOpening: true }
    );
    const health = analyzeProviderHistoryHealth(history);
    assert.equal(health.openingPreludePresent, true);
    assert.equal(health.realRawCompleteExchanges, 4);
    const built = buildCoverageContext({
      history,
      completedTurns: 4,
      summarizedTurnCount: 0,
      providerHistoryMinRealPlayableExchanges: 4,
      providerHistoryAbsoluteTurnFloor: 5,
      providerHistoryProtectOpening: true,
    });
    const priorHealth = analyzeProviderHistoryHealth(built.history.slice(0, -1));
    assert.ok(priorHealth.realRawCompleteExchanges <= 4);
  });

  it("MC5 general bridge is not counted as real RAW", () => {
    const history: ChatMsg[] = [
      { role: "user", content: GENERAL_ROUTE_BRIDGE_USER_MARKER },
      { role: "assistant", content: '{"relationshipChange":"calm"}' },
      ...rawRecentTurnsToHistory(makeTurns(4, 400)),
    ];
    const health = analyzeProviderHistoryHealth(history);
    assert.equal(health.generalRouteBridgePresent, true);
    assert.equal(countRealPlayableHistoryTurns(history), health.realRawCompleteExchanges);
    assert.ok(health.realRawCompleteExchanges <= 4);
  });

  it("MC6 opening + RAW4 over 10K stays protected when provider policy fields supplied", () => {
    process.env[ENV_KEY] = "1";
    const OPENING = "*UNIQUE_OPENING_FACT*";
    const rows: Array<{ role: "user" | "assistant"; content: string; model?: string }> = [
      { role: "assistant", model: "greeting", content: OPENING },
    ];
    for (let t = 1; t <= 4; t++) {
      rows.push({ role: "user", content: `u${t}` });
      rows.push({ role: "assistant", content: `a${t}`.padEnd(12_000, "x"), model: "test" });
    }
    const turns = messagesToTurns(rows);
    const history = trimProviderHistoryToBudget(
      rawRecentTurnsToHistory(turns, 4, {
        summarizedTurnCount: 0,
        memoryFeatureEnabled: true,
      }),
      HISTORY_TOKEN_BUDGET,
      { minRealPlayableExchanges: 4, protectOpening: true }
    );
    const trimmedHealth = analyzeProviderHistoryHealth(history);
    assert.equal(trimmedHealth.openingPreludePresent, true);
    assert.equal(trimmedHealth.realRawCompleteExchanges, 4);
    const built = buildCoverageContext({
      history,
      completedTurns: 4,
      summarizedTurnCount: 0,
      providerHistoryMinRealPlayableExchanges: 4,
      providerHistoryAbsoluteTurnFloor: 5,
      providerHistoryProtectOpening: true,
      suppressMemoryCoverageDegradedLog: true,
    });
    const prior = built.history.slice(0, -1);
    const builtHealth = analyzeProviderHistoryHealth(prior);
    assert.ok(
      builtHealth.openingPreludePresent ||
        prior.some((m) => m.content.includes("UNIQUE_OPENING_FACT"))
    );
    assert.equal(builtHealth.realRawCompleteExchanges, 4);
  });

  it("MC7 after summary5 opening disappears and RAW2-5 remains", () => {
    process.env[ENV_KEY] = "1";
    const OPENING = "*UNIQUE_OPENING_FACT*";
    const rows: Array<{ role: "user" | "assistant"; content: string; model?: string }> = [
      { role: "assistant", model: "greeting", content: OPENING },
    ];
    for (let t = 1; t <= 5; t++) {
      rows.push({ role: "user", content: `u${t}` });
      rows.push({ role: "assistant", content: `a${t}`, model: "test" });
    }
    const history = trimProviderHistoryToBudget(
      rawRecentTurnsToHistory(messagesToTurns(rows), 4, {
        summarizedTurnCount: 5,
        memoryFeatureEnabled: true,
      }),
      HISTORY_TOKEN_BUDGET,
      { minRealPlayableExchanges: 4, protectOpening: false }
    );
    const text = history.map((m) => m.content).join("\n");
    assert.doesNotMatch(text, /UNIQUE_OPENING_FACT/);
    assert.match(text, /u2/);
    assert.match(text, /u5/);
    assert.equal(countRealPlayableHistoryTurns(history), 4);
  });

  it("MC8 first adult handoff supplied bounded history remains byte/order stable", () => {
    const full = rawRecentTurnsToHistory(makeTurns(6, 200));
    const handoff = full.slice(-12);
    const built = buildCoverageContext({
      history: handoff,
      completedTurns: 6,
      summarizedTurnCount: 6,
      historyMinTurnFloor: 4,
      preserveAdultHandoffRawHistory: true,
      adultHandoffRequiredTurnFloor: 6,
    });
    assert.deepEqual(built.history.slice(0, -1), handoff);
    assert.equal(built.meta.memoryCoverage?.degraded, false);
  });

  it("MC9 memory reset eligible-turn arithmetic still produces gap=0", () => {
    const built = buildCoverageContext({
      history: rawRecentTurnsToHistory(makeTurns(4, 200)),
      completedTurns: 101,
      completedTurnsForMemoryCoverage: 1,
      summarizedTurnCount: 0,
      historyMinTurnFloor: 4,
      providerHistoryMinRealPlayableExchanges: 4,
    });
    assert.equal(built.meta.memoryCoverage?.firstRawPlayableTurn, 1);
    assert.equal(built.meta.memoryCoverage?.gapTurns, 0);
    assert.equal(
      resolveMemoryCoverageGap({
        firstRawPlayableTurn: built.meta.memoryCoverage?.firstRawPlayableTurn,
        summarizedTurnCount: 0,
      }),
      0
    );
  });

  it("MC10 no orphan user/assistant half pair in assembled history", () => {
    process.env[ENV_KEY] = "1";
    const built = buildCoverageContext({
      history: trimProviderHistoryToBudget(
        rawRecentTurnsToHistory(makeTurns(8), 4),
        HISTORY_TOKEN_BUDGET,
        { minRealPlayableExchanges: 4, protectOpening: false }
      ),
      completedTurns: 8,
      summarizedTurnCount: 5,
      providerHistoryMinRealPlayableExchanges: 4,
      providerHistoryAbsoluteTurnFloor: 4,
    });
    const prior = built.history.slice(0, -1);
    assert.equal(prior.length % 2, 0);
    for (let i = 0; i < prior.length; i += 2) {
      assert.equal(prior[i]?.role, "user");
      assert.equal(prior[i + 1]?.role, "assistant");
    }
  });

  it("legacy selectLongerHistorySuffix helper still preserves longer adult handoff suffix", () => {
    const full = rawRecentTurnsToHistory(makeTurns(8, 200));
    const existingHandoff = full.slice(-12);
    const coverageRequired = full.slice(-8);
    assert.equal(selectLongerHistorySuffix(existingHandoff, coverageRequired), existingHandoff);
  });
});
