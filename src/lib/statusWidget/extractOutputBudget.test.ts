import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveBackgroundOutputBudget } from "@/lib/ai";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { extractStatusWidgetValuesForTurn, type StatusWidgetExtractCaller } from "./extract";
import {
  isCombinedExtractLikelyTruncated,
  resolveCombinedDualWidgetExtractMaxTokens,
  resolveWidgetOutputSizeProxy,
} from "./extractNormalize";
import { collectWidgetJsonKeys } from "./prompt";
import type { ResolvedStatusWidgetTurn, StatusWidget } from "./types";

const usage = { inputTokens: 10, outputTokens: 5, estimated: true };

const userWidget: StatusWidget = {
  version: 1,
  name: "유저 상태",
  placement: "bottom",
  htmlTemplate: "{{기분}}",
  fields: [{ id: "기분", label: "기분", instruction: "유저 기분" }],
};

const singleResolved: ResolvedStatusWidgetTurn = {
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

const dualResolved: ResolvedStatusWidgetTurn = {
  ...singleResolved,
  mode: "both",
  displayMode: "both",
  userWidget,
  needsUserValues: true,
};

describe("status widget extract output budget — request kind policy", () => {
  it("bounds the initial and combined widget extract kinds", () => {
    assert.equal(
      resolveBackgroundOutputBudget("background-status-widget-extract", 296),
      296
    );
    assert.equal(
      resolveBackgroundOutputBudget("background-status-widget-extract-combined", 3072),
      3072
    );
  });

  it("falls back to the request-kind default when no explicit budget is given", () => {
    assert.equal(
      resolveBackgroundOutputBudget("background-status-widget-extract"),
      3072
    );
    assert.equal(
      resolveBackgroundOutputBudget("background-status-widget-extract-combined"),
      3072
    );
  });

  it("keeps the repair / fallback / echo-fix widget kinds unbounded", () => {
    for (const requestKind of [
      "background-status-widget-extract-repair",
      "background-status-widget-extract-fallback",
      "background-status-widget-extract-volatile-echo-fix",
    ]) {
      assert.equal(
        resolveBackgroundOutputBudget(requestKind, 512),
        null,
        `${requestKind} must stay unbounded`
      );
    }
  });

  it("does not change the output budget of the other background kinds", () => {
    for (const requestKind of [
      "background-memory-extract",
      "background-lorebook-compact",
      "background-status-meta-extract",
      "background-suggested-replies-extract",
    ]) {
      assert.equal(
        resolveBackgroundOutputBudget(requestKind, 4096),
        null,
        `${requestKind} must stay unbounded`
      );
    }
  });

  it("does not change the shared post-turn initial budget", () => {
    assert.equal(
      resolveBackgroundOutputBudget("background-post-turn-shared-initial"),
      4096
    );
  });
});

describe("status widget extract output budget — request wiring", () => {
  it("requests the per-widget budget on a single-source initial extract", async () => {
    const calls: Array<{ requestKind: string; maxTokens?: number }> = [];
    const caller: StatusWidgetExtractCaller = async (_system, _history, opts) => {
      calls.push({ requestKind: opts.requestKind, maxTokens: opts.maxTokens });
      return {
        text: JSON.stringify(
          Object.fromEntries(
            collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET).map((key) => [key, `값-${key}`])
          )
        ),
        usage,
      };
    };

    const result = await extractStatusWidgetValuesForTurn({
      charName: "라이크",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "라이크는 복도에 서 있었다.",
      resolved: singleResolved,
      caller,
      primaryModelId: "gpt-5.6-luna",
      activePromises: [],
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.requestKind, "background-status-widget-extract");
    assert.equal(
      calls[0]?.maxTokens,
      resolveWidgetOutputSizeProxy(
        DEFAULT_STATUS_WIDGET,
        collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET)
      )
    );
    assert.ok((calls[0]?.maxTokens ?? 0) > 0);
    assert.ok((calls[0]?.maxTokens ?? 0) <= 512);
    assert.equal(result.meta.actualCallCount, 1);
    assert.ok(result.values.character);
  });

  it("requests the combined budget on a dual-source initial extract", async () => {
    const calls: Array<{ requestKind: string; maxTokens?: number }> = [];
    const caller: StatusWidgetExtractCaller = async (_system, _history, opts) => {
      calls.push({ requestKind: opts.requestKind, maxTokens: opts.maxTokens });
      return {
        text: JSON.stringify({
          character_values: { 시간: "14:35", 장소: "본부 로비" },
          user_values: { 기분: "평온" },
          extracted_facts: [],
        }),
        usage,
      };
    };

    const result = await extractStatusWidgetValuesForTurn({
      charName: "라이크",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "라이크는 복도에 서 있었다.",
      resolved: dualResolved,
      caller,
      primaryModelId: "gpt-5.6-luna",
      activePromises: [],
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.requestKind, "background-status-widget-extract-combined");
    assert.equal(
      calls[0]?.maxTokens,
      resolveCombinedDualWidgetExtractMaxTokens(DEFAULT_STATUS_WIDGET, userWidget)
    );
    assert.ok((calls[0]?.maxTokens ?? 0) >= 2048);
    assert.ok((calls[0]?.maxTokens ?? 0) <= 3072);
    assert.equal(result.meta.actualCallCount, 1);
  });

  it("detects a combined extract that hit the requested budget", () => {
    const maxTokens = resolveCombinedDualWidgetExtractMaxTokens(
      DEFAULT_STATUS_WIDGET,
      userWidget
    );
    assert.equal(
      isCombinedExtractLikelyTruncated({
        finishReason: null,
        outputTokens: maxTokens,
        maxTokens,
        jsonParseOk: false,
      }),
      true
    );
    assert.equal(
      isCombinedExtractLikelyTruncated({
        finishReason: "stop",
        outputTokens: maxTokens - 1,
        maxTokens,
        jsonParseOk: true,
      }),
      false
    );
  });
});
