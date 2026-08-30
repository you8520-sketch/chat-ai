import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import {
  displayModeFromVisibilityToggles,
  displayVisibilityFromMode,
} from "./displayVisibilityToggles";
import {
  orderedWidgetsForRender,
  resolveStatusWidgetTurn,
  statusWidgetModeFromToggles,
  statusWidgetTogglesFromMode,
} from "./resolve";
import { displayModeFromEngineMode, serializeStatusWidget } from "./serialize";
import { resolveStatusWidgetSettingsWrite } from "./settingsWrite";
import type { StatusWidgetDisplayMode, StatusWidgetSourceMode } from "./types";

const creatorJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
const userJson = serializeStatusWidget({
  ...DEFAULT_STATUS_WIDGET,
  name: "내 커스텀",
  fields: [{ id: "my_note", label: "메모", instruction: "표시용 메모" }],
});

const ENGINE_MODES: StatusWidgetSourceMode[] = [
  "off",
  "character_only",
  "user_only",
  "both",
];
const DISPLAY_MODES: StatusWidgetDisplayMode[] = [
  "creator",
  "user",
  "both",
  "hidden",
];

describe("status widget display visibility toggles (UI mapping owner)", () => {
  it("round-trips every canonical display mode through visibility toggles", () => {
    for (const mode of DISPLAY_MODES) {
      const visibility = displayVisibilityFromMode(mode);
      const roundTrip = displayModeFromVisibilityToggles(
        visibility.creatorVisible,
        visibility.userVisible
      );
      assert.equal(roundTrip, mode, `mode ${mode}`);
    }
  });

  it("maps boolean pairs to canonical display modes", () => {
    assert.equal(displayModeFromVisibilityToggles(true, false), "creator");
    assert.equal(displayModeFromVisibilityToggles(false, true), "user");
    assert.equal(displayModeFromVisibilityToggles(true, true), "both");
    assert.equal(displayModeFromVisibilityToggles(false, false), "hidden");
  });

  it("T1: tracking change only leaves stored display preference unchanged", () => {
    const storedDisplay: StatusWidgetDisplayMode = "user";
    const trackingOnly = resolveStatusWidgetSettingsWrite({
      storedMode: "both",
      storedDisplay,
      incomingMode: "character_only",
    });
    assert.equal(trackingOnly.ok, true);
    if (!trackingOnly.ok) return;
    assert.equal(trackingOnly.nextDisplay, storedDisplay);
    assert.equal(trackingOnly.nextMode, "character_only");
  });

  it("T2: display change only leaves engine/tracking unchanged", () => {
    const storedMode: StatusWidgetSourceMode = "both";
    const displayOnly = resolveStatusWidgetSettingsWrite({
      storedMode,
      storedDisplay: "both",
      incomingDisplay: "hidden",
    });
    assert.equal(displayOnly.ok, true);
    if (!displayOnly.ok) return;
    assert.equal(displayOnly.nextMode, storedMode);
    assert.equal(displayOnly.nextDisplay, "hidden");
  });

  it("T3: tracking both + display user → creator extraction active, render user only", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "user",
    });
    assert.equal(resolved.needsCharacterValues, true);
    assert.equal(resolved.needsUserValues, true);
    const rendered = orderedWidgetsForRender(resolved, {
      character: { time: "1" },
      user: { my_note: "x" },
    });
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0]?.source, "user");
  });

  it("T4: tracking both + display hidden → both extraction active, render none", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "hidden",
    });
    assert.equal(resolved.needsCharacterValues, true);
    assert.equal(resolved.needsUserValues, true);
    assert.deepEqual(
      orderedWidgetsForRender(resolved, {
        character: { time: "1" },
        user: { my_note: "x" },
      }),
      []
    );
  });

  it("T5: creator tracking only + display both preference clamps render fail-closed", () => {
    const resolved = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "character_only",
      displayMode: "both",
    });
    assert.equal(resolved.mode, "character_only");
    assert.equal(resolved.needsUserValues, false);
    const rendered = orderedWidgetsForRender(resolved, {
      character: { time: "1" },
      user: { my_note: "x" },
    });
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0]?.source, "character");
  });

  it("T6/T7: engine toggles remain independent per source availability", () => {
    assert.equal(statusWidgetModeFromToggles(false, false), "off");
    assert.equal(statusWidgetModeFromToggles(true, false), "character_only");
    assert.equal(statusWidgetModeFromToggles(false, true), "user_only");
    assert.equal(statusWidgetModeFromToggles(true, true), "both");
    assert.deepEqual(statusWidgetTogglesFromMode("both"), {
      creatorOn: true,
      userOn: true,
    });
  });

  it("T8: save mapping preserves exact tracking + display via settings write owner", () => {
    const saved = resolveStatusWidgetSettingsWrite({
      storedMode: "off",
      storedDisplay: "hidden",
      incomingMode: "both",
      incomingDisplay: "user",
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.nextMode, "both");
    assert.equal(saved.nextDisplay, "user");
  });

  it("T9: legacy null display one-way init from engine unchanged", () => {
    for (const mode of ENGINE_MODES) {
      const init = resolveStatusWidgetSettingsWrite({
        storedMode: mode,
        storedDisplay: null,
      });
      assert.equal(init.ok, true);
      if (!init.ok) return;
      assert.equal(init.nextDisplay, displayModeFromEngineMode(mode));
      assert.equal(init.legacyDisplayInit, true);
    }
  });

  it("settings UI uses source-centric matrix and canonical display toggle mapping", () => {
    const uiSrc = readFileSync(
      new URL("../../components/StatusWidgetChatSettings.tsx", import.meta.url),
      "utf8"
    );
    assert.match(uiSrc, /displayVisibilityFromMode/);
    assert.match(uiSrc, /displayModeFromVisibilityToggles/);
    assert.match(uiSrc, /statusWidgetModeFromToggles/);
    assert.match(uiSrc, /statusWidgetDisplayMode: displayMode/);
    assert.doesNotMatch(uiSrc, /DISPLAY_OPTIONS/);
    assert.doesNotMatch(uiSrc, /statusWidgetDisplayMode: effectiveDisplay/);
  });
});
