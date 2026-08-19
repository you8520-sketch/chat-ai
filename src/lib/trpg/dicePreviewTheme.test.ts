import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PRODUCTION_D20_THEME } from "./diceVisual";
import {
  isTrpgDicePreviewRuntime,
  isTrpgProductionAppHost,
  parseDiceThemeQuery,
  previewDiceOverlayFixture,
  previewDiceRollKey,
  resolveCampaignDicePreviewOverlay,
  resolveCampaignOverlayDiceTheme,
  shouldInjectPreviewDiceOverlay,
} from "./dicePreviewTheme";

describe("preview-only campaign dice theme", () => {
  it("does not inject a fixture when only diceTheme is set", () => {
    assert.equal(
      shouldInjectPreviewDiceOverlay({
        previewEnabled: true,
        queryTheme: "gemstone-arcane",
      }),
      false
    );
    const live = resolveCampaignDicePreviewOverlay({
      previewEnabled: true,
      queryTheme: "gemstone-arcane",
      phase: "ACTION_INPUT",
      currentRolls: [],
    });
    assert.equal(live.inject, false);
    assert.equal(live.theme, "gemstone-arcane");
    assert.equal(live.phase, "ACTION_INPUT");
    assert.equal(live.rolls.length, 0);
  });

  it("maps legacy emerald-relic preview ids onto gemstone-arcane", () => {
    assert.equal(parseDiceThemeQuery("emerald-relic"), "gemstone-arcane");
    assert.equal(parseDiceThemeQuery("verdant-relic"), "obsidian-royal");
  });

  it("injects a fixture only when dicePreview=1 on a preview runtime", () => {
    assert.equal(
      shouldInjectPreviewDiceOverlay({
        previewEnabled: true,
        queryTheme: "gemstone-arcane",
        queryPreview: "1",
      }),
      true
    );
    const injected = resolveCampaignDicePreviewOverlay({
      previewEnabled: true,
      queryTheme: "gemstone-arcane",
      queryPreview: "1",
      phase: "ACTION_INPUT",
      currentRolls: [],
      fixtureName: "유라",
    });
    assert.equal(injected.inject, true);
    assert.equal(injected.theme, "gemstone-arcane");
    assert.equal(injected.phase, "ROLLING");
    assert.equal(injected.rolls[0]?.d20, 14);
    assert.equal(injected.rolls[0]?.name, "유라");
  });

  it("allows preview-only dicePreviewD20 override for QA capture", () => {
    const nat20 = resolveCampaignDicePreviewOverlay({
      previewEnabled: true,
      queryPreview: "1",
      queryPreviewD20: "20",
      phase: "ACTION_INPUT",
      currentRolls: [],
    });
    assert.equal(nat20.rolls[0]?.d20, 20);
    assert.equal(nat20.rolls[0]?.tier, "CRITICAL_SUCCESS");
    const nat1 = resolveCampaignDicePreviewOverlay({
      previewEnabled: true,
      queryPreview: "1",
      queryPreviewD20: "1",
      phase: "ACTION_INPUT",
      currentRolls: [],
    });
    assert.equal(nat1.rolls[0]?.d20, 1);
    assert.equal(nat1.rolls[0]?.tier, "CRITICAL_FAILURE");
  });

  it("never overrides theme or injects on the production Railway host", () => {
    assert.equal(isTrpgProductionAppHost("chat-ai-production-3e84.up.railway.app"), true);
    const previewEnabled = isTrpgDicePreviewRuntime({
      nodeEnv: "production",
      previewFlag: "1",
      hostname: "chat-ai-production-3e84.up.railway.app",
    });
    assert.equal(previewEnabled, false);
    assert.equal(
      resolveCampaignOverlayDiceTheme({
        previewEnabled,
        queryTheme: "gemstone-arcane",
        savedTheme: "ancient-reliquary",
      }),
      "ancient-reliquary"
    );
    assert.equal(
      shouldInjectPreviewDiceOverlay({ previewEnabled, queryTheme: "gemstone-arcane", queryPreview: "1" }),
      false
    );
    const live = resolveCampaignDicePreviewOverlay({
      previewEnabled,
      queryTheme: "gemstone-arcane",
      queryPreview: "1",
      savedTheme: "ancient-reliquary",
      phase: "ACTION_INPUT",
      currentRolls: [],
    });
    assert.equal(live.theme, "ancient-reliquary");
    assert.equal(live.inject, false);
  });

  it("keeps real-round phase and rolls when the QA URL has theme only", () => {
    const roll = previewDiceOverlayFixture("권태현");
    const live = resolveCampaignDicePreviewOverlay({
      previewEnabled: true,
      queryTheme: "gemstone-arcane",
      phase: "ROLLING",
      currentRolls: [{ ...roll, d20: 17, participantId: 4 }],
    });
    assert.equal(live.inject, false);
    assert.equal(live.theme, "gemstone-arcane");
    assert.equal(live.phase, "ROLLING");
    assert.equal(live.rolls.length, 1);
    assert.equal(live.rolls[0]?.d20, 17);
    assert.equal(previewDiceRollKey(live.rolls), "4:17");
    assert.equal(parseDiceThemeQuery("obsidian-royal"), "obsidian-royal");
    assert.equal(isTrpgDicePreviewRuntime({ nodeEnv: "development", hostname: "localhost" }), true);
    assert.equal(
      resolveCampaignOverlayDiceTheme({
        previewEnabled: false,
        savedTheme: "ancient-reliquary",
      }),
      "ancient-reliquary"
    );
    assert.equal(resolveCampaignOverlayDiceTheme({ previewEnabled: false }), PRODUCTION_D20_THEME);
  });
});
