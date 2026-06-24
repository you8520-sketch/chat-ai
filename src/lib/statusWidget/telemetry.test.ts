import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STATUS_VALUES_BLOCK,
  STATUS_VALUES_END,
  splitProseAndStatusWidgetValues,
} from "./parseValues";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { resolveStatusWidgetTurn } from "./resolve";
import {
  aggregateStatusWidgetTelemetry,
  resolveStatusWidgetModelFamily,
  resolveStatusWidgetParserMode,
  resolveStatusWidgetTurnValues,
  type StatusWidgetTurnTelemetry,
} from "./telemetry";

const resolvedTurn = resolveStatusWidgetTurn({
  characterWidgetJson: JSON.stringify(DEFAULT_STATUS_WIDGET),
  chatMode: "character_only",
});

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
  });
});

describe("resolveStatusWidgetTurnValues", () => {
  it("json parse success on STATUS_VALUES block without infer/backfill", async () => {
    const text = `RP 본문입니다.

${STATUS_VALUES_BLOCK}
{"시간":"14:30","장소":"카페","속마음":"긴장","현재상황":"대화"}
${STATUS_VALUES_END}`;

    const result = await resolveStatusWidgetTurnValues({
      chatId: 99,
      modelId: "anthropic/claude-opus-4.5",
      savedText: text,
      rawWidgetSourceText: text,
      statusWidgetTurn: resolvedTurn,
      streamCapture: null,
      statusArtifactCapture: null,
      charName: "NPC",
      personaName: "유저",
      userMessage: "안녕",
    });

    assert.equal(result.telemetry.jsonParseSuccess, true);
    assert.equal(result.telemetry.splitSavedHit, true);
    assert.equal(result.telemetry.inferHit, false);
    assert.equal(result.telemetry.backfillAttempted, false);
    assert.equal(result.telemetry.finalHasContent, true);
    assert.equal(result.telemetry.resolutionSource, "split_saved");
    assert.equal(result.values?.character?.["시간"], "14:30");
  });

  it("infer path when prose has label lines only", async () => {
    const text = `RP 본문입니다.

시간 : 오후 3시
장소 : 거실
속마음 : 불안하다
현재상황 : 대화 중`;

    const result = await resolveStatusWidgetTurnValues({
      chatId: 100,
      modelId: "anthropic/claude-opus-4.5",
      savedText: text,
      rawWidgetSourceText: text,
      statusWidgetTurn: resolvedTurn,
      streamCapture: null,
      statusArtifactCapture: null,
      charName: "NPC",
      personaName: "유저",
      userMessage: "안녕",
    });

    assert.equal(result.telemetry.inferHit, true);
    assert.equal(result.telemetry.jsonParseSuccess, false);
    assert.equal(result.telemetry.resolutionSource, "infer");
    assert.ok(result.values?.character?.["장소"]);
  });
});

describe("aggregateStatusWidgetTelemetry", () => {
  it("computes rates", () => {
    const agg = aggregateStatusWidgetTelemetry([
      makeTelemetry({
        jsonParseSuccess: true,
        inferHit: false,
        backfillAttempted: false,
        finalHasContent: true,
        resolutionSource: "split_saved",
      }),
      makeTelemetry({
        jsonParseSuccess: false,
        inferHit: true,
        backfillAttempted: true,
        backfillSuccess: true,
        finalHasContent: true,
        resolutionSource: "backfill",
        modelFamily: "deepseek",
      }),
    ]);
    assert.equal(agg.totalTurns, 2);
    assert.equal(agg.jsonParseSuccessRate, 0.5);
    assert.equal(agg.inferRate, 0.5);
    assert.equal(agg.backfillAttemptRate, 0.5);
    assert.equal(agg.backfillSuccessRate, 0.5);
    assert.equal(agg.finalHasContentRate, 1);
  });
});

describe("fixture simulation rates", () => {
  it("reports pipeline outcomes on canned outputs", async () => {
    const fixtures: Array<{ name: string; modelId: string; text: string }> = [
      {
        name: "standard_marker",
        modelId: "anthropic/claude-opus-4.5",
        text: `본문.\n\n${STATUS_VALUES_BLOCK}\n{"시간":"10:00","장소":"방","속마음":"…","현재상황":"…"}\n${STATUS_VALUES_END}`,
      },
      {
        name: "legacy_json_fence",
        modelId: "anthropic/claude-opus-4.5",
        text: `본문.\n\n\`\`\`json\n{"시간":"21:00","장소":"거실","속마음":"긴장","현재상황":"대화"}\n\`\`\``,
      },
      {
        name: "prose_only",
        modelId: "anthropic/claude-opus-4.5",
        text: "본문만 있고 상태 JSON 없음.",
      },
    ];

    const rows: StatusWidgetTurnTelemetry[] = [];
    for (const f of fixtures) {
      const { telemetry } = await resolveStatusWidgetTurnValues({
        chatId: 1,
        modelId: f.modelId,
        savedText: f.text,
        rawWidgetSourceText: f.text,
        statusWidgetTurn: resolvedTurn,
        streamCapture: null,
        statusArtifactCapture: null,
        charName: "NPC",
        personaName: "유저",
        userMessage: "test",
      });
      rows.push(telemetry);
    }

    const agg = aggregateStatusWidgetTelemetry(rows);
    console.info("[status-widget-telemetry-simulation]", JSON.stringify(agg));
    assert.equal(agg.totalTurns, fixtures.length);
    assert.ok(agg.jsonParseSuccessRate >= 0.5);
  });
});
