import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTrpgGmUserBlock, formatTrpgGenreToneLine, formatTrpgSheetCanon, parseTrpgGmOutput, TRPG_GM_SYSTEM } from "./gmPrompt";
import { TRPG_GM_AIM_CHARS, TRPG_GM_CLOSING_MIN_CHARS, TRPG_GM_MIN_CHARS } from "./types";
import { DEFAULT_TRPG_STAT_DEFS } from "./stats";

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
    assert.match(TRPG_GM_SYSTEM, new RegExp(`Aim about ${TRPG_GM_AIM_CHARS}`));
    assert.match(TRPG_GM_SYSTEM, new RegExp(`At least ${TRPG_GM_CLOSING_MIN_CHARS}`));
    assert.match(TRPG_GM_SYSTEM, /single linear timeline/i);
    assert.equal((TRPG_GM_SYSTEM.match(/\[SPEECH FORMAT\]/g) ?? []).length, 1);
    assert.equal((TRPG_GM_SYSTEM.match(/\[ACTION RESOLUTION\]/g) ?? []).length, 1);
    assert.equal((TRPG_GM_SYSTEM.match(/\[TONE\]/g) ?? []).length, 1);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /comic and serious/i);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Page time/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Rewrite every ACTION/);
    assert.match(TRPG_GM_SYSTEM, /Extra NPCs/);
    assert.match(TRPG_GM_SYSTEM, /Closing GM beat/);
    assert.match(TRPG_GM_SYSTEM, /GM:/);
    assert.match(TRPG_GM_SYSTEM, /table-talk/);
    assert.match(TRPG_GM_SYSTEM, /never the addressee/);
    assert.match(TRPG_GM_SYSTEM, /Never replay/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /800–1800|800-1800/);
    assert.equal(TRPG_GM_MIN_CHARS, 3000);
    assert.ok(TRPG_GM_AIM_CHARS > TRPG_GM_MIN_CHARS);
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
    assert.match(block, /ATTEMPTED ACTION/);
    assert.match(block, /d20=14/);
    assert.match(block, /SCENE CRAFT/);
    assert.match(block, /do not replay submitted prose/);
    assert.doesNotMatch(block, /Rewrite every ACTION/);
    assert.match(block, /table-talk/);
    assert.match(block, /TONE CONTEXT/);
    assert.match(formatTrpgGenreToneLine(["공포/추리", "판타지"]), /WORLD GENRES: 공포\/추리, 판타지/);
    assert.match(formatTrpgGenreToneLine(["공포/추리", "판타지"]), /TONE CONTEXT/);
    assert.doesNotMatch(formatTrpgGenreToneLine(["공포/추리"]), /^\[TONE\]/);
    const withGenres = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: true,
      genres: ["공포/추리"],
      actions: [],
    });
    assert.match(withGenres, /WORLD GENRES: 공포\/추리/);
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
    const withBonds = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: true,
      relationshipBrief: "렌과 유나는 소꿉친구",
      actions: [],
    });
    assert.match(withBonds, /PARTY RELATIONSHIPS/);
    assert.match(withBonds, /소꿉친구/);
    const sheets = formatTrpgSheetCanon({
      defs: DEFAULT_TRPG_STAT_DEFS,
      sheets: [{ name: "렌", stats: { str: 9, dex: 3, int: 5, wis: 5, cha: 5, con: 5 } }],
    });
    assert.match(sheets, /SCENARIO SHEET STATS/);
    assert.match(sheets, /힘 \(str\)/);
    const withSheets = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: false,
      sheetCanon: sheets,
      actions: [
        {
          participantId: 1,
          name: "렌",
          body: "문을 민다.",
          statKey: "str",
          statLabel: "힘",
          statValue: 9,
          d20: 10,
          finalScore: 12,
          dc: 12,
          tier: "SUCCESS",
        },
      ],
    });
    assert.match(withSheets, /PARTY SHEETS/);
    assert.match(withSheets, /stat=힘\(str\) value=9 modifier=2/);
    assert.match(TRPG_GM_SYSTEM, /CHARACTER SHEETS/);
    assert.match(TRPG_GM_SYSTEM, /이름: "대사"/);
    assert.match(TRPG_GM_SYSTEM, /Never paste/);
    assert.match(TRPG_GM_SYSTEM, /talk-ask only/);
    assert.match(TRPG_GM_SYSTEM, /Do not stop at echoing/);
    assert.match(TRPG_GM_SYSTEM, /written text, signs/);
    assert.match(TRPG_GM_SYSTEM, /AI PC/);
    const talk = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: false,
      actions: [
        {
          participantId: 1,
          name: "렌",
          body: "어디로 갈까?",
          needsCheck: false,
          statKey: "cha",
          d20: null,
          finalScore: null,
          dc: null,
          tier: null,
        },
      ],
    });
    assert.match(talk, /talk\/ask only/);
    assert.doesNotMatch(talk, /d20=/);
    assert.match(TRPG_GM_SYSTEM, /PARTY RELATIONSHIPS/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /DIRECTOR DELTA CONTRACT/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /"storyPhase"/);
  });
});
