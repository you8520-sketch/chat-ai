import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_INFO_STICKY_NO_PORTRAIT_CLASS,
  CHAT_MESSAGES_COLUMN_NO_PORTRAIT_CLASS,
  CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS,
  CHAT_MOBILE_PORTRAIT_IMAGE_CLASS,
  CHAT_MESSAGES_COLUMN_CLASS,
  CHAT_PORTRAIT_DESKTOP_TRACK_CLASS,
  CHAT_PORTRAIT_GRID_CLASS,
  CHAT_PORTRAIT_INFO_STICKY_CLASS,
  CHAT_PORTRAIT_INFO_STICKY_INNER_CLASS,
  CHAT_PORTRAIT_STICKY_CLASS,
  CHAT_ROOM_HEADER_OFFSET_CLASS,
  normalizePortraitBackgroundOpacity,
} from "@/lib/chatDisplayPrefs";

describe("mobile chat portrait background", () => {

  it("uses a wider desktop portrait column to reduce horizontal crop", () => {
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /mx-auto/);
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /max-w-\[75\.25rem\]/);
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /minmax\(340px,400px\)/);
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /minmax\(0,780px\)/);
  });

  it("keeps desktop portrait and messages below the fixed character info row", () => {
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /sm:grid-rows-\[auto_minmax\(0,1fr\)\]/);
    assert.match(CHAT_PORTRAIT_STICKY_CLASS, /sm:row-start-2/);
    assert.match(CHAT_MESSAGES_COLUMN_CLASS, /sm:row-start-2/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /sm:row-start-1/);
    assert.match(
      CHAT_ROOM_HEADER_OFFSET_CLASS,
      /md:top-\[calc\(var\(--site-header-height,44px\)\+3\.25rem\)\]/
    );
  });

  it("does not use overflow-hidden on mobile messages column (keeps composer sticky)", () => {
    assert.doesNotMatch(CHAT_MESSAGES_COLUMN_CLASS, /overflow-hidden/);
    assert.doesNotMatch(CHAT_MESSAGES_COLUMN_CLASS, /overflow-y-/);
    assert.match(CHAT_MESSAGES_COLUMN_CLASS, /overflow-x-clip/);
  });

  it("keeps sticky name/album strip full-grid with album in the portrait track", () => {
    // Outer strip spans both columns (sticky tab above chat); inner track matches
    // the portrait grid so name/creator/album stay on the asset column top-right.
    // sm:block is required — without it `hidden` stays display:none and the tab never shows.
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /\bhidden\b/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /\bsm:block\b/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /sm:col-span-2/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /sm:sticky/);
    assert.match(CHAT_PORTRAIT_STICKY_CLASS, /\bhidden\b/);
    assert.match(CHAT_PORTRAIT_STICKY_CLASS, /\bsm:flex\b/);
    assert.match(CHAT_PORTRAIT_DESKTOP_TRACK_CLASS, /minmax\(340px,400px\)/);
    assert.match(CHAT_PORTRAIT_DESKTOP_TRACK_CLASS, /minmax\(0,780px\)/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_INNER_CLASS, /minmax\(340px,400px\)/);
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /minmax\(340px,400px\)/);
  });

  it("keeps desktop name/creator/album sticky when portrait assets are off", () => {
    assert.match(CHAT_INFO_STICKY_NO_PORTRAIT_CLASS, /\bhidden\b/);
    assert.match(CHAT_INFO_STICKY_NO_PORTRAIT_CLASS, /\bsm:flex\b/);
    assert.match(CHAT_INFO_STICKY_NO_PORTRAIT_CLASS, /\bsm:sticky\b/);
    assert.match(CHAT_INFO_STICKY_NO_PORTRAIT_CLASS, /sm:top-\[var\(--site-header-height,44px\)\]/);
    assert.match(CHAT_INFO_STICKY_NO_PORTRAIT_CLASS, /max-w-\[780px\]/);
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
