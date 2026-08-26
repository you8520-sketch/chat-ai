import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import { resolveStatusWidgetSettingsWrite } from "./settingsWrite";

describe("status widget settings write owner", () => {
  it("writes mode and display independently", () => {
    const modeOnly = resolveStatusWidgetSettingsWrite({
      storedMode: "both",
      storedDisplay: "user",
      incomingMode: "character_only",
    });
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
    assert.equal(init.nextMode, "off");
    assert.equal(init.nextDisplay, "hidden");
    assert.equal(init.legacyDisplayInit, true);
    assert.equal(init.writeDisplay, true);
    assert.equal(init.writeMode, true);
  });

  it("settings route uses the write helper and never engineModeForDisplay", () => {
    const settingsSrc = readFileSync(
      new URL("../../app/api/chat/settings/route.ts", import.meta.url),
      "utf8"
    );
    assert.match(settingsSrc, /resolveStatusWidgetSettingsWrite\(/);
    assert.doesNotMatch(settingsSrc, /engineModeForDisplay\(/);
    assert.match(settingsSrc, /settingsWrite\.writeMode/);
    assert.match(settingsSrc, /settingsWrite\.writeDisplay/);
  });
});
