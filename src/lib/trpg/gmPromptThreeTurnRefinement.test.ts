import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TRPG_GM_BRIEF_MAX_CHARS,
  TRPG_GM_MIXED_MIN_CHARS,
  TRPG_GM_MIXED_TARGET_MAX_CHARS,
  TRPG_GM_MIXED_TARGET_MIN_CHARS,
  TRPG_GM_RICH_BUDGET_MIN_CHARS,
  TRPG_GM_RICH_MIN_CHARS,
  TRPG_GM_RICH_TARGET_MAX_CHARS,
  TRPG_GM_RICH_TARGET_MIN_CHARS,
  TRPG_GM_SPARSE_MIN_CHARS,
  TRPG_GM_SPARSE_TARGET_MAX_CHARS,
  TRPG_GM_SPARSE_TARGET_MIN_CHARS,
  computeTrpgGmNarrationBudget,
  countTrpgNarrationChars,
  formatTrpgRoundNarrationBudget,
} from "./gmNarrationBudget";
import { buildTrpgGmUserBlock, TRPG_GM_SYSTEM } from "./gmPrompt";

const SYSTEM_PROMPT_CHARS_BEFORE = 10600;

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

function countDuplicatedActionBodies(block: string, bodies: readonly string[]): number {
  let duplicated = 0;
  for (const body of bodies) {
    const trimmed = body.trim();
    const occurrences = block.split(trimmed).length - 1;
    if (occurrences > 1) duplicated += occurrences - 1;
  }
  return duplicated;
}

function legacyActionBlock(
  actions: Parameters<typeof buildTrpgGmUserBlock>[0]["actions"]
): string {
  return actions
    .map((a) => {
      const attempted = (a.intent ?? "").trim() || a.body.trim();
      return [
        `[ACTION participantId=${a.participantId} name=${a.name}]`,
        `[ROLL d20=${a.d20} total=${a.finalScore} DC=${a.dc} tier=${a.tier} stat=str]`,
        `[ATTEMPTED ACTION — resolve this]\n${attempted}`,
        `[PROPOSED FICTION — their wording; enrich if brief, do not retell if already rich]\n${a.body.trim()}`,
      ].join("\n");
    })
    .join("\n\n");
}

function legacyUserBlockForFixture(): string {
  const brief = "문을 연다.";
  const richA = padRich("그녀는 방패를 들어 앞으로 밀었다.");
  const richB = padRich("그는 검을 역수로 고쳐 쥐었다.");
  const actions = [
    action({ participantId: 1, name: "렌", body: brief }),
    action({ participantId: 2, name: "유나", body: richA, intent: "방패로 전진한다" }),
    action({ participantId: 3, name: "솔", body: richB, intent: "측면을 찌른다" }),
  ];
  const narrationBudget = formatTrpgRoundNarrationBudget(
    computeTrpgGmNarrationBudget(actions.map((entry) => entry.body))
  );
  return [
    "[RESOLVE THIS ROUND]",
    "[WORLD]\n폐역",
    "[SCENE CRAFT] Follow GM SCENE CRAFT. Invent extras if the place would not be empty. After PC results, move the world yourself. End with 1–2 GM: sentences that name live pressure; players supply the approach.",
    narrationBudget,
    legacyActionBlock(actions),
  ].join("\n\n");
}

function extractActionBlock(userBlock: string): string {
  const start = userBlock.indexOf("[ACTION participantId=");
  return start >= 0 ? userBlock.slice(start) : userBlock;
}

function refinementFixtureBlock(): string {
  const brief = "문을 연다.";
  const richA = padRich("그녀는 방패를 들어 앞으로 밀었다.");
  const richB = padRich("그는 검을 역수로 고쳐 쥐었다.");
  return buildTrpgGmUserBlock({
    worldBrief: "폐역",
    memoryBlock: "",
    opening: false,
    actions: [
      action({ participantId: 1, name: "렌", body: brief }),
      action({ participantId: 2, name: "유나", body: richA, intent: "방패로 전진한다" }),
      action({ participantId: 3, name: "솔", body: richB, intent: "측면을 찌른다" }),
    ],
  });
}

function negativeCreativeClauseCount(text: string): number {
  const craft = text.slice(
    text.indexOf("[GM SCENE CRAFT — ADAPTIVE NARRATION]"),
    text.indexOf("[LENGTH — SCENE RESPONSIVE]")
  );
  return (craft.match(/\b(do not|never|Never|Don't)\b/gi) ?? []).length;
}

describe("TRPG GM post-#602 three-turn refinement A–I", () => {
  it("A: system owner — one continuation owner, no duplicate assembly, no new section", () => {
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Weave all submitted actions into ONE scene/i);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Turn all submitted actions into one chronological scene/i);
    assert.match(TRPG_GM_SYSTEM, /Continue timeline from submitted actions/);
    assert.equal((TRPG_GM_SYSTEM.match(/\[GM SCENE CRAFT — ADAPTIVE NARRATION\]/g) ?? []).length, 1);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[FAILURE\]/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[CONTINUITY\]/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[CLOSING\]/);
  });

  it("B: rich action — density visible, body once, optional intent, first-new-consequence owner", () => {
    const richBody = padRich("그는 검을 역수로 고쳐 쥐었다. 바닥을 박차고 놈의 측면으로 파고들었다.");
    const block = buildTrpgGmUserBlock({
      worldBrief: "폐역",
      memoryBlock: "",
      opening: false,
      actions: [action({ participantId: 1, name: "렌", body: richBody, intent: "측면을 찌른다" })],
    });
    assert.match(block, /density=RICH/);
    assert.match(block, /\[INTENT\]\n측면을 찌른다/);
    assert.match(block, /\[VISIBLE ACTION PROSE — established context for its outcome\]/);
    assert.equal(block.split(richBody.trim()).length - 1, 1);
    assert.match(TRPG_GM_SYSTEM, /first new consequence or changed state/i);
  });

  it("C: no-intent action — body occurs exactly once", () => {
    const body = "문을 연다.";
    const block = buildTrpgGmUserBlock({
      worldBrief: "폐역",
      memoryBlock: "",
      opening: false,
      actions: [action({ participantId: 1, name: "렌", body })],
    });
    assert.doesNotMatch(block, /\[INTENT\]/);
    assert.match(block, /\[ACTION PROSE — scene material for this resolution\]/);
    assert.equal(block.split(body).length - 1, 1);
  });

  it("D: brief/mid action — body available as scene material", () => {
    const body = "뒤를 살핀다.";
    const block = buildTrpgGmUserBlock({
      worldBrief: "폐역",
      memoryBlock: "",
      opening: false,
      actions: [action({ participantId: 1, name: "렌", body })],
    });
    assert.match(block, /density=BRIEF/);
    assert.match(block, /\[ACTION PROSE — scene material for this resolution\]/);
    assert.equal(block.split(body).length - 1, 1);
    assert.match(TRPG_GM_SYSTEM, /BRIEF\/MID get vivid motion/);
  });

  it("E: failure — credible technique, critical escalation, clustered setback cap", () => {
    assert.match(TRPG_GM_SYSTEM, /Failure: intended result does not fully land/);
    assert.match(TRPG_GM_SYSTEM, /Critical failure: self-inflicted blunder/);
    assert.match(TRPG_GM_SYSTEM, /fold them into one coherent setback/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Across concurrent and nearby failures, vary source and consequence/);
    assert.equal(
      (TRPG_GM_SYSTEM.match(/Failure: intended result does not fully land/g) ?? []).length,
      1
    );
  });

  it("F: partial success owner", () => {
    assert.match(TRPG_GM_SYSTEM, /partial success yields meaningful progress with bounded cost or limit/i);
  });

  it("G: closing — one owner, immediate pressure, no user-block duplicate", () => {
    assert.match(TRPG_GM_SYSTEM, /End on the most immediate unresolved pressure/);
    assert.match(TRPG_GM_SYSTEM, /player control returns/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /players supply the approach/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /open agency point/);
    const block = buildTrpgGmUserBlock({
      worldBrief: "폐역",
      memoryBlock: "",
      opening: false,
      actions: [action({ participantId: 1, name: "렌", body: "문을 연다." })],
    });
    assert.match(block, /Apply the system scene-craft contract and ROUND NARRATION BUDGET/);
    assert.doesNotMatch(block, /players supply the approach/);
    assert.doesNotMatch(block, /End with 1–2 GM:/);
  });

  it("H: length budgets unchanged", () => {
    assert.equal(TRPG_GM_SPARSE_MIN_CHARS, 2800);
    assert.equal(TRPG_GM_SPARSE_TARGET_MIN_CHARS, 3600);
    assert.equal(TRPG_GM_SPARSE_TARGET_MAX_CHARS, 4600);
    assert.equal(TRPG_GM_MIXED_MIN_CHARS, 2400);
    assert.equal(TRPG_GM_MIXED_TARGET_MIN_CHARS, 3000);
    assert.equal(TRPG_GM_MIXED_TARGET_MAX_CHARS, 4000);
    assert.equal(TRPG_GM_RICH_BUDGET_MIN_CHARS, 2000);
    assert.equal(TRPG_GM_RICH_TARGET_MIN_CHARS, 2500);
    assert.equal(TRPG_GM_RICH_TARGET_MAX_CHARS, 3500);
    assert.equal(TRPG_GM_BRIEF_MAX_CHARS, 160);
    assert.equal(TRPG_GM_RICH_MIN_CHARS, 350);
  });

  it("J: encounter progression opens outward without forced relocation", () => {
    const craft = TRPG_GM_SYSTEM.slice(
      TRPG_GM_SYSTEM.indexOf("[GM SCENE CRAFT — ADAPTIVE NARRATION]"),
      TRPG_GM_SYSTEM.indexOf("[LENGTH — SCENE RESPONSIVE]")
    );
    assert.match(craft, /As encounter purpose is spent — or local scene state is transition_ready — open fiction outward/);
    assert.match(craft, /reachable space, destination, route, objective, or consequence/);
    assert.match(craft, /sceneTransitionTo rather than objectiveSet alone/);
    assert.match(craft, /one location may still yield new play until then/);
    assert.match(craft, /movement stays player choice/);
    assert.doesNotMatch(craft, /every N rounds|turn-count|forced relocation cadence/i);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[PROGRESSION\]/);
    assert.equal((TRPG_GM_SYSTEM.match(/\[GM SCENE CRAFT — ADAPTIVE NARRATION\]/g) ?? []).length, 1);
  });

  it("I: system size and round user block fixture comparison", () => {
    const afterBlock = refinementFixtureBlock();
    const beforeBlock = legacyUserBlockForFixture();
    const bodies = ["문을 연다.", padRich("그녀는 방패를 들어 앞으로 밀었다."), padRich("그는 검을 역수로 고쳐 쥐었다.")];
    const afterActionBlock = extractActionBlock(afterBlock);
    const beforeActionBlock = extractActionBlock(beforeBlock);

    assert.ok(TRPG_GM_SYSTEM.length <= SYSTEM_PROMPT_CHARS_BEFORE);
    assert.equal(countDuplicatedActionBodies(afterBlock, bodies), 0);
    assert.ok(countDuplicatedActionBodies(beforeBlock, bodies) >= 1);
    assert.ok(afterActionBlock.length < beforeActionBlock.length);
    assert.ok(afterBlock.length < beforeBlock.length);
  });
});
