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
import type { StatusWidgetExtractCaller } from "./extract";
import type { TokenUsage } from "@/lib/ai";

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
    assert.equal(resolveStatusWidgetModelFamily("moonshotai/kimi-k3"), "other");
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

describe("resolveStatusWidgetTurnValues canonical Luna owner", () => {
  it("full leaked STATUS_VALUES tail does not suppress Luna canonical extraction", async () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: JSON.stringify(DEFAULT_STATUS_WIDGET),
      chatMode: "character_only",
    });
    const leakJson = JSON.stringify({
      시간: "14:30",
      장소: "카페",
      속마음: "긴장",
      현재상황: "대화",
      의식의흐름: "커피 → 대화",
      다음상황: "주문",
      extracted_facts: [],
    });
    const lunaJson = JSON.stringify({
      시간: "15:00",
      장소: "도서관",
      속마음: "평온",
      현재상황: "독서",
      의식의흐름: "책 → 휴식",
      다음상황: "귀가",
      extracted_facts: [],
    });
    const raw = `RP 본문입니다.\n\n${STATUS_VALUES_BLOCK}\n${leakJson}\n${STATUS_VALUES_END}`;
    const kinds: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      kinds.push(opts.requestKind);
      const usage: TokenUsage = { inputTokens: 11, outputTokens: 6, estimated: true };
      return { text: lunaJson, usage };
    };
    const out = await resolveStatusWidgetTurnValues({
      chatId: -1,
      modelId: OPENROUTER_CLAUDE_DEFAULT,
      savedText: raw,
      rawWidgetSourceText: raw,
      statusWidgetTurn: resolved,
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      extractCaller: caller,
    });
    assert.ok(kinds.length > 0, "Luna must be invoked despite the full leak");
    assert.ok(
      kinds.some((kind) => kind.includes("background-status-widget-extract")),
      `kinds=${kinds.join(",")}`
    );
    assert.notEqual(out.telemetry.resolutionSource, "split_raw");
    assert.ok(out.widgetExtractUsage, "Luna usage must be recorded");
    assert.ok(out.widgetExtractBillingMeta, "Luna billing meta must be recorded");
    assert.ok(out.values, "canonical values must exist");
    assert.equal(out.values.character?.시간, "15:00", "canonical values must be Luna's, not the leak's");
    assert.doesNotMatch(out.prose, /STATUS_VALUES/, "leak must be stripped from prose");
    assert.equal(out.telemetry.splitRawHit, true, "leak detection telemetry preserved");
    assert.equal(out.telemetry.backfillSkippedReason, null);
  });
});
