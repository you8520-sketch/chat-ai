import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { diagnoseStatusWidgetValues } from "./diagnostics";
import { resolveStatusWidgetTurn } from "./resolve";
import type { StatusWidget } from "./types";

const widget: StatusWidget = {
  version: 1,
  name: "상태",
  placement: "bottom",
  htmlTemplate: "<section>{{time}} {{inner_thought}} {{current_situation}}</section>",
  fields: [
    { id: "time", label: "시간", instruction: "현재 시간" },
    { id: "inner_thought", label: "속마음", instruction: "속마음" },
    { id: "current_situation", label: "현재상황", instruction: "현재 상황" },
  ],
};

const resolved = resolveStatusWidgetTurn({
  characterWidgetJson: JSON.stringify(widget),
  chatMode: "character_only",
  displayMode: "creator",
});

describe("status widget diagnostics", () => {
  it("reports missing required keys for an active empty object", () => {
    const diag = diagnoseStatusWidgetValues({
      resolved,
      statusWidgetTurnActive: true,
      values: {},
      model: "deepseek",
    });

    assert.equal(diag.dbValueShape, "empty_object");
    assert.equal(diag.hasUsableValues, false);
    assert.equal(diag.rendererWouldShow, false);
    assert.equal(diag.rendererWouldShowEditPreview, false);
    assert.equal(diag.reasonCode, "MISSING_REQUIRED_KEYS");
    assert.deepEqual(diag.missingKeys, ["time", "inner_thought", "current_situation"]);
  });

  it("reports placeholder-only values", () => {
    const diag = diagnoseStatusWidgetValues({
      resolved,
      statusWidgetTurnActive: true,
      values: { character: { time: "—", inner_thought: "—", current_situation: "—" } },
      model: "deepseek",
    });

    assert.equal(diag.dbValueShape, "placeholder_only");
    assert.equal(diag.placeholderOnly, true);
    assert.equal(diag.rendererWouldShow, false);
    assert.equal(diag.reasonCode, "PLACEHOLDER_ONLY");
  });

  it("reports OK for usable values", () => {
    const diag = diagnoseStatusWidgetValues({
      resolved,
      statusWidgetTurnActive: true,
      values: {
        character: {
          time: "14:30",
          inner_thought: "경계 중",
          current_situation: "복도 이동 중",
        },
      },
      model: "deepseek",
    });

    assert.equal(diag.dbValueShape, "usable_values");
    assert.equal(diag.hasUsableValues, true);
    assert.equal(diag.rendererWouldShow, true);
    assert.equal(diag.rendererWouldShowEditPreview, true);
    assert.equal(diag.reasonCode, "OK");
    assert.deepEqual(diag.missingKeys, []);
  });

  it("reports invalid stored JSON as a parse failure", () => {
    const diag = diagnoseStatusWidgetValues({
      resolved,
      statusWidgetTurnActive: true,
      values: {},
      model: "deepseek",
      invalidJson: true,
    });

    assert.equal(diag.dbValueShape, "invalid_json");
    assert.equal(diag.hasUsableValues, false);
    assert.equal(diag.rendererWouldShow, false);
    assert.equal(diag.rendererWouldShowEditPreview, false);
    assert.equal(diag.reasonCode, "V3_PARSE_FAILED");
  });

  it("normalizes machine aliases to configured widget keys", () => {
    const diag = diagnoseStatusWidgetValues({
      resolved,
      statusWidgetTurnActive: true,
      values: {
        character: {
          scene_time: "14:30",
          thought: "경계 중",
          situation: "복도 이동 중",
        },
      },
      model: "deepseek",
    });

    assert.equal(diag.reasonCode, "OK");
    assert.ok(diag.normalizedKeys.includes("time"));
    assert.ok(diag.normalizedKeys.includes("inner_thought"));
    assert.ok(diag.normalizedKeys.includes("current_situation"));
  });
});
