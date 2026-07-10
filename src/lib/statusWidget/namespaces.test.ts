import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import {
  isCreatorProtectedKey,
  mergeNamespacedStatusValues,
  namespacedStatusSnapshot,
} from "./namespaces";
import { orderedWidgetsForRender, resolveStatusWidgetTurn } from "./resolve";
import { serializeStatusWidget } from "./serialize";

const characterWidgetJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
const userWidgetJson = serializeStatusWidget({
  ...DEFAULT_STATUS_WIDGET,
  name: "내 커스텀",
  fields: [
    { id: "my_note", label: "메모", instruction: "표시용 메모" },
    { id: "display_mood", label: "기분", instruction: "표시용 기분" },
  ],
});

describe("resolveStatusWidgetTurn — display vs engine", () => {
  it("keeps creator needsCharacterValues when user custom display is selected", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson,
      userWidgetJson,
      chatMode: "both",
      displayMode: "user",
    });
    assert.equal(resolved.needsCharacterValues, true);
    assert.ok(resolved.characterWidget);
    assert.equal(resolved.displayMode, "user");
    assert.equal(resolved.mode, "both");
  });

  it("keeps creator needsCharacterValues when UI is hidden", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson,
      userWidgetJson,
      chatMode: "character_only",
      displayMode: "hidden",
    });
    assert.equal(resolved.needsCharacterValues, true);
    assert.ok(resolved.characterWidget);
    assert.equal(resolved.active, true);
    assert.equal(resolved.displayMode, "hidden");
    assert.equal(orderedWidgetsForRender(resolved, { character: { time: "1" } }).length, 0);
  });

  it("forces creator on when legacy mode is off", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson,
      chatMode: "off",
      displayMode: "hidden",
    });
    assert.equal(resolved.needsCharacterValues, true);
    assert.equal(resolved.mode, "character_only");
  });

  it("upgrades user_only to both when character widget exists", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson,
      userWidgetJson,
      chatMode: "user_only",
      displayMode: "user",
    });
    assert.equal(resolved.mode, "both");
    assert.equal(resolved.needsCharacterValues, true);
  });

  it("display option changes only rendered widgets, not engine flags", () => {
    const engine = resolveStatusWidgetTurn({
      characterWidgetJson,
      userWidgetJson,
      displayMode: "both",
    });
    const hidden = resolveStatusWidgetTurn({
      characterWidgetJson,
      userWidgetJson,
      displayMode: "hidden",
    });
    assert.equal(engine.needsCharacterValues, true);
    assert.equal(hidden.needsCharacterValues, true);
    assert.ok(orderedWidgetsForRender(engine, {}).length >= 1);
    assert.equal(orderedWidgetsForRender(hidden, {}).length, 0);
  });
});

describe("namespaces — creator vs user", () => {
  it("does not let user overwrite protected creator keys", () => {
    const merged = mergeNamespacedStatusValues({
      character: { d_day: "3", affection: "40", trust: "10" },
      user: { d_day: "999", affection: "0", my_note: "hello" },
    });
    assert.equal(merged.creator.d_day, "3");
    assert.equal(merged.creator.affection, "40");
    assert.equal(merged.user.my_note, "hello");
    assert.equal(merged.user.d_day, undefined);
    assert.equal(merged.creatorForTriggers.d_day, "3");
    assert.equal(merged.creatorForTriggers["creator.d_day"], "3");
  });

  it("namespaces do not collide in snapshot", () => {
    const snap = namespacedStatusSnapshot({
      character: { affection: "50" },
      user: { display_mood: "calm" },
    });
    assert.equal(snap["creator.affection"], "50");
    assert.equal(snap["user.display_mood"], "calm");
    assert.equal(snap.affection, undefined);
  });

  it("identifies protected creator keys", () => {
    assert.equal(isCreatorProtectedKey("d_day"), true);
    assert.equal(isCreatorProtectedKey("creator.trust"), true);
    assert.equal(isCreatorProtectedKey("my_note"), false);
  });
});
