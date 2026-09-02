import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { buildTrpgGmUserBlock, formatTrpgSheetCanon, TRPG_GM_SYSTEM } from "./gmPrompt";
import { probeGmResolutionQuality, reviewGmForwardMotionQuality } from "./gmResolutionProbe";
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
  it("keeps single replay, failure, and forward-motion owners", () => {
    const craft = gmSceneCraftBlock();
    assert.equal(countOwnerMatches(craft, /\[ROUND CRAFT\]/g), 1);
    assert.equal(countOwnerMatches(craft, /first new consequence or changed state/gi), 1);
    assert.equal(countOwnerMatches(craft, /Failure: intended result does not fully land/g), 1);
    assert.equal(countOwnerMatches(craft, /compact resolution bridge/gi), 1);
    assert.equal(countOwnerMatches(craft, /substantial majority of narration on NEW/gi), 1);
    assert.equal(countOwnerMatches(craft, /\[AUTHORITATIVE AI PC ATTEMPT — actor-only\]/g), 1);
    assert.equal(countOwnerMatches(craft, /\[AUTHORITATIVE HUMAN PC ACTION — canonical for this PC only\]/g), 1);
    assert.match(craft, /voluntary action[\s\S]*allegiance[\s\S]*inner state/i);
    assert.equal(countOwnerMatches(craft, /each PC's next meaningful decision remains with that player/gi), 1);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[FORWARD MOTION\]/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[STORY PROGRESSION\]/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[NEW MATERIAL\]/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Across concurrent and nearby failures, vary source and consequence/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Failure keeps technique credible/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /RICH prose is visible/);
    assert.match(TRPG_GM_SYSTEM, /Do not narrate raw stat values, modifiers, d20, DC, or tier/);
    assert.match(craft, /Earlier SUCCESS in \[RESOLUTION ORDER\] stays canon/);
    assert.match(craft, /fold them into one coherent setback/);
    assert.match(TRPG_GM_SYSTEM, /not actor recap/);
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

  it("flags actor-by-actor resolution bloat without dialogue replay", () => {
    const bloated = reviewGmForwardMotionQuality({
      narration: [
        "렌이 검을 들어 올리며 앞장서 나아갔다. ".repeat(8),
        "강이현은 포자층을 가리키며 기류를 읽으려 했다. ".repeat(8),
        "권태현이 방패를 세워 후방을 막았다. ".repeat(8),
        "GM: 세 갈래 통로 앞에서 선택해야 합니다.",
      ].join("\n\n"),
      actions: [
        { participantId: 1, name: "렌", body: '*검을 들어 올린다.* 「앞장 서.」', tier: "SUCCESS" },
        { participantId: 2, name: "강이현", body: '*포자층을 가리킨다.* 「저쪽 기류가 이상해.」', tier: "FAILURE" },
        { participantId: 3, name: "권태현", body: '*방패를 세운다.* 「뒤는 내가 맡을게.」', tier: "PARTIAL_SUCCESS" },
      ],
    });
    assert.equal(bloated.ACTION_REPLAY, "NONE");
    assert.equal(bloated.RESOLUTION_BLOAT, "MAJOR");
    assert.match(bloated.notes.join(" "), /RESOLUTION_BLOAT/);

    const combined = reviewGmForwardMotionQuality({
      narration: [
        "렌의 일격이 길을 열었지만 태현의 추가 절단은 표면에 걸려 미끄러졌다. ".repeat(4),
        "통로 너머에서 금속성 마찰음이 빨라지며 포자낭이 일렁였다. ".repeat(4),
        "GM: 좁은 틈을 지금 통과할지 결정해야 합니다.",
      ].join("\n\n"),
      actions: [
        { participantId: 1, name: "렌", body: "균사를 파쇄한다.", tier: "SUCCESS" },
        { participantId: 2, name: "태현", body: "연결부를 절단한다.", tier: "FAILURE" },
      ],
    });
    assert.notEqual(combined.RESOLUTION_BLOAT, "MAJOR");
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
    assert.match(block, /\[AUTHORITATIVE HUMAN PC ACTION|\[AUTHORITATIVE AI PC ATTEMPT/);
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
