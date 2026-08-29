import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { buildTrpgGmUserBlock, formatTrpgSheetCanon, TRPG_GM_SYSTEM } from "./gmPrompt";
import { probeGmResolutionQuality } from "./gmResolutionProbe";
import { DEFAULT_TRPG_STAT_DEFS } from "./stats";

function gmSceneCraftBlock(): string {
  const start = TRPG_GM_SYSTEM.indexOf("[GM SCENE CRAFT — ADAPTIVE NARRATION]");
  const end = TRPG_GM_SYSTEM.indexOf("[LENGTH — SCENE RESPONSIVE]");
  return start >= 0 && end > start ? TRPG_GM_SYSTEM.slice(start, end) : "";
}

function countOwnerMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

describe("TRPG GM resolution quality — prompt owners", () => {
  it("keeps single replay and failure realization owners", () => {
    const craft = gmSceneCraftBlock();
    assert.equal(countOwnerMatches(craft, /Do not replay, re-quote, closely paraphrase, or re-stage/g), 1);
    assert.equal(countOwnerMatches(craft, /Failure: intended result does not fully land/g), 1);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Across concurrent and nearby failures, vary source and consequence/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Failure keeps technique credible/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /RICH prose is visible/);
    assert.match(TRPG_GM_SYSTEM, /Do not narrate raw stat values, modifiers, d20, DC, or tier/);
    assert.match(craft, /Earlier SUCCESS in \[RESOLUTION ORDER\] stays canon/);
    assert.match(craft, /fold them into one coherent setback/);
  });
});

describe("TRPG GM resolution quality — probe scorer unit tests", () => {
  it("detects dialogue replay, invented PC lines, raw stat prose, and erasure language", () => {
    const bad = probeGmResolutionQuality({
      narration: `렌: "포자층 쪽으로 간다."\n힘 10의 완력으로 문을 밀었다.\n렌의 성공은 무효가 되었다.`,
      actions: [{ participantId: 1, name: "렌", body: '「포자층 쪽으로 간다.」', tier: "SUCCESS" }],
      earlierSuccessNames: ["렌"],
      rollOutcomes: [{ name: "렌", tier: "SUCCESS" }],
    });
    assert.equal(bad.pcDialogueExactReplayCount, 1);
    assert.equal(bad.inventedPcDialogueCount, 1);
    assert.ok(bad.rawStatNumberProseCount >= 1);
    assert.equal(bad.earlierSuccessErasureDetected, true);

    const good = probeGmResolutionQuality({
      narration: "문틈에서 새어 나온 냄새가 코를 찔렀다. 경비의 발소리가 한 층 위에서 멎었다.",
      actions: [{ participantId: 1, name: "렌", body: '「포자층 쪽으로 간다.」' }],
    });
    assert.equal(good.pcDialogueExactReplayCount, 0);
    assert.equal(good.inventedPcDialogueCount, 0);
    assert.equal(good.rawStatNumberProseCount, 0);
    assert.equal(good.earlierSuccessErasureDetected, false);
  });
});

describe("TRPG GM resolution quality — mock provider path (not Gemini quality probe)", () => {
  it("MOCK_PATH: buildTrpgGmUserBlock preserves submitted action prose once", () => {
    const body = '*검을 들어 올린다.* 「앞장 서.」';
    const block = buildTrpgGmUserBlock({
      worldBrief: "지하 시설",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: false,
      actions: [
        {
          participantId: 1,
          name: "렌",
          body,
          statKey: "str",
          d20: 10,
          finalScore: 12,
          dc: 9,
          tier: "SUCCESS",
        },
      ],
    });
    assert.equal(block.split(body).length - 1, 1);
    assert.match(block, /\[ACTION PROSE|\[VISIBLE ACTION PROSE/);
  });

  it("MOCK_PATH: canned narration passes automatic scorer gates", () => {
    const canned = `공기가 무거워지자 경보등이 한 번 깜빡였다. 복도 끝에서 금속 문이 살짝 흔들렸고, 누군가의 숨소리가 멎었다.`;
    const probe = probeGmResolutionQuality({
      narration: canned,
      actions: [
        { participantId: 1, name: "렌", body: '*검을 들어 올린다.* 「앞장 서.」', tier: "SUCCESS" },
      ],
    });
    assert.equal(probe.pcDialogueExactReplayCount, 0);
    assert.equal(probe.inventedPcDialogueCount, 0);
    assert.equal(probe.rawStatNumberProseCount, 0);
    assert.equal(probe.newConsequenceStart, true);
  });

  it("MOCK_PATH: sheet canon input with raw stats is allowed in user block", () => {
    const sheetCanon = formatTrpgSheetCanon({
      defs: DEFAULT_TRPG_STAT_DEFS,
      sheets: [{ name: "렌", stats: { str: 10, dex: 8, int: 7, wis: 7, cha: 6, con: 6 } }],
    });
    assert.match(sheetCanon, /힘 10/);
    const block = buildTrpgGmUserBlock({
      worldBrief: "지하",
      memoryBlock: "",
      opening: false,
      sheetCanon,
      actions: [],
    });
    assert.match(block, /힘 10/);
  });
});
