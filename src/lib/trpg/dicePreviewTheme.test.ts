import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PRODUCTION_D20_THEME } from "./diceVisual";
import {
  isTrpgDicePreviewRuntime,
  isTrpgProductionAppHost,
  parseDiceThemeQuery,
  previewDiceOverlayFixture,
  resolveCampaignOverlayDiceTheme,
  shouldInjectPreviewDiceOverlay,
} from "./dicePreviewTheme";

describe("preview-only campaign dice theme", () => {
  it("never enables preview on the production Railway host", () => {
    assert.equal(isTrpgProductionAppHost("chat-ai-production-3e84.up.railway.app"), true);
    assert.equal(
      isTrpgDicePreviewRuntime({
        nodeEnv: "production",
        previewFlag: "1",
        hostname: "chat-ai-production-3e84.up.railway.app",
      }),
      false
    );
    assert.equal(
      resolveCampaignOverlayDiceTheme({
        previewEnabled: false,
        queryTheme: "gilded-verdant-relic",
      }),
      PRODUCTION_D20_THEME
    );
    assert.equal(
      shouldInjectPreviewDiceOverlay({
        previewEnabled: false,
        queryTheme: "gilded-verdant-relic",
        queryPreview: "1",
      }),
      false
    );
  });

  it("allows gilded theme on preview hosts via diceTheme query", () => {
    assert.equal(
      isTrpgDicePreviewRuntime({
        nodeEnv: "production",
        hostname: "preview-491.up.railway.app",
      }),
      true
    );
    assert.equal(
      isTrpgDicePreviewRuntime({
        nodeEnv: "development",
        hostname: "localhost",
      }),
      true
    );
    assert.equal(parseDiceThemeQuery("gilded-verdant-relic"), "gilded-verdant-relic");
    assert.equal(
      resolveCampaignOverlayDiceTheme({
        previewEnabled: true,
        queryTheme: "gilded-verdant-relic",
      }),
      "gilded-verdant-relic"
    );
    assert.equal(
      shouldInjectPreviewDiceOverlay({
        previewEnabled: true,
        queryTheme: "gilded-verdant-relic",
      }),
      true
    );
    const fixture = previewDiceOverlayFixture("유라");
    assert.equal(fixture.d20, 14);
    assert.equal(fixture.name, "유라");
    assert.equal(fixture.actionBody, "preview-only fixture");
  });

  it("ignores unknown theme query values", () => {
    assert.equal(parseDiceThemeQuery("obsidian-relic"), null);
    assert.equal(
      resolveCampaignOverlayDiceTheme({
        previewEnabled: true,
        queryTheme: "obsidian-relic",
      }),
      PRODUCTION_D20_THEME
    );
  });
});
