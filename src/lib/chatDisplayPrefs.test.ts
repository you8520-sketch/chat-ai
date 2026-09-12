import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CHAT_ASSET_DISPLAY_MODE_LABELS,
  CHAT_ASSET_DISPLAY_MODE_LABELS_MOBILE,
  CHAT_ASSET_DISPLAY_MODES,
  CHAT_INFO_STICKY_NO_PORTRAIT_CLASS,
  CHAT_INLINE_ASSET_FIGURE_CLASS,
  CHAT_INLINE_ASSET_IMG_CLASS,
  CHAT_MESSAGES_COLUMN_NO_PORTRAIT_CLASS,
  CHAT_MESSAGES_COLUMN_CLASS,
  CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS,
  CHAT_MOBILE_PORTRAIT_IMAGE_CLASS,
  CHAT_PORTRAIT_CHAT_COLUMN_CLASS,
  CHAT_PORTRAIT_COLUMN_CLASS,
  CHAT_PORTRAIT_DESKTOP_TRACK_CLASS,
  CHAT_PORTRAIT_GRID_CLASS,
  CHAT_PORTRAIT_GRID_MAX_WIDTH_CLASS,
  CHAT_PORTRAIT_INFO_HEADER_CHAT_CLASS,
  CHAT_PORTRAIT_INFO_STICKY_CLASS,
  CHAT_PORTRAIT_PANEL_IMG_CLASS,
  CHAT_PORTRAIT_PANEL_MAX_WIDTH_CLASS,
  CHAT_PORTRAIT_SIDE,
  CHAT_PORTRAIT_STICKY_CLASS,
  CHAT_ROOM_HEADER_OFFSET_CLASS,
  CHAT_STREAM_SPEED_PRESETS,
  DEFAULT_CHARACTER_DIALOGUE_COLOR,
  DEFAULT_CHAT_DISPLAY_PREFS,
  LEGACY_CHAT_STREAM_INTERVAL_MS,
  LEGACY_CHARACTER_DIALOGUE_COLOR,
  isChatRoomPathname,
  isCompactRoomPathname,
  formatStreamIntervalLabel,
  loadChatDisplayPrefs,
  normalizeAssetDisplayMode,
  normalizeCharacterDialogueColor,
  normalizePortraitBackgroundOpacity,
  normalizeStreamIntervalMs,
  normalizeShowSuggestedReplies,
  resolveClientDisplayPrefs,
  saveChatDisplayPrefs,
  streamCharsPerTickForInterval,
} from "@/lib/chatDisplayPrefs";

const { assetDisplayMode: _omitEnum, ...LEGACY_LOCAL_DEFAULTS } = DEFAULT_CHAT_DISPLAY_PREFS;

describe("character dialogue theme color", () => {
  it("uses the high-contrast violet theme color by default", () => {
    assert.equal(DEFAULT_CHAT_DISPLAY_PREFS.dialogueColor, "#c4b5fd");
    assert.equal(DEFAULT_CHAT_DISPLAY_PREFS.dialogueColor, DEFAULT_CHARACTER_DIALOGUE_COLOR);
  });

  it("migrates only the legacy orange default and preserves custom colors", () => {
    assert.equal(
      normalizeCharacterDialogueColor(LEGACY_CHARACTER_DIALOGUE_COLOR),
      DEFAULT_CHARACTER_DIALOGUE_COLOR
    );
    assert.equal(normalizeCharacterDialogueColor("#abcdef"), "#abcdef");
    assert.equal(normalizeCharacterDialogueColor("invalid"), DEFAULT_CHARACTER_DIALOGUE_COLOR);
  });
});

describe("compact room pathnames", () => {
  it("keeps chat-room chrome on /chat/:id only", () => {
    assert.equal(isChatRoomPathname("/chat/12"), true);
    assert.equal(isChatRoomPathname("/trpg/12"), false);
    assert.equal(isChatRoomPathname("/trpg"), false);
  });

  it("collapses the desktop global rail on chat and TRPG rooms", () => {
    assert.equal(isCompactRoomPathname("/chat/12"), true);
    assert.equal(isCompactRoomPathname("/trpg/12"), true);
    assert.equal(isCompactRoomPathname("/trpg"), false);
    assert.equal(isCompactRoomPathname("/trpg/join/abcd"), false);
    assert.equal(isCompactRoomPathname("/"), false);
  });

  it("uses the compact helper for rail collapse without expanding chat-room chrome", () => {
    const shell = readFileSync("src/components/SidebarShell.tsx", "utf8");
    const docClass = readFileSync("src/components/ChatRoomDocumentClass.tsx", "utf8");
    const header = readFileSync("src/components/HeaderMainNavRow.tsx", "utf8");
    assert.match(shell, /isCompactRoomPathname/);
    assert.match(shell, /railWidth = collapsed \? 44 : 176/);
    assert.match(docClass, /isChatRoomPathname/);
    assert.doesNotMatch(docClass, /isCompactRoomPathname/);
    assert.match(header, /isChatRoomPathname/);
    assert.doesNotMatch(header, /isCompactRoomPathname/);
  });
});

describe("chat streaming speed presets", () => {
  it("keeps the regular chat speed UI on the shared preset owner", () => {
    const panel = readFileSync("src/components/ChatSettingsPanel.tsx", "utf8");
    const speed = readFileSync("src/components/ChatStreamSpeedSettings.tsx", "utf8");
    assert.match(panel, /ChatStreamSpeedSettings/);
    assert.match(panel, /withStreamSpeed\(displayPrefs, intervalMs\)/);
    assert.match(speed, /CHAT_STREAM_SPEED_PRESETS/);
    assert.match(speed, /title = "스트리밍 속도"/);
    assert.match(speed, /AI 답변이 화면에 나타나는 속도를 선택하세요\. 기본 설정은 빠름입니다\./);
  });

  it("defaults new users to fast streaming", () => {
    const fast = CHAT_STREAM_SPEED_PRESETS.find((p) => p.label === "빠름")!;
    assert.equal(fast.intervalMs, 24);
    assert.equal(DEFAULT_CHAT_DISPLAY_PREFS.streamIntervalMs, 24);
    assert.equal(formatStreamIntervalLabel(DEFAULT_CHAT_DISPLAY_PREFS.streamIntervalMs), "빠름");
  });

  it("keeps one shared owner for chat and TRPG reading speeds", () => {
    assert.deepEqual(
      CHAT_STREAM_SPEED_PRESETS.map((p) => [p.label, p.intervalMs]),
      [
        ["즉시", 0],
        ["빠름", 24],
        ["보통", 40],
      ]
    );
    assert.equal(CHAT_STREAM_SPEED_PRESETS.length, 3);
    assert.equal(streamCharsPerTickForInterval(0), 64);
    assert.equal(streamCharsPerTickForInterval(24), 1);
    assert.equal(streamCharsPerTickForInterval(40), 1);
  });

  it("migrates the previous 빠름/보통/느림 millisecond values by label, not nearest ms", () => {
    assert.equal(normalizeStreamIntervalMs(0), 0);
    assert.equal(normalizeStreamIntervalMs(20), 24);
    assert.equal(normalizeStreamIntervalMs(35), 24);
    assert.equal(normalizeStreamIntervalMs(50), 40);
    assert.equal(normalizeStreamIntervalMs(60), 40);
    assert.equal(normalizeStreamIntervalMs(65), 40);
    assert.equal(normalizeStreamIntervalMs(100), 40);
    assert.equal(normalizeStreamIntervalMs(28), 24);
    assert.equal(normalizeStreamIntervalMs(40), 40);
    assert.equal(LEGACY_CHAT_STREAM_INTERVAL_MS[60], 40);
    assert.notEqual(normalizeStreamIntervalMs(60), 24);
    assert.equal(formatStreamIntervalLabel(0), "즉시");
    assert.equal(formatStreamIntervalLabel(20), "빠름");
    assert.equal(formatStreamIntervalLabel(35), "빠름");
    assert.equal(formatStreamIntervalLabel(50), "보통");
    assert.equal(formatStreamIntervalLabel(60), "보통");
    assert.equal(formatStreamIntervalLabel(65), "보통");
    assert.equal(formatStreamIntervalLabel(100), "보통");
    assert.equal(formatStreamIntervalLabel(28), "빠름");
    assert.equal(formatStreamIntervalLabel(40), "보통");
  });

  it("maps unknown millisecond values to the nearest current preset", () => {
    assert.equal(normalizeStreamIntervalMs(32), 24);
    assert.equal(normalizeStreamIntervalMs(45), 40);
    assert.equal(normalizeStreamIntervalMs(80), 40);
  });

  it("rewrites stored chat prefs so a saved 보통 stays 보통 after the interval retune", () => {
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
        JSON.stringify({ ...DEFAULT_CHAT_DISPLAY_PREFS, streamIntervalMs: 60, streamCharsPerTick: 1 })
      );
      const loaded = loadChatDisplayPrefs();
      assert.equal(loaded.streamIntervalMs, 40);
      assert.equal(formatStreamIntervalLabel(loaded.streamIntervalMs), "보통");
      assert.equal(JSON.parse(store.get("playai-chat-display-prefs") ?? "{}").streamIntervalMs, 40);
    } finally {
      g.window = prevWindow;
      g.localStorage = prevStorage;
    }
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

describe("assetDisplayMode persistence (canonical 3-state)", () => {
  it("defaults to left and keeps valid enum values", () => {
    assert.equal(DEFAULT_CHAT_DISPLAY_PREFS.assetDisplayMode, "left");
    assert.deepEqual([...CHAT_ASSET_DISPLAY_MODES], ["left", "inline", "off"]);
    assert.equal(normalizeAssetDisplayMode("left"), "left");
    assert.equal(normalizeAssetDisplayMode("inline"), "inline");
    assert.equal(normalizeAssetDisplayMode("off"), "off");
  });

  it("maps legacy boolean only as a fallback input", () => {
    assert.equal(normalizeAssetDisplayMode(undefined, true), "left");
    assert.equal(normalizeAssetDisplayMode(undefined, false), "off");
    assert.equal(normalizeAssetDisplayMode(undefined, undefined), "left");
  });

  it("prefers a valid enum over a conflicting legacy boolean", () => {
    assert.equal(normalizeAssetDisplayMode("inline", false), "inline");
    assert.equal(normalizeAssetDisplayMode("off", true), "off");
  });

  it("falls back to the legacy boolean on a malformed enum", () => {
    assert.equal(normalizeAssetDisplayMode("bogus", false), "off");
    assert.equal(normalizeAssetDisplayMode(42, true), "left");
  });

  function withLocalStorage(store: Map<string, string>, run: () => void) {
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
      run();
    } finally {
      g.window = prevWindow;
      g.localStorage = prevStorage;
    }
  }

  it("migrates legacy localStorage boolean (false → off)", () => {
    const store = new Map<string, string>();
    withLocalStorage(store, () => {
      store.set(
        "playai-chat-display-prefs",
        JSON.stringify({ ...LEGACY_LOCAL_DEFAULTS, showCharacterPortrait: false })
      );
      const loaded = loadChatDisplayPrefs();
      assert.equal(loaded.assetDisplayMode, "off");
    });
  });

  it("keeps portraitBackgroundOpacity and drops only removed legacy keys", () => {
    const store = new Map<string, string>();
    withLocalStorage(store, () => {
      store.set(
        "playai-chat-display-prefs",
        JSON.stringify({
          ...LEGACY_LOCAL_DEFAULTS,
          showCharacterPortrait: false,
          portraitBackgroundOpacity: 0.5,
        })
      );
      const loaded = loadChatDisplayPrefs();
      assert.equal(loaded.assetDisplayMode, "off");
      assert.equal(loaded.portraitBackgroundOpacity, 0.5);
      assert.equal("showCharacterPortrait" in loaded, false);
      assert.equal("fontSizePx" in loaded, false);
    });
  });

  it("prefers localStorage mode over server default", () => {
    const store = new Map<string, string>();
    withLocalStorage(store, () => {
      store.set(
        "playai-chat-display-prefs",
        JSON.stringify({ ...DEFAULT_CHAT_DISPLAY_PREFS, assetDisplayMode: "off" })
      );
      const resolved = resolveClientDisplayPrefs({
        ...DEFAULT_CHAT_DISPLAY_PREFS,
        assetDisplayMode: "left",
      });
      assert.equal(resolved.assetDisplayMode, "off");
    });
  });
});

describe("portraitBackgroundOpacity (background visual parameter)", () => {
  it("defaults to 0.22 and normalizes finite numbers into 0..1", () => {
    assert.equal(DEFAULT_CHAT_DISPLAY_PREFS.portraitBackgroundOpacity, 0.22);
    assert.equal(normalizePortraitBackgroundOpacity(undefined), 0.22);
    assert.equal(normalizePortraitBackgroundOpacity("x"), 0.22);
    assert.equal(normalizePortraitBackgroundOpacity(Number.NaN), 0.22);
    assert.equal(normalizePortraitBackgroundOpacity(-1), 0);
    assert.equal(normalizePortraitBackgroundOpacity(0), 0);
    assert.equal(normalizePortraitBackgroundOpacity(0.22), 0.22);
    assert.equal(normalizePortraitBackgroundOpacity(1), 1);
    assert.equal(normalizePortraitBackgroundOpacity(2), 1);
  });

  it("round-trips through localStorage canonical output", () => {
    const store = new Map<string, string>();
    const g = globalThis as typeof globalThis & { window?: unknown; localStorage?: Storage };
    const prevWindow = g.window;
    const prevStorage = g.localStorage;
    g.window = g;
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      get length() {
        return store.size;
      },
    };
    try {
      store.set(
        "playai-chat-display-prefs",
        JSON.stringify({ ...DEFAULT_CHAT_DISPLAY_PREFS, portraitBackgroundOpacity: 0.4 })
      );
      const loaded = loadChatDisplayPrefs();
      assert.equal(loaded.portraitBackgroundOpacity, 0.4);
      // canonical write omits removed legacy keys but keeps opacity
      saveChatDisplayPrefs(loaded);
      const persisted = JSON.parse(store.get("playai-chat-display-prefs") ?? "{}");
      assert.equal(persisted.portraitBackgroundOpacity, 0.4);
      assert.equal("showCharacterPortrait" in persisted, false);
    } finally {
      g.window = prevWindow;
      g.localStorage = prevStorage;
    }
  });

  it("changing opacity does not change the canonical mode", () => {
    const next = { ...DEFAULT_CHAT_DISPLAY_PREFS, portraitBackgroundOpacity: 0.9 };
    assert.equal(next.assetDisplayMode, "left");
  });

  it("keeps distinct desktop/mobile QuickRail labels for the same stored mode", () => {
    assert.deepEqual(CHAT_ASSET_DISPLAY_MODE_LABELS, {
      left: "좌측",
      inline: "본문",
      off: "OFF",
    });
    assert.deepEqual(CHAT_ASSET_DISPLAY_MODE_LABELS_MOBILE, {
      left: "배경",
      inline: "본문",
      off: "OFF",
    });
    const rail = readFileSync("src/components/ChatRoomDisplayQuickRail.tsx", "utf8");
    assert.match(rail, /useChatDesktopViewport/);
    assert.match(rail, /CHAT_ASSET_DISPLAY_MODE_LABELS_MOBILE/);
    assert.match(rail, /assetDisplayMode: next/);
  });
});

describe("mobile chat portrait background", () => {

  it("restores the fixed, non-interactive mobile background layer", () => {
    assert.match(CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS, /chat-room-mobile-portrait-bg/);
    assert.match(CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS, /\bfixed\b/);
    assert.match(CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS, /pointer-events-none/);
    assert.match(CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS, /select-none/);
    assert.match(CHAT_MOBILE_PORTRAIT_BACKGROUND_CLASS, /min-\[576px\]:hidden/);
    assert.match(CHAT_MOBILE_PORTRAIT_IMAGE_CLASS, /object-cover/);
    assert.match(
      CHAT_MOBILE_PORTRAIT_IMAGE_CLASS,
      /opacity-\[var\(--mobile-portrait-opacity\)\]/
    );
  });

  it("bounds mobile inline assets and keeps desktop full width", () => {
    assert.match(CHAT_INLINE_ASSET_FIGURE_CLASS, /max-w-\[20rem\]/);
    assert.match(CHAT_INLINE_ASSET_FIGURE_CLASS, /min-\[576px\]:max-w-full/);
    assert.match(CHAT_INLINE_ASSET_FIGURE_CLASS, /mx-auto/);
    assert.match(CHAT_INLINE_ASSET_IMG_CLASS, /object-contain/);
    assert.doesNotMatch(CHAT_INLINE_ASSET_IMG_CLASS, /object-cover/);
  });

  it("uses intrinsic-width desktop portrait column (flex w-max at 768+)", () => {
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /mx-auto/);
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /max-w-\[101\.5rem\]/);
    assert.match(CHAT_PORTRAIT_GRID_MAX_WIDTH_CLASS, /101\.5rem/);
    assert.match(CHAT_PORTRAIT_DESKTOP_TRACK_CLASS, /min-\[576px\]:flex/);
    assert.match(CHAT_PORTRAIT_DESKTOP_TRACK_CLASS, /min-\[768px\]:flex-row/);
    assert.match(CHAT_PORTRAIT_COLUMN_CLASS, /min-\[768px\]:w-max/);
    assert.match(CHAT_PORTRAIT_PANEL_IMG_CLASS, /\bh-full\b/);
    assert.match(CHAT_PORTRAIT_PANEL_IMG_CLASS, /object-contain/);
    assert.doesNotMatch(CHAT_PORTRAIT_PANEL_IMG_CLASS, /object-cover/);
    assert.match(CHAT_PORTRAIT_PANEL_MAX_WIDTH_CLASS, /--chat-portrait-max-w/);
  });

  it("keeps desktop portrait and messages in separate flex columns at 768+", () => {
    assert.match(CHAT_PORTRAIT_CHAT_COLUMN_CLASS, /flex-1/);
    assert.match(CHAT_PORTRAIT_CHAT_COLUMN_CLASS, /max-w-\[780px\]/);
    assert.match(CHAT_PORTRAIT_CHAT_COLUMN_CLASS, /min-\[768px\]:min-w-\[var\(--chat-portrait-min-chat-w\)\]/);
    assert.match(CHAT_PORTRAIT_INFO_HEADER_CHAT_CLASS, /chat-room-portrait-header-chat/);
    assert.match(CHAT_PORTRAIT_INFO_HEADER_CHAT_CLASS, /min-\[768px\]:block/);
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

  it("keeps sticky name/album in portrait column; side rail only at 768+", () => {
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /chat-room-desktop-name-strip/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /\bhidden\b/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /min-\[576px\]:flex/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /min-\[576px\]:sticky/);
    assert.match(CHAT_PORTRAIT_INFO_STICKY_CLASS, /min-\[768px\]:static/);
    assert.match(CHAT_PORTRAIT_COLUMN_CLASS, /chat-room-portrait-column/);
    assert.match(CHAT_PORTRAIT_COLUMN_CLASS, /min-\[768px\]:sticky/);
    assert.match(CHAT_PORTRAIT_CHAT_COLUMN_CLASS, /chat-room-portrait-chat-column/);
    assert.match(CHAT_PORTRAIT_STICKY_CLASS, /chat-room-portrait-rail/);
    assert.match(CHAT_PORTRAIT_STICKY_CLASS, /\bhidden\b/);
    assert.match(CHAT_PORTRAIT_STICKY_CLASS, /min-\[768px\]:flex/);
    assert.doesNotMatch(CHAT_PORTRAIT_STICKY_CLASS, /sticky/);
    assert.match(CHAT_PORTRAIT_DESKTOP_TRACK_CLASS, /min-\[768px\]:flex-row/);
    assert.match(CHAT_PORTRAIT_GRID_CLASS, /chat-room-portrait-grid/);
    assert.match(CHAT_MESSAGES_COLUMN_CLASS, /chat-room-messages-column/);
  });

  it("hides side portrait rail below 768 while keeping desktop name strip from 576", () => {
    assert.match(CHAT_PORTRAIT_SIDE, /min-\[768px\]/);
    assert.doesNotMatch(CHAT_PORTRAIT_STICKY_CLASS, /min-\[576px\]:flex/);
    assert.match(CHAT_PORTRAIT_COLUMN_CLASS, /min-\[576px\]:flex/);
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
});
