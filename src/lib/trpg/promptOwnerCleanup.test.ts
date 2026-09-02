import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildTrpgBotActionUserBlock, TRPG_BOT_SYSTEM } from "./botActions";
import { TRPG_BOT_ACTION_TYPE_OPEN, TRPG_BOT_INTENT_OPEN } from "./botActionParse";
import { buildTrpgGmUserBlock, TRPG_GM_SYSTEM } from "./gmPrompt";

const FIXTURE = {
  characterName: "유나",
  description: "신중한 동료",
  greeting: "기다려.",
  systemPrompt: "조용히 움직인다.",
  exampleDialog: '"조용히."',
  gender: "female" as const,
  campaignWorld: "폐여관",
  previousGmNarration: "골목이 어둡다.",
  campaignMemory: "[CAMPAIGN STATE]\nlocation=골목",
  recentContinuity: "ROUND 1\n- 렌: 문을 본다",
  longTermMemories: "유나는 렌을 오래 알고 있다.",
  humanActions: [{ playerName: "렌", text: "문을 연다." }],
};

function bot1User(): string {
  return buildTrpgBotActionUserBlock({
    ...FIXTURE,
    speakIndex: 1,
    speakCount: 2,
  });
}

function bot2User(): string {
  return buildTrpgBotActionUserBlock({
    ...FIXTURE,
    characterName: "카이",
    description: "쿨한 동료",
    greeting: "가자.",
    systemPrompt: "짧게 말한다.",
    companionActions: [
      {
        name: "유나",
        text: `유나가 창가에 붙는다.\n\n${TRPG_BOT_INTENT_OPEN}\n유나는 렌의 앞을 막으며 창밖을 살피려 했다.`,
      },
    ],
    speakIndex: 2,
    speakCount: 2,
  });
}

function gmSparseUser(): string {
  return buildTrpgGmUserBlock({
    worldBrief: "폐여관",
    memoryBlock: "[TRPG STRUCTURED STATE]",
    opening: false,
    actions: [
      {
        participantId: 1,
        name: "렌",
        body: "문을 연다.",
        statKey: "str",
        d20: 14,
        finalScore: 16,
        dc: 12,
        tier: "SUCCESS",
      },
    ],
  });
}

function gmRichUser(): string {
  const rich = "렌은 ".repeat(120) + "문을 밀었다.";
  return buildTrpgGmUserBlock({
    worldBrief: "폐여관",
    memoryBlock: "[TRPG STRUCTURED STATE]",
    opening: false,
    gmSecret: "비밀 계획",
    sheetCanon: "[CHARACTER SHEETS]",
    actions: [
      {
        participantId: 1,
        name: "렌",
        body: rich,
        statKey: "str",
        d20: 18,
        finalScore: 20,
        dc: 12,
        tier: "GREAT_SUCCESS",
      },
    ],
  });
}

function countRegex(hay: string, re: RegExp): number {
  return hay.match(re)?.length ?? 0;
}

function proseLayoutBlock(): string {
  const start = TRPG_BOT_SYSTEM.indexOf("[PROSE LAYOUT]");
  const end = TRPG_BOT_SYSTEM.indexOf("After the finished prose");
  return TRPG_BOT_SYSTEM.slice(start, end);
}

describe("TRPG prompt owner cleanup", () => {
  it("combined system + user owner counts (semantic dedup regression)", () => {
    const user = bot1User();
    const user2 = bot2User();
    const combined = `${TRPG_BOT_SYSTEM}\n${user}\n${user2}`;
    const proseLayout = proseLayoutBlock();

    assert.equal(
      countRegex(combined, /one coherent finished PC action beat/gi),
      1,
      "BOT_SCOPE_BEAT_CONTRACT_OCCURRENCE"
    );
    assert.equal(
      countRegex(proseLayout, /character contract|Korean characters|\d+–\d+/g),
      0,
      "BOT_PROSE_LAYOUT_LENGTH_RULE_COUNT"
    );
    assert.equal(countRegex(user, /\[LENGTH\]/g), 0, "BOT_USER_LENGTH_BLOCK_COUNT");
    assert.equal(countRegex(user2, /\[LENGTH\]/g), 0);
    assert.doesNotMatch(user, /finish the last sentence/i);
    assert.doesNotMatch(user, /emit .*INTENT/i);
    assert.equal(
      countRegex(TRPG_BOT_SYSTEM, /do not cut a sentence or clause for a character-count target/gi),
      1,
      "BOT_FINISH_BEHAVIOR_OWNER_COUNT"
    );
    assert.equal(countRegex(user, /\[SPEAK ORDER\]/g), 1, "BOT_TURN_ORDER_BEHAVIOR_OWNER_COUNT");
    assert.equal(countRegex(user2, /\[SPEAK ORDER\]/g), 1);
    assert.doesNotMatch(TRPG_BOT_SYSTEM, /\[SPEAK ORDER\]/);
    assert.equal(
      countRegex(TRPG_BOT_SYSTEM, /Do not declare a finished result/g),
      1,
      "BOT_NO_RESULT_AUTHORITY_OWNER_COUNT"
    );
    assert.doesNotMatch(user, /finished result|resolve the round/i);
    assert.equal(
      countRegex(TRPG_BOT_SYSTEM, new RegExp(TRPG_BOT_ACTION_TYPE_OPEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")),
      1,
      "BOT_INTENT_METADATA_OWNER_COUNT"
    );
    assert.ok(TRPG_BOT_SYSTEM.includes(TRPG_BOT_INTENT_OPEN));
    assert.doesNotMatch(user, new RegExp(TRPG_BOT_ACTION_TYPE_OPEN));
    assert.doesNotMatch(user, new RegExp(TRPG_BOT_INTENT_OPEN));
  });

  it("BOT_SCOPE_CONTRACT owned by system; user has no length block", () => {
    const user = bot1User();
    assert.match(TRPG_BOT_SYSTEM, /one coherent finished PC action beat/i);
    assert.match(TRPG_BOT_SYSTEM, /Do not expand into a full GM scene/i);
    assert.doesNotMatch(TRPG_BOT_SYSTEM, /300–800/);
    assert.doesNotMatch(TRPG_BOT_SYSTEM, /aim about 550/);
    assert.doesNotMatch(user, /\[LENGTH\]/);
    assert.doesNotMatch(user, /Follow the system length contract/);
    assert.doesNotMatch(user, /300–800/);
    assert.doesNotMatch(user, /aim ~\d+/);
    assert.equal(countRegex(TRPG_BOT_SYSTEM, /^Length:/m), 0);
  });

  it("BOT_TURN_ORDER_BEHAVIOR_OWNER_COUNT = 1 (user [SPEAK ORDER] only)", () => {
    const user = bot2User();
    assert.doesNotMatch(TRPG_BOT_SYSTEM, /Turn order:/);
    assert.doesNotMatch(TRPG_BOT_SYSTEM, /human already acted/i);
    assert.match(user, /\[SPEAK ORDER\]/);
    assert.match(user, /companion 2 of 2/);
    assert.equal(countRegex(TRPG_BOT_SYSTEM, /already acted this round/gi), 0);
  });

  it("BOT_NO_RESULT_AUTHORITY_OWNER_COUNT = 1 (system owns open outcomes)", () => {
    const user = bot1User();
    assert.match(TRPG_BOT_SYSTEM, /Do not declare a finished result/);
    assert.match(TRPG_BOT_SYSTEM, /Do not resolve the round/);
    assert.match(TRPG_BOT_SYSTEM, /mechanical outcomes remain open until round resolution/);
    assert.doesNotMatch(user, /one attempt, not a finished result/);
    assert.doesNotMatch(user, /Finished beat, then INTENT/);
    assert.doesNotMatch(user, /then emit/i);
  });

  it("BOT_PROSE_CONTRACT and BOT_INTENT_METADATA stay system-owned", () => {
    assert.match(TRPG_BOT_SYSTEM, /Write one finished novelistic beat/);
    assert.ok(TRPG_BOT_SYSTEM.includes(TRPG_BOT_ACTION_TYPE_OPEN));
    assert.ok(TRPG_BOT_SYSTEM.includes(TRPG_BOT_INTENT_OPEN));
    assert.equal((TRPG_BOT_SYSTEM.match(/\[PROSE LAYOUT\]/g) ?? []).length, 1);
    const user = bot1User();
    assert.doesNotMatch(user, /\[PROSE LAYOUT\]/);
  });

  it("GM scene/tone/length/speech/narrator owners remain count=1", () => {
    assert.equal((TRPG_GM_SYSTEM.match(/\[NARRATOR REGISTER\]/g) ?? []).length, 1);
    assert.equal((TRPG_GM_SYSTEM.match(/\[SPEECH FORMAT\]/g) ?? []).length, 1);
    assert.equal((TRPG_GM_SYSTEM.match(/\[GM SCENE CRAFT — ADAPTIVE NARRATION\]/g) ?? []).length, 1);
    assert.equal((TRPG_GM_SYSTEM.match(/\[TONE\]/g) ?? []).length, 1);
    assert.equal((TRPG_GM_SYSTEM.match(/\[LENGTH — SCENE RESPONSIVE\]/g) ?? []).length, 1);
    const user = gmSparseUser();
    assert.match(user, /\[ROUND EXECUTION — binding\]/);
    assert.match(user, /\[ROUND NARRATION BUDGET\]/);
    assert.equal((user.match(/\[GM SCENE CRAFT — ADAPTIVE NARRATION\]/g) ?? []).length, 1);
    assert.doesNotMatch(user, /\[SPEECH FORMAT\]/);
    assert.doesNotMatch(user, /\[GM SCENE CRAFT — ADAPTIVE NARRATION\]\nContinue timeline/);
  });

  it("PRESENTATION_UI_PROMPT_LEAK_COUNT = 0 in assembled Bot/GM prompts", () => {
    const uiTerms = [
      "overlay",
      "followLatest",
      "presentationIndex",
      "actor-dice",
      "actor-result",
      "declarationReveal",
      "ResizeObserver",
      "result hold",
    ];
    const corpus = [TRPG_BOT_SYSTEM, bot1User(), bot2User(), TRPG_GM_SYSTEM, gmSparseUser(), gmRichUser()].join(
      "\n"
    );
    for (const term of uiTerms) {
      assert.doesNotMatch(corpus, new RegExp(term, "i"), `UI leak: ${term}`);
    }
  });

  it("Bot1 does not receive roll/result; Bot2 receives Bot1 action only", () => {
    const b1 = bot1User();
    assert.match(b1, /HUMAN ACTIONS THIS ROUND/);
    assert.match(b1, /\(없음 — 당신이 인간 다음 첫 번째 동료\)/);
    assert.doesNotMatch(b1, /d20=/);
    assert.doesNotMatch(b1, /tier=/);
    assert.doesNotMatch(b1, /EARLIER COMPANION ACTIONS[\s\S]*유나는/);

    const b2 = bot2User();
    assert.match(b2, /유나는 렌의 앞을 막으며/);
    assert.doesNotMatch(b2, /유나가 창가에 붙는다/);
    assert.doesNotMatch(b2, /d20=/);
    assert.doesNotMatch(b2, /tier=/);
    assert.doesNotMatch(b2, /FAILURE|SUCCESS|CRITICAL/);
  });

  it("GM receives authoritative rolls; GM secret stays hidden-only in user block", () => {
    const gm = gmSparseUser();
    assert.match(gm, /d20=14/);
    assert.match(gm, /tier=SUCCESS/);
    assert.doesNotMatch(gm, /\[GM SECRET/);
    const gmSecret = buildTrpgGmUserBlock({
      worldBrief: "폐여관",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: false,
      gmSecret: "숨겨진 비밀",
      actions: [],
    });
    assert.match(gmSecret, /\[GM SECRET — never quote/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /숨겨진 비밀/);
  });

  it("provider prompt layers: system + user only; no hidden TRPG prompt suffix", () => {
    const gmCall = readFileSync("src/lib/trpg/gmCall.ts", "utf8");
    const gmClient = readFileSync("src/lib/trpg/gmClient.ts", "utf8");
    assert.match(gmCall, /messages:\s*\[\s*\{\s*role:\s*"system"/);
    assert.match(gmCall, /role:\s*"user"/);
    assert.doesNotMatch(gmClient, /TRPG_.*_SYSTEM/);
    assert.doesNotMatch(gmCall, /TRPG_GM_SYSTEM\s*\+/);
  });

  it("reports assembled prompt char sizes for regression tracking", () => {
    const sizes = {
      BOT_SYSTEM_CHARS: TRPG_BOT_SYSTEM.length,
      BOT1_USER_CHARS: bot1User().length,
      BOT2_USER_CHARS: bot2User().length,
      GM_SYSTEM_CHARS: TRPG_GM_SYSTEM.length,
      GM_USER_SPARSE_CHARS: gmSparseUser().length,
      GM_USER_RICH_CHARS: gmRichUser().length,
    };
    assert.ok(sizes.BOT_SYSTEM_CHARS > 500);
    assert.ok(sizes.BOT1_USER_CHARS > 200);
    assert.ok(sizes.BOT2_USER_CHARS > sizes.BOT1_USER_CHARS);
    assert.ok(sizes.GM_SYSTEM_CHARS > 1000);
    assert.ok(sizes.GM_USER_RICH_CHARS > sizes.GM_USER_SPARSE_CHARS);
  });
});
