import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CHAT_DISPLAY_PREFS } from "@/lib/chatDisplayPrefs";
import { loadTrpgDisplayPrefs, TRPG_LEGACY_FONT_SIZE_KEY } from "./displayPrefs";

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
});
