import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL } from "@/lib/chatModels";
import { TRPG_SCENARIO_DRAFT_MODEL, TRPG_SANDBOX_DIRECTOR_MODEL } from "./scenarioDraft";
import { TRPG_REPLY_SUGGESTION_MODEL } from "./replySuggestions";
import { isTrpgMechanicsRefereeEnabled, TRPG_MECHANICS_REFEREE_MODEL } from "./mechanicsTypes";
import {
  TRPG_ALLOW_FORK,
  TRPG_BOT_MODEL,
  TRPG_GM_MODEL,
  TRPG_MAX_BOTS,
  TRPG_ROUND_PHASES,
} from "./types";

describe("TRPG runtime contract (P0)", () => {
  it("keeps two independent AI character seats and the existing Pro models", () => {
    assert.equal(TRPG_MAX_BOTS, 2);
    assert.equal(TRPG_BOT_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(TRPG_GM_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.notEqual(TRPG_BOT_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL);
    assert.notEqual(TRPG_GM_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL);
  });

  it("uses flash 0731 for draft/sandbox/referee and Luna for reply suggestions", () => {
    assert.equal(TRPG_SCENARIO_DRAFT_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL);
    assert.equal(TRPG_SANDBOX_DIRECTOR_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL);
    assert.equal(TRPG_REPLY_SUGGESTION_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
    assert.equal(TRPG_MECHANICS_REFEREE_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL);
    assert.equal(isTrpgMechanicsRefereeEnabled({}), false);
  });

  it("keeps a linear timeline and the existing round phases", () => {
    assert.equal(TRPG_ALLOW_FORK, false);
    assert.deepEqual(TRPG_ROUND_PHASES, [
      "CHARACTER_SETUP",
      "WAITING_FOR_PLAYERS",
      "ACTION_INPUT",
      "BOT_ACTION",
      "LOCKING_ACTIONS",
      "ADJUDICATING",
      "ROLLING",
      "GENERATING_NARRATION",
      "APPLYING_STATE",
      "ROUND_COMPLETE",
      "CAMPAIGN_COMPLETE",
      "ERROR_RECOVERY",
    ]);
    assert.equal((TRPG_ROUND_PHASES as readonly string[]).includes("INTRO"), false);
    assert.equal((TRPG_ROUND_PHASES as readonly string[]).includes("CLIMAX"), false);
  });
});
