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
        queryTheme: "gilded-verdant-relic",
      }),
      false
    );
    const live = resolveCampaignDicePreviewOverlay({
      previewEnabled: true,
      queryTheme: "gilded-verdant-relic",
      phase: "ACTION_INPUT",
      currentRolls: [],
    });
    assert.equal(live.inject, false);
    assert.equal(live.theme, "gilded-verdant-relic");
    assert.equal(live.phase, "ACTION_INPUT");
    assert.equal(live.rolls.length, 0);
  });

  it("injects a fixture only when dicePreview=1 on a preview runtime", () => {
    assert.equal(
      shouldInjectPreviewDiceOverlay({
        previewEnabled: true,
        queryTheme: "gilded-verdant-relic",
        queryPreview: "1",
      }),
      true
    );
    const injected = resolveCampaignDicePreviewOverlay({
      previewEnabled: true,
      queryTheme: "gilded-verdant-relic",
      queryPreview: "1",
      phase: "ACTION_INPUT",
      currentRolls: [],
      fixtureName: "유라",
    });
    assert.equal(injected.inject, true);
    assert.equal(injected.theme, "gilded-verdant-relic");
    assert.equal(injected.phase, "ROLLING");
    assert.equal(injected.rolls[0]?.d20, 14);
    assert.equal(injected.rolls[0]?.name, "유라");
    assert.equal(injected.rolls[0]?.actionBody, "preview-only fixture");
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
        queryTheme: "gilded-verdant-relic",
      }),
      PRODUCTION_D20_THEME
    );
    assert.equal(
      shouldInjectPreviewDiceOverlay({
        previewEnabled,
        queryTheme: "gilded-verdant-relic",
        queryPreview: "1",
      }),
      false
    );
    const live = resolveCampaignDicePreviewOverlay({
      previewEnabled,
      queryTheme: "gilded-verdant-relic",
      queryPreview: "1",
      phase: "ACTION_INPUT",
      currentRolls: [],
    });
    assert.equal(live.theme, PRODUCTION_D20_THEME);
    assert.equal(live.inject, false);
    assert.equal(live.phase, "ACTION_INPUT");
    assert.equal(live.rolls.length, 0);
  });

  it("keeps real-round phase and rolls when the QA URL has theme only", () => {
    const roll = previewDiceOverlayFixture("권태현");
    const live = resolveCampaignDicePreviewOverlay({
      previewEnabled: true,
      queryTheme: "gilded-verdant-relic",
      phase: "ROLLING",
      currentRolls: [{ ...roll, d20: 17, participantId: 4 }],
    });
    assert.equal(live.inject, false);
    assert.equal(live.theme, "gilded-verdant-relic");
    assert.equal(live.phase, "ROLLING");
    assert.equal(live.rolls.length, 1);
    assert.equal(live.rolls[0]?.d20, 17);
    assert.equal(live.rolls[0]?.participantId, 4);
    assert.equal(previewDiceRollKey(live.rolls), "4:17");
    assert.equal(parseDiceThemeQuery("gilded-verdant-relic"), "gilded-verdant-relic");
    assert.equal(isTrpgDicePreviewRuntime({ nodeEnv: "development", hostname: "localhost" }), true);
  });
});
