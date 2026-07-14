import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_MESSAGES_COLUMN_NO_PORTRAIT_CLASS,
  CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS,
  CHAT_MOBILE_PORTRAIT_IMAGE_CLASS,
  CHAT_PORTRAIT_GRID_CLASS,
  normalizePortraitBackgroundOpacity,
} from "@/lib/chatDisplayPrefs";

describe("mobile chat portrait background", () => {

  it("uses a narrower centered desktop portrait/chat ratio", () => {
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /mx-auto/);
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /max-w-\[70\.25rem\]/);
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /minmax\(280px,320px\)/);
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /minmax\(0,780px\)/);
  });

  it("centers and narrows chat when portrait assets are off", () => {
    assert.match(CHAT_MESSAGES_COLUMN_NO_PORTRAIT_CLASS, /mx-auto/);
    assert.match(CHAT_MESSAGES_COLUMN_NO_PORTRAIT_CLASS, /max-w-\[780px\]/);
  });
  it("uses stable viewport geometry instead of message-list geometry", () => {
    assert.match(CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS, /\bfixed\b/);
    assert.match(CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS, /h-\[100svh\]/);
    assert.match(CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS, /w-\[100svw\]/);
    assert.match(CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS, /pointer-events-none/);
    assert.match(CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS, /select-none/);
    assert.doesNotMatch(CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS, /\babsolute\b/);
  });

  it("keeps image crop fixed and changes opacity only", () => {
    assert.match(CHAT_MOBILE_PORTRAIT_IMAGE_CLASS, /\bh-full\b/);
    assert.match(CHAT_MOBILE_PORTRAIT_IMAGE_CLASS, /\bw-full\b/);
    assert.match(CHAT_MOBILE_PORTRAIT_IMAGE_CLASS, /object-cover/);
    assert.match(CHAT_MOBILE_PORTRAIT_IMAGE_CLASS, /object-top/);
    assert.match(CHAT_MOBILE_PORTRAIT_IMAGE_CLASS, /opacity-\[var\(--mobile-portrait-opacity\)\]/);
    assert.doesNotMatch(CHAT_MOBILE_PORTRAIT_IMAGE_CLASS, /transition|animate|transform|scale/);
  });

  it("supports the full saved opacity range", () => {
    assert.equal(normalizePortraitBackgroundOpacity(-1), 0);
    assert.equal(normalizePortraitBackgroundOpacity(0), 0);
    assert.equal(normalizePortraitBackgroundOpacity(0.2), 0.2);
    assert.equal(normalizePortraitBackgroundOpacity(0.5), 0.5);
    assert.equal(normalizePortraitBackgroundOpacity(0.8), 0.8);
    assert.equal(normalizePortraitBackgroundOpacity(1), 1);
    assert.equal(normalizePortraitBackgroundOpacity(2), 1);
  });
});
