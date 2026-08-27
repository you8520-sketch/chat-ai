import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { renderStatusWidgetHtml } from "./render";
import { orderedWidgetsForRender, resolveStatusWidgetTurn } from "./resolve";
import { serializeStatusWidget } from "./serialize";

describe("orderedWidgetsForRender", () => {
  it("renders character widget with preview values when turn values are missing", () => {
    const characterWidgetJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson,
      chatMode: "character_only",
    });

    assert.equal(resolved.active, true);

    const items = orderedWidgetsForRender(resolved, {});
    assert.equal(items.length, 1);
    assert.equal(items[0]?.source, "character");
    const html = renderStatusWidgetHtml(items[0]!.widget, items[0]!.values);
    assert.match(html, /—/);
    assert.doesNotMatch(html, /14:30/);
  });
});

describe("resolveStatusWidgetTurn — fail-closed engine", () => {
  it("keeps off when creator widget exists", () => {
    const characterWidgetJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson,
      chatMode: "off",
    });
    assert.equal(resolved.active, false);
    assert.equal(resolved.mode, "off");
    assert.equal(resolved.requestedMode, "off");
    assert.equal(resolved.needsCharacterValues, false);
    assert.equal(resolved.needsUserValues, false);
  });

  it("does not upgrade user_only to creator/both", () => {
    const characterWidgetJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
    const userWidgetJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson,
      userWidgetJson,
      chatMode: "user_only",
    });
    assert.equal(resolved.mode, "user_only");
    assert.equal(resolved.needsCharacterValues, false);
    assert.equal(resolved.needsUserValues, true);
  });
});
