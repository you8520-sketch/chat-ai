import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STATUS_VALUES_BLOCK,
  STATUS_VALUES_END,
} from "./parseValues";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { resolveStatusWidgetTurn } from "./resolve";
import {
  aggregateStatusWidgetTelemetry,
  resolveStatusWidgetModelFamily,
  resolveStatusWidgetParserMode,
  resolveStatusWidgetTurnValues,
  stripStatusWidgetFromAssistantProse,
  type StatusWidgetTurnTelemetry,
} from "./telemetry";
import { OPENROUTER_CLAUDE_DEFAULT } from "@/lib/chatModels";

function makeTelemetry(partial: Partial<StatusWidgetTurnTelemetry>): StatusWidgetTurnTelemetry {
  return {
    event: "status_widget_turn",
    chatId: 1,
    modelId: "deepseek/deepseek-v4-pro",
    modelFamily: "deepseek",
    parserMode: "deepseek",
    streamCaptureHit: false,
    splitSavedHit: false,
    splitRawHit: false,
    inferHit: false,
    backfillAttempted: false,
    backfillSuccess: false,
    backfillSkippedReason: null,
    jsonParseSuccess: false,
    resolutionSource: "none",
    finalHasContent: false,
    finalCorruptBeforeBackfill: false,
    regenerate: false,
    ...partial,
  };
}

describe("resolveStatusWidgetModelFamily", () => {
  it("classifies deepseek and gemini", () => {
    assert.equal(resolveStatusWidgetModelFamily("deepseek/deepseek-v4-pro"), "deepseek");
    assert.equal(resolveStatusWidgetModelFamily("google/gemini-2.5-pro"), "gemini");
    assert.equal(resolveStatusWidgetModelFamily("anthropic/claude-opus-4.5"), "anthropic");
    assert.equal(resolveStatusWidgetModelFamily("openai/gpt-4o"), "openai");
    assert.equal(resolveStatusWidgetModelFamily("z-ai/glm-5.2"), "other");
  });
});

describe("stripStatusWidgetFromAssistantProse", () => {
  it("removes STATUS_VALUES tail leaked by main model", () => {
    const text = `RP 본문입니다.

${STATUS_VALUES_BLOCK}
{"시간":"14:30","장소":"카페","속마음":"긴장","현재상황":"대화"}
${STATUS_VALUES_END}`;

    const prose = stripStatusWidgetFromAssistantProse(text);
    assert.equal(prose, "RP 본문입니다.");
    assert.doesNotMatch(prose, /STATUS_VALUES/);
  });

  it("keeps plain RP prose without widget tail", () => {
    const text = "RP 본문만 있습니다.";
    assert.equal(stripStatusWidgetFromAssistantProse(text), text);
  });
});

describe("resolveStatusWidgetParserMode", () => {
  it("marks deepseek and gemini pro as deepseek parser", () => {
    assert.equal(resolveStatusWidgetParserMode("deepseek/deepseek-v4-pro"), "deepseek");
    assert.equal(resolveStatusWidgetParserMode("google/gemini-2.5-pro"), "deepseek");
    assert.equal(resolveStatusWidgetParserMode("anthropic/claude-opus-4.5"), "standard");
  });
});

describe("aggregateStatusWidgetTelemetry", () => {
  it("computes rates", () => {
    const agg = aggregateStatusWidgetTelemetry([
      makeTelemetry({
        jsonParseSuccess: true,
        inferHit: false,
        backfillAttempted: true,
        backfillSuccess: true,
        finalHasContent: true,
        resolutionSource: "v3_extract",
      }),
      makeTelemetry({
        jsonParseSuccess: false,
        inferHit: false,
        backfillAttempted: true,
        backfillSuccess: false,
        finalHasContent: false,
        resolutionSource: "none",
      }),
    ]);

    assert.equal(agg.totalTurns, 2);
    assert.equal(agg.finalHasContentRate, 0.5);
    assert.equal(agg.backfillAttemptRate, 1);
    assert.equal(agg.backfillSuccessRate, 0.5);
    assert.equal(agg.byResolutionSource.v3_extract, 1);
  });
});

describe("resolveStatusWidgetTurnValues billing meta lifetime", () => {
  it("main STATUS_VALUES parse success → no background extract usage/meta", async () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: JSON.stringify(DEFAULT_STATUS_WIDGET),
      chatMode: "character_only",
    });
    const valuesJson = JSON.stringify({
      시간: "14:30",
      장소: "카페",
      속마음: "긴장",
      현재상황: "대화",
      의식의흐름: "커피 → 대화",
      다음상황: "주문",
      extracted_facts: [],
    });
    const raw = `RP 본문입니다.\n\n${STATUS_VALUES_BLOCK}\n${valuesJson}\n${STATUS_VALUES_END}`;
    const out = await resolveStatusWidgetTurnValues({
      chatId: -1,
      modelId: OPENROUTER_CLAUDE_DEFAULT,
      savedText: raw,
      rawWidgetSourceText: raw,
      statusWidgetTurn: resolved,
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
    });
    assert.equal(out.telemetry.resolutionSource, "split_raw");
    assert.equal(out.widgetExtractUsage, null);
    assert.equal(out.widgetExtractBillingMeta, null);
    assert.ok(out.values);
  });
});
