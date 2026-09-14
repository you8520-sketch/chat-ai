import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TokenUsage } from "@/lib/ai";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { extractStatusWidgetValuesForTurn, type StatusWidgetExtractCaller } from "./extract";
import { collectWidgetJsonKeys } from "./prompt";
import type { ResolvedStatusWidgetTurn } from "./types";

const resolved: ResolvedStatusWidgetTurn = {
  active: true,
  requestedMode: "character_only",
  mode: "character_only",
  displayMode: "creator",
  stackOrder: "character_first",
  characterWidget: DEFAULT_STATUS_WIDGET,
  userWidget: null,
  needsCharacterValues: true,
  needsUserValues: false,
};

const usage: TokenUsage = { inputTokens: 10, outputTokens: 5, estimated: true };

function validStatus(): string {
  return JSON.stringify(Object.fromEntries(
    collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET).map((key) => [key, `값-${key}`])
  ));
}

async function extract(caller: StatusWidgetExtractCaller) {
  return extractStatusWidgetValuesForTurn({
    charName: "라이크",
    personaName: "렌",
    userMessage: "안녕",
    assistantProse: "라이크는 복도에 서 있었다.",
    resolved,
    caller,
    primaryModelId: "gpt-5.6-luna",
  });
}

describe("status widget hard one-attempt contract", () => {
  it("persists a valid initial response with one physical call", async () => {
    const kinds: string[] = [];
    const result = await extract(async (_system, _history, opts) => {
      kinds.push(opts.requestKind);
      return { text: validStatus(), usage };
    });
    assert.deepEqual(kinds, ["background-status-widget-extract"]);
    assert.equal(result.meta.actualCallCount, 1);
    assert.equal(result.meta.usedRepair, false);
    assert.equal(result.meta.usedFallback, false);
    assert.ok(result.values.character);
  });

  it("malformed JSON is terminal without repair or fallback", async () => {
    const kinds: string[] = [];
    const result = await extract(async (_system, _history, opts) => {
      kinds.push(opts.requestKind);
      return { text: "{malformed", usage };
    });
    assert.deepEqual(kinds, ["background-status-widget-extract"]);
    assert.equal(result.meta.actualCallCount, 1);
    assert.equal(result.meta.exhausted, true);
    assert.equal(result.values.character, null);
  });

  it("transport failure is terminal without a second attempt", async () => {
    const kinds: string[] = [];
    const result = await extract(async (_system, _history, opts) => {
      kinds.push(opts.requestKind);
      throw new Error("502 upstream");
    });
    assert.deepEqual(kinds, ["background-status-widget-extract"]);
    assert.equal(result.meta.actualCallCount, 1);
    assert.equal(result.meta.postTurnPhysicalAttempted, true);
  });

  it("empty initial response is terminal with no fallback provider capability", async () => {
    const kinds: string[] = [];
    const result = await extractStatusWidgetValuesForTurn({
      charName: "라이크",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "라이크는 복도에 서 있었다.",
      resolved,
      primaryModelId: "gpt-5.6-luna",
      caller: async (_system, _history, opts) => {
        kinds.push(opts.requestKind);
        return { text: "", usage };
      },
    });
    assert.deepEqual(kinds, ["background-status-widget-extract"]);
    assert.equal(result.meta.actualCallCount, 1);
    assert.equal(result.meta.usedFallback, false);
    assert.equal(result.meta.exhausted, true);
    assert.equal(result.values.character, null);
  });
});
