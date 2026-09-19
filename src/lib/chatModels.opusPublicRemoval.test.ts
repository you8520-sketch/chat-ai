import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CLAUDE_OPUS_5_DISPLAY_NAME,
  CLAUDE_OPUS_MODEL,
  CLAUDE_OPUS_MODEL_LEGACY,
  DEFAULT_SELECTED_AI,
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isMainRpModel,
  isUserSelectableAI,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
  userSelectableAIOptionsForUser,
  type SelectedAI,
} from "@/lib/chatModels";
import { ensureUserSelectedAI } from "@/lib/userSelectedAI";
import { billingModelDisplayName, buildBillingReceipt } from "@/lib/billingDisplay";

const USER_SELECTABLE_IDS = new Set<string>(USER_SELECTABLE_AI_OPTIONS.map((o) => o.id));

function isPatchAllowed(requested: string): boolean {
  return Boolean(requested && isValidSelectedAI(requested) && USER_SELECTABLE_IDS.has(requested));
}

function memoryDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      selected_ai TEXT NOT NULL DEFAULT '',
      ai_model_ux_json TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

describe("Claude Opus 5 Main RP retirement (R-01..R-14)", () => {
  it("R-01 MAIN_RP_MODEL_IDS count = 3", () => {
    assert.equal(MAIN_RP_MODEL_IDS.length, 3);
  });

  it("R-02 picker count = 3", () => {
    assert.equal(MAIN_RP_USER_SELECTABLE_OPTIONS.length, 3);
    assert.equal(SELECTED_AI_OPTIONS.length, 3);
    assert.equal(USER_SELECTABLE_AI_OPTIONS.length, 3);
    assert.equal(userSelectableAIOptionsForUser(false).length, 3);
    assert.equal(userSelectableAIOptionsForUser(true).length, 3);
  });

  it("R-03 DeepSeek selectable = true", () => {
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, false), true);
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, true), true);
  });

  it("R-04 Gemini 3.1 Pro selectable = true", () => {
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, false), true);
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, true), true);
  });

  it("R-05 Gemini 3.7 Flash selectable = true", () => {
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, false), true);
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, true), true);
  });

  it("R-06 Claude Opus 5 MainRP = false", () => {
    assert.equal(isMainRpModel(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), false);
    assert.ok(!MAIN_RP_MODEL_IDS.includes(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL as SelectedAI));
  });

  it("R-07 Claude Opus 5 selectable normal user = false", () => {
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL, false), false);
  });

  it("R-08 Claude Opus 5 selectable admin = false", () => {
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL, true), false);
  });

  it("R-09 PATCH selectedAI=claude-opus-5 is rejected", () => {
    assert.equal(isPatchAllowed(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), false);
    assert.equal(isValidSelectedAI(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), false);
  });

  it("R-10 stored users.selected_ai=claude-opus-5 remaps to DeepSeek V4 Pro", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO users (id, selected_ai) VALUES (1, ?)").run(
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL
    );
    const r = ensureUserSelectedAI(db, 1);
    assert.equal(r.selectedAI, DEFAULT_SELECTED_AI);
    assert.equal(r.selectedAI, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(r.remappedFromRetired, true);
    const stored = db.prepare("SELECT selected_ai FROM users WHERE id=1").get() as {
      selected_ai: string;
    };
    assert.equal(stored.selected_ai, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    db.close();
  });

  it("R-11 legacy Opus aliases resolve to DeepSeek V4 Pro", () => {
    for (const alias of [
      CLAUDE_OPUS_MODEL_LEGACY,
      "claude-opus",
      "anthropic/claude-opus-latest",
      CLAUDE_OPUS_MODEL,
      "claude-opus-5",
    ]) {
      assert.equal(
        resolveSelectedAI(alias),
        CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        alias
      );
    }
  });

  it('R-12 historical selectedAILabel("claude-opus-5") returns Claude Opus 5', () => {
    assert.equal(selectedAILabel(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), CLAUDE_OPUS_5_DISPLAY_NAME);
  });

  it("R-13 past Opus receipt parsing/display remains supported", () => {
    assert.equal(
      billingModelDisplayName(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
      CLAUDE_OPUS_5_DISPLAY_NAME
    );
    const receipt = buildBillingReceipt({
      cost: 100,
      model: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      selectedAI: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      apiInputTokens: 1000,
      apiOutputTokens: 500,
      modelLabel: selectedAILabel(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
    });
    assert.equal(receipt?.modelLabel, CLAUDE_OPUS_5_DISPLAY_NAME);
  });

  it("R-14 DeepSeek/Gemini picker metadata unchanged", () => {
    const deepseek = MAIN_RP_USER_SELECTABLE_OPTIONS.find(
      (o) => o.id === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
    const gemini31 = MAIN_RP_USER_SELECTABLE_OPTIONS.find(
      (o) => o.id === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
    );
    const gemini37 = MAIN_RP_USER_SELECTABLE_OPTIONS.find(
      (o) => o.id === CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL
    );
    assert.equal(deepseek?.label, "DeepSeek V4 Pro");
    assert.equal(deepseek?.recommended, true);
    assert.equal(gemini31?.hint, "Google");
    assert.equal(gemini37?.hint, "Google");
    assert.equal(deepseek?.provider, "cheaperinference");
    assert.equal(gemini31?.provider, "cheaperinference");
    assert.equal(gemini37?.provider, "cheaperinference");
  });
});
