import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countTrpgNarrationChars, TRPG_GM_RICH_MIN_CHARS } from "./gmNarrationBudget";
import { buildTrpgGmUserBlock, formatTrpgGenreToneLine, formatTrpgSheetCanon, parseTrpgGmOutput, TRPG_GM_SYSTEM } from "./gmPrompt";
import { DEFAULT_TRPG_STAT_DEFS } from "./stats";

function padRich(seed: string): string {
  let out = seed.trim();
  while (countTrpgNarrationChars(out) < TRPG_GM_RICH_MIN_CHARS) out += " 먼지가 인다.";
  return out;
}

function action(opts: {
  participantId: number;
  name: string;
  body: string;
  intent?: string;
  tier?: string | null;
  d20?: number | null;
}): Parameters<typeof buildTrpgGmUserBlock>[0]["actions"][number] {
  return {
    participantId: opts.participantId,
    name: opts.name,
    body: opts.body,
    intent: opts.intent,
    statKey: "str",
    d20: opts.d20 ?? 10,
    finalScore: opts.d20 ?? 10,
    dc: 12,
    tier: opts.tier === undefined ? "SUCCESS" : opts.tier,
  };
}

describe("TRPG GM prompt/parse", () => {
  it("parses narration and a player delta", () => {
    const parsed = parseTrpgGmOutput(`<<<NARRATION>>>
등불이 흔들린다.
<<<DELTA>>>
{"players":[{"participantId":4,"hp":18,"conditions":["먼지"],"inventoryAdd":["열쇠"],"inventoryRemove":[],"location":"복도"}],"location":"복도","next_round_context":"창을 볼지 문을 밀지","questsAdd":["밀서 찾기"],"flagsAdd":["문_열림"],"campaign_finished":false}`);
    assert.match(parsed.narration, /등불이 흔들린다/);
    assert.equal(parsed.delta.players[0]?.participantId, 4);
    assert.equal(parsed.delta.players[0]?.hp, 18);
    assert.deepEqual(parsed.delta.players[0]?.conditions, ["먼지"]);
    assert.deepEqual(parsed.delta.players[0]?.inventoryAdd, ["열쇠"]);
    assert.equal(parsed.location, "복도");
    assert.equal(parsed.campaignFinished, false);
    assert.equal(parsed.nextRoundContext, "창을 볼지 문을 밀지");
    assert.deepEqual(parsed.delta.questsAdd, ["밀서 찾기"]);
    assert.deepEqual(parsed.delta.flagsAdd, ["문_열림"]);
  });

  it("does not mention OOC or party chat", () => {
    assert.doesNotMatch(TRPG_GM_SYSTEM, /OOC|party chat|잡담/i);
    assert.match(TRPG_GM_SYSTEM, /single linear timeline/i);
    assert.equal((TRPG_GM_SYSTEM.match(/\[SPEECH FORMAT\]/g) ?? []).length, 1);
    assert.equal((TRPG_GM_SYSTEM.match(/\[GM SCENE CRAFT — ADAPTIVE NARRATION\]/g) ?? []).length, 1);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[ACTION RESOLUTION\]/);
    assert.equal((TRPG_GM_SYSTEM.match(/\[TONE\]/g) ?? []).length, 1);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /comic and serious/i);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Page time/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Rewrite every ACTION/);
    assert.match(TRPG_GM_SYSTEM, /Extra NPCs/);
    assert.match(TRPG_GM_SYSTEM, /Closing GM beat/);
    assert.match(TRPG_GM_SYSTEM, /GM:/);
    assert.match(TRPG_GM_SYSTEM, /never the addressee/);
    assert.match(TRPG_GM_SYSTEM, /submitted PC action prose and spoken lines are already visible/);
    assert.match(TRPG_GM_SYSTEM, /first new consequence/i);
    assert.match(TRPG_GM_SYSTEM, /next meaningful decision/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /isolated per-character recaps/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Never replay/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Never paste it/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Do not stop at echoing/);
    assert.match(TRPG_GM_SYSTEM, /AUTHORITATIVE MECHANICS/);
    assert.match(TRPG_GM_SYSTEM, /mechanics wins/);
    assert.match(TRPG_GM_SYSTEM, /players\[\]\.conditions is the resulting post-round narrative condition list/);
    assert.match(TRPG_GM_SYSTEM, /중독, 출혈, or 마비/);
    assert.match(TRPG_GM_SYSTEM, /server owns those mechanics/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /800–1800|800-1800/);
    assert.equal((TRPG_GM_SYSTEM.match(/\[LENGTH — SCENE RESPONSIVE\]/g) ?? []).length, 1);
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
    assert.match(block, /density=BRIEF/);
    assert.match(block, /\[ACTION PROSE — scene material for this resolution\]/);
    assert.match(block, /d20=14/);
    assert.match(block, /SCENE CRAFT/);
    assert.match(block, /Apply the system scene-craft contract and ROUND NARRATION BUDGET/);
    assert.doesNotMatch(block, /enrich if brief, do not retell if already rich/);
    assert.doesNotMatch(block, /ATTEMPTED ACTION/);
    assert.doesNotMatch(block, /PROPOSED FICTION/);
    assert.doesNotMatch(block, /do not replay submitted prose/);
    assert.doesNotMatch(block, /do not paste/);
    assert.doesNotMatch(block, /never dump into the scene/);
    assert.doesNotMatch(block, /Rewrite every ACTION/);
    assert.doesNotMatch(block, /players supply the approach/);
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
    const withMechanics = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "",
      opening: false,
      mechanicsPacket: "[AUTHORITATIVE MECHANICS]\n렌\nHP 16/30",
      actions: [],
    });
    assert.match(withMechanics, /AUTHORITATIVE MECHANICS/);
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
    assert.match(TRPG_GM_SYSTEM, /For talk\/ask/);
    assert.match(TRPG_GM_SYSTEM, /written text, signs/);
    assert.match(TRPG_GM_SYSTEM, /submitted actions/);
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

  it("owns adaptive narration in one GM SCENE CRAFT block", () => {
    assert.equal((TRPG_GM_SYSTEM.match(/\[GM SCENE CRAFT — ADAPTIVE NARRATION\]/g) ?? []).length, 1);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[ACTION RESOLUTION\]/);
    assert.match(TRPG_GM_SYSTEM, /submitted PC action prose and spoken lines are already visible/);
    assert.match(TRPG_GM_SYSTEM, /first new consequence/i);
    assert.match(TRPG_GM_SYSTEM, /Latest established scene state/);
    assert.match(TRPG_GM_SYSTEM, /next meaningful decision/);
    const block = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "",
      opening: false,
      actions: [
        {
          participantId: 1,
          name: "렌",
          body: padRich(
            "그는 검을 역수로 고쳐 쥐었다. 바닥을 박차고 놈의 측면으로 파고들며 갈비뼈 아래를 노렸다."
          ),
          intent: "측면을 찔러 공격한다",
          statKey: "str",
          d20: 16,
          finalScore: 18,
          dc: 13,
          tier: "SUCCESS",
        },
      ],
    });
    assert.match(block, /\[INTENT\]\n측면을 찔러 공격한다/);
    assert.match(block, /\[VISIBLE ACTION PROSE — established context for its outcome\]/);
    assert.match(block, /검을 역수로 고쳐 쥐었다/);
    assert.match(block, /Apply the system scene-craft contract and ROUND NARRATION BUDGET/);
    assert.doesNotMatch(block, /color only, never dump/);
  });

  it("A–D: user block carries a density-aware ROUND NARRATION BUDGET", () => {
    const sparse = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "",
      opening: false,
      actions: [
        action({ participantId: 1, name: "렌", body: "문을 연다." }),
        action({ participantId: 2, name: "유나", body: "뒤를 살핀다." }),
      ],
    });
    assert.match(sparse, /\[ROUND NARRATION BUDGET\]/);
    assert.match(sparse, /Input density: SPARSE/);
    assert.match(sparse, /Minimum new GM narration: 2800 Korean characters/);
    assert.match(sparse, /Target new GM narration: 3600–4600 Korean characters/);

    const mixed = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "",
      opening: false,
      actions: [
        action({ participantId: 1, name: "렌", body: "숨는다." }),
        action({ participantId: 2, name: "유나", body: padRich("그녀는 방패를 들어 앞으로 밀었다.") }),
      ],
    });
    assert.match(mixed, /Input density: MIXED/);
    assert.match(mixed, /Minimum new GM narration: 2400 Korean characters/);
    assert.match(mixed, /Target new GM narration: 3000–4000 Korean characters/);

    const rich = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "",
      opening: false,
      actions: [
        action({ participantId: 1, name: "렌", body: padRich("그는 검을 역수로 고쳐 쥐었다.") }),
        action({ participantId: 2, name: "유나", body: padRich("그녀는 방패를 들어 앞으로 밀었다.") }),
      ],
    });
    assert.match(rich, /Input density: RICH/);
    assert.match(rich, /Minimum new GM narration: 2000 Korean characters/);
    assert.match(rich, /Target new GM narration: 2500–3500 Korean characters/);

    const four = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "",
      opening: false,
      actions: [
        action({ participantId: 1, name: "렌", body: "문을 연다." }),
        action({ participantId: 2, name: "유나", body: "뒤를 살핀다." }),
        action({ participantId: 3, name: "솔", body: "숨는다." }),
        action({ participantId: 4, name: "이혁", body: "총을 던진다." }),
      ],
    });
    assert.match(four, /Input density: SPARSE/);
    assert.match(four, /Minimum new GM narration: 3200 Korean characters/);
    assert.match(four, /Target new GM narration: 4200–5200 Korean characters/);
  });

  it("E: rich participant prose does not own roll outcomes", () => {
    assert.match(TRPG_GM_SYSTEM, /ROLL and AUTHORITATIVE MECHANICS determine outcomes/);
    assert.match(TRPG_GM_SYSTEM, /Honor supplied roll tiers exactly/);
    assert.match(TRPG_GM_SYSTEM, /Success creates intended leverage/);
    assert.match(TRPG_GM_SYSTEM, /mechanics wins/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Carry the established result forward/);
    const block = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "",
      opening: false,
      actions: [
        action({
          participantId: 1,
          name: "렌",
          body: padRich("검이 괴물의 목을 깊게 베었다."),
          intent: "목을 벤다",
          tier: "FAILURE",
          d20: 4,
        }),
      ],
    });
    assert.match(block, /tier=FAILURE/);
    assert.match(block, /검이 괴물의 목을 깊게 베었다/);
    assert.match(block, /Input density: RICH/);
  });

  it("F: closing GM beat is compact guidance, not a recap floor", () => {
    assert.match(TRPG_GM_SYSTEM, /one compact `GM:` aside/);
    assert.match(TRPG_GM_SYSTEM, /most immediate unresolved pressure/);
    assert.match(TRPG_GM_SYSTEM, /player control returns/);
    assert.match(TRPG_GM_SYSTEM, /100–180 Korean chars/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /100–250/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /open agency point/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /players supply the approach/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /recap what just landed/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /how the room feels now/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /At least 400/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /400 Korean characters/);
  });

  it("G: drops the global 3000/4800 length contract", () => {
    assert.doesNotMatch(TRPG_GM_SYSTEM, /MUST exceed 3000/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Aim about 4800/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /aim ~4800/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /exceeds 3000 characters/);
    assert.match(TRPG_GM_SYSTEM, /Use the supplied ROUND NARRATION BUDGET/);
  });

  it("H: adaptive narration has exactly one owner", () => {
    assert.equal((TRPG_GM_SYSTEM.match(/\[GM SCENE CRAFT — ADAPTIVE NARRATION\]/g) ?? []).length, 1);
    assert.equal((TRPG_GM_SYSTEM.match(/\[LENGTH — SCENE RESPONSIVE\]/g) ?? []).length, 1);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[ACTION RESOLUTION\]/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[AGENCY\]/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[FAILURE\]/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[DIALOGUE\]/);
    assert.match(TRPG_GM_SYSTEM, /Do not replay, re-quote, closely paraphrase, or re-stage/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /do not replay submitted prose/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /never dump into the scene/);
  });

  it("A: persona micro-reactions keep characters embodied", () => {
    assert.match(TRPG_GM_SYSTEM, /each PC's next meaningful decision remains with that player/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /persona-true micro-reactions/);
  });

  it("B: micro-reactions do not take the next meaningful decision", () => {
    assert.match(TRPG_GM_SYSTEM, /each PC's next meaningful decision remains with that player/);
  });

  it("C: failure preserves competence without slapstick defaults", () => {
    assert.match(TRPG_GM_SYSTEM, /Failure: intended result does not fully land/);
    assert.match(TRPG_GM_SYSTEM, /established competence stays credible/);
    assert.match(TRPG_GM_SYSTEM, /fold them into one coherent setback/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Across concurrent and nearby failures, vary source and consequence/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /preserving competence and personality/);
  });

  it("D: rich participant prose starts GM writing at the first new beat", () => {
    assert.match(TRPG_GM_SYSTEM, /submitted PC action prose and spoken lines are already visible/);
    assert.match(TRPG_GM_SYSTEM, /first new consequence/i);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /previously written action as the minimum continuity/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /isolated per-character recaps/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /manner, motion, posture, aim, speech/);
  });

  it("E: spoken lines prefer listener and world over reprint", () => {
    assert.match(TRPG_GM_SYSTEM, /spoken words are in-scene/);
    assert.match(TRPG_GM_SYSTEM, /resolve through listener and world/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Write its effect first/);
  });

  it("F2: closing ends on immediate pressure when control returns", () => {
    assert.match(TRPG_GM_SYSTEM, /most immediate unresolved pressure/);
    assert.match(TRPG_GM_SYSTEM, /player control returns/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /visible options/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /closed menu/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /every plausible player approach available/);
    const block = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "",
      opening: false,
      actions: [action({ participantId: 1, name: "렌", body: "문을 연다." })],
    });
    assert.doesNotMatch(block, /players supply the approach/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /recap what just landed/);
  });

  it("3-round follow-up: target band, new scene material, changed state, 1–2 sentence close", () => {
    assert.equal((TRPG_GM_SYSTEM.match(/\[GM SCENE CRAFT — ADAPTIVE NARRATION\]/g) ?? []).length, 1);
    assert.equal((TRPG_GM_SYSTEM.match(/\[LENGTH — SCENE RESPONSIVE\]/g) ?? []).length, 1);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[PROGRESSION\]/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[CLOSING\]/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[QUALITY\]/);
    assert.match(TRPG_GM_SYSTEM, /TARGET is the normal finish range/);
    assert.match(TRPG_GM_SYSTEM, /Minimum is a compact-scene fallback/);
    assert.match(TRPG_GM_SYSTEM, /submitted PC action prose and spoken lines are already visible/);
    assert.match(TRPG_GM_SYSTEM, /first new consequence/i);
    assert.match(TRPG_GM_SYSTEM, /route opening|sceneTransitionTo rather than objectiveSet/);
    assert.match(TRPG_GM_SYSTEM, /1–2 sentences/);
    assert.match(TRPG_GM_SYSTEM, /Failure: intended result does not fully land/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Failure keeps technique credible/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /preserving competence and personality/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[FAILURE\]/);
  });

  it("post-#594 two-turn review: RICH / FAILURE / CONTINUITY / CLOSING / LENGTH / SIZE", () => {
    const craft = TRPG_GM_SYSTEM.slice(
      TRPG_GM_SYSTEM.indexOf("[GM SCENE CRAFT — ADAPTIVE NARRATION]"),
      TRPG_GM_SYSTEM.indexOf("[LENGTH — SCENE RESPONSIVE]")
    );
    const length = TRPG_GM_SYSTEM.slice(
      TRPG_GM_SYSTEM.indexOf("[LENGTH — SCENE RESPONSIVE]"),
      TRPG_GM_SYSTEM.indexOf("[TONE]")
    );
    const closing = TRPG_GM_SYSTEM.split("\n").find((line) => line.includes("Closing GM beat")) ?? "";

    assert.match(craft, /submitted PC action prose and spoken lines are already visible/);
    assert.match(craft, /first new consequence/i);
    assert.equal((craft.match(/submitted PC action prose and spoken lines are already visible/g) ?? []).length, 1);
    assert.doesNotMatch(craft, /previously written action as the minimum continuity/);
    assert.doesNotMatch(craft, /Most of the response must depict/);
    assert.doesNotMatch(craft, /isolated per-character recaps/);
    assert.doesNotMatch(craft, /Write its effect first/);
    assert.doesNotMatch(length, /NEW material/);

    assert.match(craft, /Failure: intended result does not fully land/);
    assert.match(craft, /fold them into one coherent setback/);

    assert.match(craft, /Latest established scene state is the starting point/);

    assert.match(closing, /1–2 sentences/);
    assert.match(closing, /100–180 Korean chars/);
    assert.match(closing, /most immediate unresolved pressure/);
    assert.match(closing, /player control returns/);
    assert.doesNotMatch(closing, /players supply the approach/);
    assert.doesNotMatch(craft, /\boptions\b/i);

    assert.match(length, /TARGET is the normal finish range/);
    assert.match(length, /Minimum is a compact-scene fallback/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /2800|3600|4600|2400|3000|4000|2000|2500|3500/);

    assert.equal((TRPG_GM_SYSTEM.match(/\[GM SCENE CRAFT — ADAPTIVE NARRATION\]/g) ?? []).length, 1);
    assert.equal((TRPG_GM_SYSTEM.match(/\[LENGTH — SCENE RESPONSIVE\]/g) ?? []).length, 1);
    assert.equal((TRPG_GM_SYSTEM.match(/\[TONE\]/g) ?? []).length, 1);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[FAILURE\]/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[CLOSING\]/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[CONTINUITY\]/);
    assert.ok(TRPG_GM_SYSTEM.length <= 10600);
  });
});
