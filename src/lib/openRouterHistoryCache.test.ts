/**
 * HC-01..12 — bounded sliding RAW vs Anthropic history cache breakpoint.
 * Offline only; no live provider calls.
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyAnthropicCacheAndPrefill,
  applyCacheAndPrefillForTransport,
  assemblePrimaryRpRequest,
} from "@/lib/openRouterAdult";
import { CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL } from "@/lib/chatModels";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveRawRecentTurnPool,
  trimHistoryToBudget,
  type DialogueTurn,
} from "@/lib/hybridMemory";
import { RAW_HISTORY_COMPLETE_EXCHANGES } from "@/lib/memory/memory-constants";
import { HISTORY_TOKEN_BUDGET } from "@/lib/contextTrack";
import {
  buildLikeScaleSnapshot,
  DIAGNOSTIC_OPUS_5_MODEL,
} from "@/lib/opusGeminiSameSnapshotDiagnostic";
import {
  buildOpenRouterCachedSystemContent,
  resolveHistoryCacheBreakpointIndex,
  wrapTextAsCachedContentBlock,
} from "@/lib/openRouterCache";
import {
  flattenOpenRouterMessageContent,
  type OpenRouterChatMessage,
  type OpenRouterContentBlock,
} from "@/lib/openRouterClient";
import { openRouterUsdCostFromRates } from "@/lib/openRouterModelPricing";
import { buildContext } from "@/services/contextBuilder";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "@/lib/responseLengthConstants";
import type { ChatMsg } from "@/lib/ai";

const OPUS = CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL;

function makeSaturatedTurns(n: number): DialogueTurn[] {
  return Array.from({ length: n }, (_, i) => ({
    user: `USER-${String.fromCharCode(65 + (i % 26))}-${i + 1} `.repeat(30),
    assistant: `ASST-${String.fromCharCode(65 + (i % 26))}-${i + 1} `.repeat(60),
  }));
}

function firstRetainedIdentity(history: ChatMsg[]): string {
  return history[0]?.content.slice(0, 40) ?? "";
}

function contentHash(messages: OpenRouterChatMessage[]): string {
  const payload = messages.map((m) => ({
    role: m.role,
    text: flattenOpenRouterMessageContent(m.content),
  }));
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function stripCacheControl(messages: OpenRouterChatMessage[]): OpenRouterChatMessage[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    return {
      ...m,
      content: (m.content as OpenRouterContentBlock[]).map(({ cache_control: _c, ...rest }) => rest),
    };
  });
}

function countCacheBlocks(messages: OpenRouterChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    n += (m.content as OpenRouterContentBlock[]).filter(
      (b) => b.cache_control?.type === "ephemeral"
    ).length;
  }
  return n;
}

/** Pre-fix legacy: apply history cache_control at resolved breakpoint (HC-02 proof only). */
function applyLegacyHistoryCacheBreakpoint(
  messages: OpenRouterChatMessage[]
): OpenRouterChatMessage[] {
  const bp = resolveHistoryCacheBreakpointIndex(messages);
  if (bp == null) return messages;
  return messages.map((m, i) => {
    if (i !== bp || m.role === "system") return m;
    const text = flattenOpenRouterMessageContent(m.content);
    return { ...m, content: wrapTextAsCachedContentBlock(text) };
  });
}

function assembleOpusWire(history: ChatMsg[], snapshot = buildLikeScaleSnapshot()) {
  const built = buildContext({
    ...snapshot,
    shortTermHistory: history,
    modelId: OPUS,
    provider: "cheaperinference",
  });
  return assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? history,
    modelId: OPUS,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: false,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: built.openRouterSystemSplit,
      charName: snapshot.charName,
    },
  });
}

describe("HC bounded sliding RAW vs history cache (HC-01..12)", () => {
  it("HC-01: saturated RAW sliding head changes per turn", () => {
    const turnsN = makeSaturatedTurns(12);
    const turnsN1 = makeSaturatedTurns(13);
    const histN = rawRecentTurnsToHistory(turnsN);
    const histN1 = rawRecentTurnsToHistory(turnsN1);
    assert.equal(histN.length, RAW_HISTORY_COMPLETE_EXCHANGES * 2);
    assert.equal(histN1.length, RAW_HISTORY_COMPLETE_EXCHANGES * 2);
    assert.notEqual(firstRetainedIdentity(histN), firstRetainedIdentity(histN1));
    const poolN = resolveRawRecentTurnPool(turnsN);
    const poolN1 = resolveRawRecentTurnPool(turnsN1);
    assert.equal(poolN.firstTurn1Indexed, 9);
    assert.equal(poolN1.firstTurn1Indexed, 10);
  });

  it("HC-02: legacy resolver finds history breakpoint; pre-fix would emit cache_control", () => {
    const turns = makeSaturatedTurns(10);
    const history = trimHistoryToBudget(
      rawRecentTurnsToHistory(turns),
      HISTORY_TOKEN_BUDGET,
      RAW_HISTORY_COMPLETE_EXCHANGES
    );
    const wire = assembleOpusWire(history);
    const messages = wire.messages as OpenRouterChatMessage[];
    const bp = resolveHistoryCacheBreakpointIndex(messages);
    assert.ok(bp != null && bp > 0, "structural conflict: breakpoint index exists");
    const legacy = applyLegacyHistoryCacheBreakpoint(messages);
    assert.equal(countCacheBlocks(legacy), 3, "pre-fix would emit 3 cache blocks");
    assert.equal(countCacheBlocks(messages), 2, "post-fix wire has no history cache");
  });

  it("HC-03: post-fix sliding path emits NO history cache breakpoint", () => {
    const wire = assembleOpusWire(rawRecentTurnsToHistory(makeSaturatedTurns(10)));
    const messages = wire.messages as OpenRouterChatMessage[];
    assert.equal(countCacheBlocks(messages), 2);
    const historyCached = messages.some(
      (m, i) =>
        i > 0 &&
        m.role !== "system" &&
        Array.isArray(m.content) &&
        (m.content as OpenRouterContentBlock[]).some((b) => b.cache_control?.type === "ephemeral")
    );
    assert.equal(historyCached, false);
  });

  it("HC-04: systemRules cache breakpoint preserved", () => {
    const wire = assembleOpusWire(rawRecentTurnsToHistory(makeSaturatedTurns(6)));
    const system = wire.messages[0];
    assert.ok(Array.isArray(system?.content));
    const blocks = system!.content as OpenRouterContentBlock[];
    assert.equal(blocks[0]?.cache_control?.type, "ephemeral");
    assert.ok(blocks[0]!.text.length > 100);
  });

  it("HC-05: characterSettings cache breakpoint preserved", () => {
    const wire = assembleOpusWire(rawRecentTurnsToHistory(makeSaturatedTurns(6)));
    const system = wire.messages[0];
    const blocks = (system!.content ?? []) as OpenRouterContentBlock[];
    assert.equal(blocks[1]?.cache_control?.type, "ephemeral");
    assert.equal(blocks[2]?.cache_control, undefined);
  });

  it("HC-06: payload text byte/content parity — only cache_control metadata differs", () => {
    const history = rawRecentTurnsToHistory(makeSaturatedTurns(8));
    const wire = assembleOpusWire(history);
    const messages = wire.messages as OpenRouterChatMessage[];
    const legacy = applyLegacyHistoryCacheBreakpoint(messages);
    assert.notEqual(countCacheBlocks(messages), countCacheBlocks(legacy));
    assert.equal(contentHash(stripCacheControl(messages)), contentHash(stripCacheControl(legacy)));
  });

  it("HC-07: RAW4 pool unchanged by cache patch", () => {
    const turns = makeSaturatedTurns(20);
    const { pool, firstTurn1Indexed } = resolveRawRecentTurnPool(turns);
    assert.equal(pool.length, RAW_HISTORY_COMPLETE_EXCHANGES);
    assert.equal(firstTurn1Indexed, 17);
    const history = rawRecentTurnsToHistory(turns);
    assert.match(history[0]!.content, /USER-Q-17/);
  });

  it("HC-08: temporary RAW5 floor path unchanged", () => {
    const turns = makeSaturatedTurns(6);
    const full = rawRecentTurnsToHistory(turns, RAW_HISTORY_COMPLETE_EXCHANGES + 1);
    assert.equal(full.length, (RAW_HISTORY_COMPLETE_EXCHANGES + 1) * 2);
    const trimmed = trimHistoryToBudget(full, HISTORY_TOKEN_BUDGET, RAW_HISTORY_COMPLETE_EXCHANGES + 1);
    assert.ok(trimmed.length >= RAW_HISTORY_COMPLETE_EXCHANGES * 2);
  });

  it("HC-09: regen wire unchanged except cache metadata (2 system blocks only)", () => {
    const snapshot = buildLikeScaleSnapshot();
    const built = buildContext({
      ...snapshot,
      modelId: OPUS,
      provider: "cheaperinference",
    });
    const normal = assemblePrimaryRpRequest({
      system: built.systemPrompt,
      history: built.history ?? [],
      modelId: OPUS,
      targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
      stream: false,
      messageOpts: {
        transportProvider: "cheaperinference",
        systemSplit: built.openRouterSystemSplit,
        charName: snapshot.charName,
        sessionId: "chat-1",
      },
    });
    const regen = assemblePrimaryRpRequest({
      system: built.systemPrompt,
      history: built.history ?? [],
      modelId: OPUS,
      targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
      stream: false,
      messageOpts: {
        transportProvider: "cheaperinference",
        systemSplit: built.openRouterSystemSplit,
        charName: snapshot.charName,
        sessionId: "chat-1-regen-99-2",
      },
    });
    assert.equal(countCacheBlocks(normal.messages as OpenRouterChatMessage[]), 2);
    assert.equal(countCacheBlocks(regen.messages as OpenRouterChatMessage[]), 2);
    assert.equal(
      contentHash(stripCacheControl(normal.messages as OpenRouterChatMessage[])),
      contentHash(stripCacheControl(regen.messages as OpenRouterChatMessage[]))
    );
  });

  it("HC-10: memory-disabled path — bounded sliding, no history cache", () => {
    const turns = messagesToTurns([
      { role: "assistant", content: "*opening*", model: "greeting" },
      ...Array.from({ length: 8 }, (_, i) => [
        { role: "user" as const, content: `u${i + 1}` },
        { role: "assistant" as const, content: `a${i + 1}`, model: "test" },
      ]).flat(),
    ]);
    const history = rawRecentTurnsToHistory(turns, RAW_HISTORY_COMPLETE_EXCHANGES, {
      memoryFeatureEnabled: false,
      summarizedTurnCount: 0,
    });
    const wire = assembleOpusWire(history);
    assert.equal(countCacheBlocks(wire.messages as OpenRouterChatMessage[]), 2);
    assert.ok(history.length <= RAW_HISTORY_COMPLETE_EXCHANGES * 2 + 2);
  });

  it("HC-11: no production monotonic-growing Anthropic path retains history cache", () => {
    const growingHistory: ChatMsg[] = [];
    for (let i = 0; i < 6; i++) {
      growingHistory.push({ role: "user", content: `turn ${i + 1} user` });
      growingHistory.push({ role: "assistant", content: `turn ${i + 1} assistant` });
    }
    const built = buildContext({
      ...buildLikeScaleSnapshot(),
      shortTermHistory: growingHistory,
      modelId: OPUS,
      provider: "cheaperinference",
    });
    const flatMessages: OpenRouterChatMessage[] = [
      {
        role: "system",
        content: buildOpenRouterCachedSystemContent(built.openRouterSystemSplit!),
      },
      ...growingHistory.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: "current" },
    ];
    const { messages } = applyAnthropicCacheAndPrefill(flatMessages, OPUS, "라이크", {
      skipAssistantPrefill: true,
    });
    assert.equal(resolveHistoryCacheBreakpointIndex(flatMessages) != null, true);
    assert.equal(countCacheBlocks(messages), 2);
  });

  it("HC-12: CI Opus bounded Main RP has 2 cache blocks after fix", () => {
    assert.equal(DIAGNOSTIC_OPUS_5_MODEL, OPUS);
    const wire = assembleOpusWire(rawRecentTurnsToHistory(makeSaturatedTurns(10)));
    assert.equal(countCacheBlocks(wire.messages as OpenRouterChatMessage[]), 2);
    const overlay = applyCacheAndPrefillForTransport(
      { provider: "cheaperinference" },
      wire.messages as OpenRouterChatMessage[],
      OPUS,
      "라이크",
      { skipAssistantPrefill: true }
    ).messages;
    assert.equal(countCacheBlocks(overlay), 2);
  });
});

describe("HC offline patch economics (live T2/T3 reference)", () => {
  const LIVE_T2 = {
    cacheReadTokens: 17_357,
    cacheWriteTokens: 22_669,
    standardInputTokens: 669,
  };
  const LIVE_T3 = {
    cacheReadTokens: 17_357,
    cacheWriteTokens: 18_254,
    standardInputTokens: 669,
  };

  function inputUsd(read: number, write: number, standard: number): number {
    return openRouterUsdCostFromRates({
      promptTokens: read + write + standard,
      outputTokens: 0,
      cacheReadTokens: read,
      cacheWriteTokens: write,
      modelId: OPUS,
    }).usdCost;
  }

  it("reports mid-teens % input savings for warm T2/T3 (history write → standard)", () => {
    for (const [label, row] of [
      ["T2", LIVE_T2],
      ["T3", LIVE_T3],
    ] as const) {
      const current = inputUsd(row.cacheReadTokens, row.cacheWriteTokens, row.standardInputTokens);
      const patch = inputUsd(
        row.cacheReadTokens,
        0,
        row.standardInputTokens + row.cacheWriteTokens
      );
      const savingsPct = ((current - patch) / current) * 100;
      assert.ok(savingsPct > 10 && savingsPct < 25, `${label} savings ${savingsPct.toFixed(1)}%`);
    }
  });
});
