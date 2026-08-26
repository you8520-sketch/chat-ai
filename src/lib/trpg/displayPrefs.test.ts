import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CHAT_DISPLAY_PREFS, loadChatDisplayPrefs } from "@/lib/chatDisplayPrefs";
import {
  loadTrpgActionSuggestionsCache,
  loadTrpgActionSuggestionsEnabled,
  loadTrpgDisplayPrefs,
  loadTrpgStreamIntervalMs,
  saveTrpgActionSuggestionsCache,
  saveTrpgActionSuggestionsEnabled,
  saveTrpgStreamIntervalMs,
  shouldAutoRequestTrpgActionSuggestions,
  TRPG_ACTION_SUGGESTIONS_CACHE_PREFIX,
  TRPG_ACTION_SUGGESTIONS_KEY,
  TRPG_LEGACY_FONT_SIZE_KEY,
  TRPG_STREAM_INTERVAL_KEY,
} from "./displayPrefs";

function withLocalStorage(store: Map<string, string>, fn: () => void): void {
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
    fn();
  } finally {
    g.window = prevWindow;
    g.localStorage = prevStorage;
  }
}

describe("TRPG display prefs", () => {
  it("defaults TRPG GM speed to chat fast and stores it apart from chat prefs", () => {
    const store = new Map<string, string>();
    withLocalStorage(store, () => {
      store.set(
        "playai-chat-display-prefs",
        JSON.stringify({ ...DEFAULT_CHAT_DISPLAY_PREFS, streamIntervalMs: 100, streamCharsPerTick: 1 })
      );
      assert.equal(loadTrpgStreamIntervalMs(), DEFAULT_CHAT_DISPLAY_PREFS.streamIntervalMs);
      saveTrpgStreamIntervalMs(60);
      assert.equal(store.get(TRPG_STREAM_INTERVAL_KEY), "50");
      assert.equal(loadTrpgStreamIntervalMs(), 50);
      assert.equal(loadChatDisplayPrefs().streamIntervalMs, 65);
      store.set(TRPG_STREAM_INTERVAL_KEY, "20");
      assert.equal(loadTrpgStreamIntervalMs(), 35);
      assert.equal(store.get(TRPG_STREAM_INTERVAL_KEY), "35");
      saveTrpgStreamIntervalMs(0);
      assert.equal(loadTrpgStreamIntervalMs(), 0);
    });
  });

  it("keeps a legacy TRPG size when chat prefs are still the default size", () => {
    const store = new Map<string, string>();
    withLocalStorage(store, () => {
      store.set(TRPG_LEGACY_FONT_SIZE_KEY, "xlarge");
      const prefs = loadTrpgDisplayPrefs();
      assert.equal(prefs.fontSizePreset, "xlarge");
      assert.equal(store.has(TRPG_LEGACY_FONT_SIZE_KEY), false);
    });
  });

  it("does not override a chat font size that the user already picked", () => {
    const store = new Map<string, string>();
    withLocalStorage(store, () => {
      store.set(
        "playai-chat-display-prefs",
        JSON.stringify({ ...DEFAULT_CHAT_DISPLAY_PREFS, fontSizePreset: "small", fontFamily: "noto-serif" })
      );
      store.set(TRPG_LEGACY_FONT_SIZE_KEY, "xlarge");
      const prefs = loadTrpgDisplayPrefs();
      assert.equal(prefs.fontSizePreset, "small");
      assert.equal(prefs.fontFamily, "noto-serif");
      assert.equal(store.has(TRPG_LEGACY_FONT_SIZE_KEY), false);
    });
  });

  it("persists the action-example toggle and auto-requests only on a new ACTION_INPUT turn", () => {
    const store = new Map<string, string>();
    withLocalStorage(store, () => {
      assert.equal(loadTrpgActionSuggestionsEnabled(), false);
      saveTrpgActionSuggestionsEnabled(true);
      assert.equal(store.get(TRPG_ACTION_SUGGESTIONS_KEY), "1");
      assert.equal(loadTrpgActionSuggestionsEnabled(), true);
      saveTrpgActionSuggestionsEnabled(false);
      assert.equal(loadTrpgActionSuggestionsEnabled(), false);
    });
    assert.equal(
      shouldAutoRequestTrpgActionSuggestions({
        enabled: true,
        phase: "ACTION_INPUT",
        hasDraft: true,
        locked: false,
        requestedRound: null,
        roundNumber: 3,
      }),
      true
    );
    assert.equal(
      shouldAutoRequestTrpgActionSuggestions({
        enabled: false,
        phase: "ACTION_INPUT",
        hasDraft: true,
        locked: false,
        requestedRound: null,
        roundNumber: 3,
      }),
      false
    );
    assert.equal(
      shouldAutoRequestTrpgActionSuggestions({
        enabled: true,
        phase: "GENERATING_NARRATION",
        hasDraft: true,
        locked: false,
        requestedRound: null,
        roundNumber: 3,
      }),
      false
    );
    assert.equal(
      shouldAutoRequestTrpgActionSuggestions({
        enabled: true,
        phase: "ACTION_INPUT",
        hasDraft: true,
        locked: true,
        requestedRound: null,
        roundNumber: 3,
      }),
      false
    );
    assert.equal(
      shouldAutoRequestTrpgActionSuggestions({
        enabled: true,
        phase: "ACTION_INPUT",
        hasDraft: true,
        locked: false,
        requestedRound: 3,
        roundNumber: 3,
      }),
      false
    );
    assert.equal(
      shouldAutoRequestTrpgActionSuggestions({
        enabled: true,
        phase: "ACTION_INPUT",
        hasDraft: true,
        locked: false,
        requestedRound: null,
        roundNumber: 3,
        autoAttemptFailed: true,
      }),
      false
    );
    assert.equal(
      shouldAutoRequestTrpgActionSuggestions({
        enabled: true,
        phase: "ACTION_INPUT",
        hasDraft: true,
        locked: false,
        requestedRound: 2,
        roundNumber: 3,
      }),
      true
    );
  });

  it("caches action examples per campaign round and restores them without regenerating", () => {
    const store = new Map<string, string>();
    const suggestions = [
      { actionType: "free" as const, text: "문을 연다" },
      { actionType: "talk" as const, text: "GM에게 묻는다", speech: "여기는 어디지?" },
    ];
    withLocalStorage(store, () => {
      assert.equal(loadTrpgActionSuggestionsCache(7, 3), null);
      saveTrpgActionSuggestionsCache(7, 3, suggestions);
      assert.equal(store.get(`${TRPG_ACTION_SUGGESTIONS_CACHE_PREFIX}7`) != null, true);
      // Same round restores the cached examples.
      assert.deepEqual(loadTrpgActionSuggestionsCache(7, 3), suggestions);
      // A different round never reuses stale examples.
      assert.equal(loadTrpgActionSuggestionsCache(7, 4), null);
      // A different campaign never reuses another room's examples.
      assert.equal(loadTrpgActionSuggestionsCache(8, 3), null);
      // New round overwrites the old cache.
      saveTrpgActionSuggestionsCache(7, 4, [suggestions[0]]);
      assert.deepEqual(loadTrpgActionSuggestionsCache(7, 4), [suggestions[0]]);
      assert.equal(loadTrpgActionSuggestionsCache(7, 3), null);
    });
  });

  it("ignores corrupt or empty suggestion cache entries", () => {
    const store = new Map<string, string>();
    withLocalStorage(store, () => {
      store.set(`${TRPG_ACTION_SUGGESTIONS_CACHE_PREFIX}7`, "not-json");
      assert.equal(loadTrpgActionSuggestionsCache(7, 3), null);
      store.set(`${TRPG_ACTION_SUGGESTIONS_CACHE_PREFIX}7`, JSON.stringify({ round: 3, suggestions: [] }));
      assert.equal(loadTrpgActionSuggestionsCache(7, 3), null);
    });
  });
});
