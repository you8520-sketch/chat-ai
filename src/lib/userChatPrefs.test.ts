import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildUserChatPrefsPayload,
  parseUserChatPrefs,
  serializeUserChatPrefs,
} from "@/lib/userChatPrefs";
import { DEFAULT_CHAT_DISPLAY_PREFS } from "@/lib/chatDisplayPrefs";

const { assetDisplayMode: _omitEnum, ...LEGACY_DISPLAY_DEFAULTS } = DEFAULT_CHAT_DISPLAY_PREFS;

function legacyRaw(displayPrefs: Record<string, unknown>): string {
  return JSON.stringify({
    v: 1,
    targetResponseChars: 1200,
    novelModeEnabled: false,
    displayPrefs,
  });
}

describe("server chat prefs parse/serialize", () => {
  it("round-trips the canonical display prefs", () => {
    const prefs = buildUserChatPrefsPayload({
      targetResponseChars: 1200,
      novelModeEnabled: true,
      userNote: "",
      displayPrefs: { ...DEFAULT_CHAT_DISPLAY_PREFS, assetDisplayMode: "inline" },
    });
    const parsed = parseUserChatPrefs(serializeUserChatPrefs(prefs));
    assert.ok(parsed);
    assert.equal(parsed.displayPrefs.assetDisplayMode, "inline");
    assert.equal(parsed.novelModeEnabled, true);
    assert.equal(parsed.targetResponseChars, prefs.targetResponseChars);
  });

  it("migrates legacy displayPrefs booleans (true → left, false → off)", () => {
    const on = parseUserChatPrefs(
      legacyRaw({ ...LEGACY_DISPLAY_DEFAULTS, showCharacterPortrait: true })
    );
    const off = parseUserChatPrefs(
      legacyRaw({ ...LEGACY_DISPLAY_DEFAULTS, showCharacterPortrait: false })
    );
    assert.equal(on?.displayPrefs.assetDisplayMode, "left");
    assert.equal(off?.displayPrefs.assetDisplayMode, "off");
  });

  it("prefers a valid enum over a conflicting legacy boolean", () => {
    const parsed = parseUserChatPrefs(
      legacyRaw({
        ...LEGACY_DISPLAY_DEFAULTS,
        assetDisplayMode: "inline",
        showCharacterPortrait: false,
      })
    );
    assert.equal(parsed?.displayPrefs.assetDisplayMode, "inline");
  });

  it("drops removed legacy keys from the canonical serialized JSON", () => {
    const raw = legacyRaw({
      ...LEGACY_DISPLAY_DEFAULTS,
      showCharacterPortrait: false,
      portraitBackgroundOpacity: 0.5,
    });
    const parsed = parseUserChatPrefs(raw);
    assert.ok(parsed);
    const serialized = serializeUserChatPrefs(parsed);
    const out = JSON.parse(serialized) as {
      displayPrefs: Record<string, unknown>;
    };
    assert.equal("showCharacterPortrait" in out.displayPrefs, false);
    assert.equal("portraitBackgroundOpacity" in out.displayPrefs, false);
    assert.equal(out.displayPrefs.assetDisplayMode, "off");
  });

  it("falls back to the default mode when displayPrefs is missing", () => {
    const parsed = parseUserChatPrefs(
      JSON.stringify({ v: 1, targetResponseChars: 1200, novelModeEnabled: false })
    );
    assert.equal(parsed?.displayPrefs.assetDisplayMode, "left");
  });
});
