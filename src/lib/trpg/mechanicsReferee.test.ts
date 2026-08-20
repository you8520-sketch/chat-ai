import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildMechanicsRefereeUserBlock, TRPG_MECHANICS_REFEREE_SYSTEM } from "./mechanicsReferee";
import { TRPG_MECHANICS_REFEREE_MODEL } from "./mechanicsTypes";
import { TRPG_SCENARIO_DRAFT_MODEL } from "./scenarioDraft";
import { adaptTrpgReplySuggestionChatBody } from "./replySuggestions";

describe("TRPG mechanics referee contract", () => {
  it("reuses the Flash 0731 owner and true-off reply adapter", () => {
    assert.equal(TRPG_MECHANICS_REFEREE_MODEL, TRPG_SCENARIO_DRAFT_MODEL);
    const src = readFileSync("src/lib/trpg/mechanicsReferee.ts", "utf8");
    assert.match(src, /adaptTrpgReplySuggestionChatBody/);
    const adapted = adaptTrpgReplySuggestionChatBody({ model: TRPG_MECHANICS_REFEREE_MODEL });
    assert.deepEqual(adapted.thinking, { type: "disabled" });
    assert.equal(adapted.reasoning_effort, "none");
    assert.match(TRPG_MECHANICS_REFEREE_SYSTEM, /JSON only/);
    assert.match(TRPG_MECHANICS_REFEREE_SYSTEM, /Never output final numeric damage/);
    assert.match(TRPG_MECHANICS_REFEREE_SYSTEM, /sourceParticipantId/);
    assert.match(TRPG_MECHANICS_REFEREE_SYSTEM, /targetParticipantId/);
    assert.match(TRPG_MECHANICS_REFEREE_SYSTEM, /periodic_harm, control only/);
    assert.match(TRPG_MECHANICS_REFEREE_SYSTEM, /explicitly states that failure\/partial caused/);
    assert.match(TRPG_MECHANICS_REFEREE_SYSTEM, /explicitly establishes continuing poison/);
    assert.match(TRPG_MECHANICS_REFEREE_SYSTEM, /consumeItem must be JSON null/);
    assert.match(TRPG_MECHANICS_REFEREE_SYSTEM, /"consumeItem":null/);
    assert.match(TRPG_MECHANICS_REFEREE_SYSTEM, /"consumeItem":"해독제"/);
  });

  it("sends only public structured facts and never hidden GM state", () => {
    const block = buildMechanicsRefereeUserBlock({
      scene: "공개 장면",
      resolutionOrder: "[RESOLUTION ORDER]\n렌",
      actors: [
        {
          participantId: 1,
          name: "렌",
          actionType: "attack",
          body: "벤다",
          tier: "FAILURE",
          d20: 6,
          modifier: 1,
          finalScore: 7,
          dc: 12,
          statKey: "str",
        },
      ],
      sheets: [
        {
          participantId: 1,
          name: "렌",
          playerName: "유저",
          level: 1,
          hp: 20,
          maxHp: 25,
          stats: { str: 8 },
          conditions: ["긴장"],
          inventory: ["붕대"],
          location: "폐허",
          modifiersNote: "",
        },
      ],
      effects: [],
      specialRules: "공개 특수규칙",
    });
    assert.match(block, /공개 장면/);
    assert.match(block, /공개 특수규칙/);
    assert.doesNotMatch(block, /GM SECRET|hidden ending|director state|endingCandidates/i);
  });
});
