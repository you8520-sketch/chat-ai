import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import {
  parseIncomingStatusWidgetDisplayMode,
  parseIncomingStatusWidgetMode,
} from "./serialize";
import { resolveStatusWidgetSettingsWrite } from "./settingsWrite";

describe("status widget settings write owner", () => {
  it("writes mode and display independently", () => {
    const modeOnly = resolveStatusWidgetSettingsWrite({
      storedMode: "both",
      storedDisplay: "user",
      incomingMode: "character_only",
    });
    assert.equal(modeOnly.ok, true);
    if (!modeOnly.ok) return;
    assert.equal(modeOnly.nextMode, "character_only");
    assert.equal(modeOnly.nextDisplay, "user");
    assert.equal(modeOnly.writeMode, true);
    assert.equal(modeOnly.writeDisplay, false);
    assert.equal(modeOnly.legacyDisplayInit, false);

    const displayOnly = resolveStatusWidgetSettingsWrite({
      storedMode: "both",
      storedDisplay: "user",
      incomingDisplay: "hidden",
    });
    assert.equal(displayOnly.ok, true);
    if (!displayOnly.ok) return;
    assert.equal(displayOnly.nextMode, "both");
    assert.equal(displayOnly.nextDisplay, "hidden");
    assert.equal(displayOnly.writeMode, false);
    assert.equal(displayOnly.writeDisplay, true);
  });

  it("omitted field preserves stored value and does not derive engine from display", () => {
    const preserved = resolveStatusWidgetSettingsWrite({
      storedMode: "user_only",
      storedDisplay: "both",
    });
    assert.equal(preserved.ok, true);
    if (!preserved.ok) return;
    assert.equal(preserved.nextMode, "user_only");
    assert.equal(preserved.nextDisplay, "both");
    assert.equal(preserved.writeMode, false);
    assert.equal(preserved.writeDisplay, false);
  });

  it("legacy null display one-way inits from engine only", () => {
    const init = resolveStatusWidgetSettingsWrite({
      storedMode: "character_only",
      storedDisplay: null,
      incomingMode: "off",
    });
    assert.equal(init.ok, true);
    if (!init.ok) return;
    assert.equal(init.nextMode, "off");
    assert.equal(init.nextDisplay, "hidden");
    assert.equal(init.legacyDisplayInit, true);
    assert.equal(init.writeDisplay, true);
    assert.equal(init.writeMode, true);
  });

  it("rejects invalid explicit incoming mode and display", () => {
    const badMode = resolveStatusWidgetSettingsWrite({
      storedMode: "both",
      storedDisplay: "user",
      incomingMode: "character_only_typo",
    });
    assert.equal(badMode.ok, false);
    if (badMode.ok) return;
    assert.equal(badMode.field, "statusWidgetMode");

    const badDisplay = resolveStatusWidgetSettingsWrite({
      storedMode: "both",
      storedDisplay: "user",
      incomingDisplay: "creator_and_user",
    });
    assert.equal(badDisplay.ok, false);
    if (badDisplay.ok) return;
    assert.equal(badDisplay.field, "statusWidgetDisplayMode");
  });

  it("strict incoming parsers reject invalid values", () => {
    assert.equal(parseIncomingStatusWidgetMode("both"), "both");
    assert.equal(parseIncomingStatusWidgetMode(undefined), null);
    assert.equal(parseIncomingStatusWidgetMode("character_only_typo"), null);
    assert.equal(parseIncomingStatusWidgetDisplayMode("hidden"), "hidden");
    assert.equal(parseIncomingStatusWidgetDisplayMode(1), null);
    assert.equal(parseIncomingStatusWidgetDisplayMode("both_and_hidden"), null);
  });

  it("settings route uses atomic persist and never engineModeForDisplay", () => {
    const settingsSrc = readFileSync(
      new URL("../../app/api/chat/settings/route.ts", import.meta.url),
      "utf8"
    );
    assert.match(settingsSrc, /resolveStatusWidgetSettingsWrite\(/);
    assert.match(settingsSrc, /persistChatSettingsWithCreatorTriggerSupersede\(/);
    assert.doesNotMatch(settingsSrc, /engineModeForDisplay\(/);
    assert.doesNotMatch(settingsSrc, /supersedeUnconsumedStatusTriggerEventsForKeys/);
    assert.match(settingsSrc, /settingsWrite\.writeMode/);
    assert.match(settingsSrc, /settingsWrite\.writeDisplay/);
  });

  it("UI persists requested display preference, not clamped effective display", () => {
    const uiSrc = readFileSync(
      new URL("../../components/StatusWidgetChatSettings.tsx", import.meta.url),
      "utf8"
    );
    assert.match(uiSrc, /effectiveDisplay/);
    assert.match(uiSrc, /statusWidgetDisplayMode: displayMode/);
    assert.doesNotMatch(uiSrc, /statusWidgetDisplayMode: effectiveDisplay/);
    assert.doesNotMatch(uiSrc, /statusWidgetDisplayMode: resolvedDisplay/);
  });
});
