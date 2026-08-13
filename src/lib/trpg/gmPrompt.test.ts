import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTrpgGmUserBlock, parseTrpgGmOutput, TRPG_GM_SYSTEM } from "./gmPrompt";

describe("TRPG GM prompt/parse", () => {
  it("parses narration and a player delta", () => {
    const parsed = parseTrpgGmOutput(`<<<NARRATION>>>
등불이 흔들린다.
<<<DELTA>>>
{"players":[{"participantId":4,"hp":18,"conditions":["먼지"],"inventoryAdd":["열쇠"],"inventoryRemove":[],"location":"복도"}],"location":"복도","next_round_context":"창을 볼지 문을 밀지","questsAdd":["밀서 찾기"],"flagsAdd":["문_열림"],"campaign_finished":false}`);
    assert.match(parsed.narration, /등불이 흔들린다/);
    assert.equal(parsed.delta.players[0]?.participantId, 4);
    assert.equal(parsed.delta.players[0]?.hp, 18);
    assert.deepEqual(parsed.delta.players[0]?.inventoryAdd, ["열쇠"]);
    assert.equal(parsed.location, "복도");
    assert.equal(parsed.campaignFinished, false);
    assert.equal(parsed.nextRoundContext, "창을 볼지 문을 밀지");
    assert.deepEqual(parsed.delta.questsAdd, ["밀서 찾기"]);
    assert.deepEqual(parsed.delta.flagsAdd, ["문_열림"]);
  });

  it("does not mention OOC or party chat", () => {
    assert.doesNotMatch(TRPG_GM_SYSTEM, /OOC|party chat|잡담/i);
    assert.match(TRPG_GM_SYSTEM, /3000/);
    assert.match(TRPG_GM_SYSTEM, /single linear timeline/i);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /800–1800|800-1800/);
    const block = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: false,
      actions: [
        {
          participantId: 1,
          name: "렌",
          body: "문을 민다.",
          statKey: "str",
          d20: 14,
          finalScore: 14,
          dc: 12,
          tier: "SUCCESS",
        },
      ],
    });
    assert.doesNotMatch(block, /OOC|PARTY CHAT/i);
    assert.match(block, /PROPOSED FICTION/);
    assert.match(block, /d20=14/);
    const withSecret = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      gmSecret: "진범은 여관주인이다",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: true,
      actions: [],
    });
    assert.match(withSecret, /GM SECRET/);
    assert.match(withSecret, /진범은 여관주인이다/);
    const withPersona = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: true,
      playerPersonas: "[PLAYER PERSONA participantId=1 name=렌]\n이름/호칭: 렌\n조용한 탐정",
      actions: [],
    });
    assert.match(withPersona, /PLAYER PERSONAS/);
    assert.match(withPersona, /조용한 탐정/);
  });
});
