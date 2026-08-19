import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadTrpgDiceTheme,
  resolveTrpgDiceTheme,
  saveTrpgDiceTheme,
  TRPG_D20_THEME_OPTIONS,
} from "./diceThemePrefs";
import { PRODUCTION_D20_THEME } from "./diceVisual";

describe("TRPG dice theme prefs", () => {
  it("defaults to production obsidian-royal when nothing is saved", () => {
    assert.equal(loadTrpgDiceTheme(), PRODUCTION_D20_THEME);
    assert.equal(
      resolveTrpgDiceTheme({ previewEnabled: false, savedTheme: null }),
      PRODUCTION_D20_THEME
    );
  });

  it("exposes three swappable overlay themes with one production-ready asset", () => {
    assert.equal(TRPG_D20_THEME_OPTIONS.length, 3);
    assert.equal(TRPG_D20_THEME_OPTIONS.filter((option) => option.productionReady).length, 1);
    assert.equal(TRPG_D20_THEME_OPTIONS[0]?.id, "obsidian-royal");
  });

  it("persists the selected theme in localStorage when available", () => {
    const originalWindow = globalThis.window;
    const bag = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => bag.get(key) ?? null,
          setItem: (key: string, value: string) => {
            bag.set(key, value);
          },
          removeItem: (key: string) => {
            bag.delete(key);
          },
        },
      },
    });
    try {
      saveTrpgDiceTheme("ancient-reliquary");
      assert.equal(loadTrpgDiceTheme(), "ancient-reliquary");
      assert.equal(
        resolveTrpgDiceTheme({ previewEnabled: false, savedTheme: loadTrpgDiceTheme() }),
        "ancient-reliquary"
      );
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });
});
