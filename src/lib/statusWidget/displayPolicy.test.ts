import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  shouldShowStatusWidgetOnMessage,
  statusWidgetValuesHasContent,
} from "@/lib/statusWidget/displayPolicy";

describe("shouldShowStatusWidgetOnMessage", () => {
  it("shows when turn flag is true and values exist", () => {
    assert.equal(
      shouldShowStatusWidgetOnMessage({
        model: "deepseek",
        statusWidgetTurnActive: true,
        statusWidgetValues: { character: { 시간: "14:30" } },
      }),
      true
    );
  });

  it("hides when turn flag is true but values are empty", () => {
    assert.equal(
      shouldShowStatusWidgetOnMessage({
        model: "deepseek",
        statusWidgetTurnActive: true,
        statusWidgetValues: {},
      }),
      false
    );
  });

  it("hides when turn flag is false and no saved values", () => {
    assert.equal(
      shouldShowStatusWidgetOnMessage({
        model: "deepseek",
        statusWidgetTurnActive: false,
        statusWidgetValues: {},
      }),
      false
    );
  });

  it("hides greeting and streaming", () => {
    assert.equal(
      shouldShowStatusWidgetOnMessage({
        model: "greeting",
        statusWidgetTurnActive: true,
      }),
      false
    );
    assert.equal(
      shouldShowStatusWidgetOnMessage({
        model: "deepseek",
        statusWidgetTurnActive: true,
        isStreaming: true,
      }),
      false
    );
  });

  it("legacy: shows when values exist without turn flag", () => {
    assert.equal(
      shouldShowStatusWidgetOnMessage({
        model: "deepseek",
        statusWidgetValues: { character: { time: "14:30" } },
      }),
      true
    );
  });
});

describe("statusWidgetValuesHasContent", () => {
  it("ignores placeholder-only values", () => {
    assert.equal(
      statusWidgetValuesHasContent({ character: { time: "—", place: "…" } }),
      false
    );
  });
});
