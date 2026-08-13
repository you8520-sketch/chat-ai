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
  DEFAULT_CHAT_DISPLAY_PREFS,
  formatStreamIntervalLabel,
  normalizeStreamIntervalMs,
  normalizePortraitBackgroundOpacity,
  normalizeShowCharacterPortrait,
  normalizeShowSuggestedReplies,
  resolveClientDisplayPrefs,
} from "@/lib/chatDisplayPrefs";

describe("chat streaming speed presets", () => {
  it("defaults new users to fast streaming", () => {
    assert.equal(DEFAULT_CHAT_DISPLAY_PREFS.streamIntervalMs, 20);
    assert.equal(formatStreamIntervalLabel(DEFAULT_CHAT_DISPLAY_PREFS.streamIntervalMs), "빠름");
  });

  it("maps legacy millisecond values to one of the four named presets", () => {
    assert.equal(normalizeStreamIntervalMs(0), 0);
    assert.equal(normalizeStreamIntervalMs(40), 20);
    assert.equal(normalizeStreamIntervalMs(60), 60);
    assert.equal(normalizeStreamIntervalMs(80), 60);
    assert.equal(normalizeStreamIntervalMs(100), 100);
    assert.equal(formatStreamIntervalLabel(0), "즉시");
    assert.equal(formatStreamIntervalLabel(60), "보통");
    assert.equal(formatStreamIntervalLabel(100), "느림");
  });
});

describe("showSuggestedReplies persistence", () => {
  it("defaults on and keeps explicit false", () => {
    assert.equal(DEFAULT_CHAT_DISPLAY_PREFS.showSuggestedReplies, true);
    assert.equal(normalizeShowSuggestedReplies(false), false);
    assert.equal(normalizeShowSuggestedReplies(true), true);
    assert.equal(normalizeShowSuggestedReplies(undefined), true);
  });
});

describe("showCharacterPortrait persistence", () => {
  it("keeps explicit false (OFF) instead of coercing to default ON", () => {
    assert.equal(normalizeShowCharacterPortrait(false), false);
    assert.equal(normalizeShowCharacterPortrait(true), true);
    assert.equal(normalizeShowCharacterPortrait(undefined), true);
  });

  it("prefers localStorage OFF over server default ON", () => {
    const store = new Map<string, string>();
    const g = globalThis as typeof globalThis & {
      window?: unknown;
      localStorage?: Storage;
    };
    const prevWindow = g.window;
    const prevStorage = g.localStorage;
    g.window = g;
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: () => null,
      get length() {
        return store.size;
      },
    };
    try {
      store.set(
        "playai-chat-display-prefs",
        JSON.stringify({ ...DEFAULT_CHAT_DISPLAY_PREFS, showCharacterPortrait: false })
      );
      const resolved = resolveClientDisplayPrefs({
        ...DEFAULT_CHAT_DISPLAY_PREFS,
        showCharacterPortrait: true,
      });
      assert.equal(resolved.showCharacterPortrait, false);
    } finally {
      g.window = prevWindow;
      g.localStorage = prevStorage;
    }
  });
});

describe("mobile chat portrait background", () => {

  it("uses a wider desktop portrait column to reduce horizontal crop", () => {
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /mx-auto/);
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /max-w-\[75\.25rem\]/);
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /minmax\(340px,400px\)/);
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /minmax\(0,780px\)/);
  });

  it("keeps desktop portrait and messages below the fixed character info row", () => {
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /min-\[576px\]:grid-rows-\[auto_minmax\(0,1fr\)\]/);
    assert.match(CHAT_PORTRAIT_STICKY_CLASS, /min-\[576px\]:row-start-2/);
    assert.match(CHAT_MESSAGES_COLUMN_CLASS, /min-\[576px\]:row-start-2/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /min-\[576px\]:row-start-1/);
    assert.match(
      CHAT_ROOM_HEADER_OFFSET_CLASS,
      /min-\[576px\]:top-\[calc\(var\(--site-header-height,44px\)\+3\.25rem\)\]/
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
    // Semantic class + min-[576px]:block — globals.css also forces display as fallback.
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /chat-room-desktop-name-strip/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /\bhidden\b/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /min-\[576px\]:block/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /min-\[576px\]:col-span-2/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /min-\[576px\]:sticky/);
    assert.match(CHAT_PORTRAIT_STICKY_CLASS, /chat-room-portrait-rail/);
    assert.match(CHAT_PORTRAIT_STICKY_CLASS, /\bhidden\b/);
    assert.match(CHAT_PORTRAIT_STICKY_CLASS, /min-\[576px\]:flex/);
    assert.match(CHAT_PORTRAIT_DESKTOP_TRACK_CLASS, /minmax\(340px,400px\)/);
    assert.match(CHAT_PORTRAIT_DESKTOP_TRACK_CLASS, /minmax\(0,780px\)/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_INNER_CLASS, /chat-room-portrait-track/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_INNER_CLASS, /minmax\(340px,400px\)/);
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /chat-room-portrait-grid/);
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /minmax\(340px,400px\)/);
    assert.match(CHAT_MESSAGES_COLUMN_CLASS, /chat-room-messages-column/);
    assert.match(CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS, /chat-room-mobile-portrait-bg/);
  });

  it("keeps desktop name/creator/album sticky when portrait assets are off", () => {
    assert.match(CHAT_INFO_STICKY_NO_PORTRAIT_CLASS, /chat-room-desktop-name-strip/);
    assert.match(CHAT_INFO_STICKY_NO_PORTRAIT_CLASS, /chat-room-desktop-name-strip--row/);
    assert.match(CHAT_INFO_STICKY_NO_PORTRAIT_CLASS, /\bhidden\b/);
    assert.match(CHAT_INFO_STICKY_NO_PORTRAIT_CLASS, /min-\[576px\]:flex/);
    assert.match(CHAT_INFO_STICKY_NO_PORTRAIT_CLASS, /min-\[576px\]:sticky/);
    assert.match(
      CHAT_INFO_STICKY_NO_PORTRAIT_CLASS,
      /min-\[576px\]:top-\[var\(--site-header-height,44px\)\]/
    );
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
