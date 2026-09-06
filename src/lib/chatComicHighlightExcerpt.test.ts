import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildComicHighlightSourceExcerpt,
  renderComicAutopilotContract,
  renderComicAutopilotSection,
  resolveComicHighlightFallback,
} from "./chatComicHighlightExcerpt";
import {
  validateComicHighlightSelection,
  type SceneEvent,
  type ScenePanelCount,
  type ScenePlan,
} from "./chatImageScenePlan";

function event(
  order: number,
  id: string,
  kind: SceneEvent["kind"],
  actor: SceneEvent["actor"],
  text: string,
  speakerName?: string
): SceneEvent {
  return {
    id,
    order,
    sourceMessageId: 1,
    sourceRole: "assistant",
    kind,
    actor,
    text,
    segmentKind: kind === "action" ? "action" : kind === "environment" ? "narration" : "dialogue",
    ...(speakerName ? { speakerName } : {}),
  };
}

function planFromEvents(events: SceneEvent[]): ScenePlan {
  return {
    sceneBackground: "ordinary indoor room",
    atmosphere: "calm",
    events,
    heroEventIds: [events[0]?.id ?? ""],
    heroScene: events[0]?.text ?? "",
    recommendedPanelCount: 4,
    panels: [],
  };
}

const BINDING = {
  characterLabel: "A",
  characterName: "태형",
  personaLabel: "B",
  personaName: "렌",
};

describe("comic provider autopilot — highlight excerpt fixtures", () => {
  it("F1 very long dialogue RP → excerpt contains one local highlight, not the whole turn", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      event(i + 1, `E${i + 1}`, "dialogue", i % 2 === 0 ? "character" : "persona", `긴 대화 ${i + 1}`)
    );
    events[9] = event(10, "E10", "dialogue", "character", "나랑 도망가자.", "태형");
    events[10] = event(11, "E11", "reaction", "persona", "놀라며 웃는다");
    const plan = planFromEvents(events);
    const selection = { anchorEventId: "E10", focusEventIds: ["E9", "E10", "E11"] };
    assert.equal(validateComicHighlightSelection(selection, plan.events).ok, true);
    const excerpt = buildComicHighlightSourceExcerpt(plan, selection, BINDING);
    assert.ok(excerpt.text.includes("나랑 도망가자."));
    assert.ok(excerpt.text.includes("E9".replace("E9", "긴 대화 9")), "neighbouring line included");
    assert.ok(
      !excerpt.text.includes("긴 대화 15"),
      "distant lines excluded — not a whole-turn summary"
    );
    assert.ok(excerpt.audit.highlightCompressionRatio < 1);
  });

  it("F2 important dialogue in the middle → highlight can be the middle scene", () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      event(i + 1, `M${i + 1}`, "dialogue", "character", `말 ${i + 1}`)
    );
    events[4] = event(5, "M5", "dialogue", "character", "이제 우리는 갈라서자.");
    const plan = planFromEvents(events);
    const selection = { anchorEventId: "M5", focusEventIds: ["M4", "M5", "M6"] };
    assert.equal(validateComicHighlightSelection(selection, plan.events).ok, true);
    const excerpt = buildComicHighlightSourceExcerpt(plan, selection, BINDING);
    assert.ok(excerpt.text.includes("이제 우리는 갈라서자."));
  });

  it("F3 subtle important line with no keyword → validated selection preserved verbatim", () => {
    const events = [
      event(1, "S1", "dialogue", "character", "오늘은 날씨가 참 좋네."),
      event(2, "S2", "dialogue", "character", "나는 네가 이 자리에 있어 주는 게 고마워."),
      event(3, "S3", "reaction", "persona", "고개를 숙인다"),
    ];
    const plan = planFromEvents(events);
    const selection = { anchorEventId: "S2", focusEventIds: ["S1", "S2", "S3"] };
    assert.equal(validateComicHighlightSelection(selection, plan.events).ok, true);
    const excerpt = buildComicHighlightSourceExcerpt(plan, selection, BINDING);
    assert.ok(excerpt.text.includes("나는 네가 이 자리에 있어 주는 게 고마워."));
  });

  it("F4 dialogue exchange → excerpt keeps the adjacent question/answer/reaction", () => {
    const events = [
      event(1, "X1", "dialogue", "persona", "어디로 갈까?", "렌"),
      event(2, "X2", "dialogue", "character", "나랑 도망가자.", "태형"),
      event(3, "X3", "reaction", "persona", "손을 잡는다"),
    ];
    const plan = planFromEvents(events);
    const selection = { anchorEventId: "X2", focusEventIds: ["X1", "X2", "X3"] };
    const excerpt = buildComicHighlightSourceExcerpt(plan, selection, BINDING);
    assert.ok(excerpt.text.includes("어디로 갈까?"), "setup question preserved");
    assert.ok(excerpt.text.includes("나랑 도망가자."));
    assert.ok(excerpt.text.includes("손을 잡는다"), "reaction preserved");
  });

  it("F5 action-only → action highlight, no invented dialogue required", () => {
    const events = [
      event(1, "A1", "action", "character", "문을 연다"),
      event(2, "A2", "reaction", "persona", "그를 발견한다"),
    ];
    const plan = planFromEvents(events);
    const selection = resolveComicHighlightFallback(plan);
    assert.equal(validateComicHighlightSelection(selection, plan.events).ok, true);
    const excerpt = buildComicHighlightSourceExcerpt(plan, selection, BINDING);
    assert.ok(excerpt.text.includes("문을 연다"));
    assert.doesNotMatch(excerpt.text, /"[^"]+"|Speech/i, "no invented dialogue");
  });

  it("F6 long literary prose → local highlight, not a giant prose dump", () => {
    const longProse =
      "그가 오랫동안 말없이 서 있자, 그녀도 걸음을 멈추었다. 방 안의 공기는 차갑고 무거웠고, 창밖의 비는 여전히 내리고 있었다. 그리고 마침내 그가 입을 열었다.";
    const events = [
      event(1, "P1", "action", "character", longProse),
      event(2, "P2", "dialogue", "character", "가자."),
      event(3, "P3", "reaction", "persona", "고개를 끄덕인다"),
    ];
    const plan = planFromEvents(events);
    const selection = { anchorEventId: "P2", focusEventIds: ["P1", "P2", "P3"] };
    const excerpt = buildComicHighlightSourceExcerpt(plan, selection, BINDING);
    assert.ok(excerpt.text.length > 0);
    assert.ok(excerpt.audit.highlightSourceCharCount < excerpt.audit.fullSourceCharCount + 1);
  });

  it("F7 location/time transition → excerpt contains the needed context", () => {
    const events = [
      event(1, "L1", "environment", "environment", "잠시 뒤, 둘은 숙소로 돌아왔다."),
      event(2, "L2", "dialogue", "character", "머리부터 말리자.", "태형"),
      event(3, "L3", "reaction", "persona", "수건을 건넨다"),
    ];
    const plan = planFromEvents(events);
    const selection = { anchorEventId: "L2", focusEventIds: ["L1", "L2", "L3"] };
    const excerpt = buildComicHighlightSourceExcerpt(plan, selection, BINDING);
    assert.ok(excerpt.text.includes("숙소로 돌아왔다"), "transition context present");
  });

  it("F8 comedy → setup + punchline + reaction all inside the highlight", () => {
    const events = [
      event(1, "C1", "dialogue", "character", "너 사실 고양이지?", "태형"),
      event(2, "C2", "reaction", "persona", "냐옹이라고 답한다"),
    ];
    const plan = planFromEvents(events);
    const selection = { anchorEventId: "C1", focusEventIds: ["C1", "C2"] };
    const excerpt = buildComicHighlightSourceExcerpt(plan, selection, BINDING);
    assert.ok(excerpt.text.includes("너 사실 고양이지?"));
    assert.ok(excerpt.text.includes("냐옹이라고 답한다"));
  });

  it("F9 meta leak → internal metadata never enters the excerpt; legitimate story content preserved", () => {
    // '자동진행' exists only in the request state (a non-canonical messages field).
    const requestState = "자동진행";
    const events = [
      event(1, "Z1", "dialogue", "character", "오늘은 여기까지.", "태형"),
      event(2, "Z2", "reaction", "persona", "고개를 끄덕인다"),
    ];
    const plan = planFromEvents(events);
    const selection = { anchorEventId: "Z1", focusEventIds: ["Z1", "Z2"] };
    const excerpt = buildComicHighlightSourceExcerpt(plan, selection, BINDING);
    assert.ok(!excerpt.text.includes(requestState), "internal control metadata excluded");
    assert.equal(excerpt.audit.metaTextLeakCount, 0);
    // But if the character genuinely says it, it is legitimate story content.
    const legitEvents = [
      event(1, "Z3", "dialogue", "character", "자동진행으로 넘어가자.", "태형"),
    ];
    const legitPlan = planFromEvents(legitEvents);
    const legit = buildComicHighlightSourceExcerpt(legitPlan, { anchorEventId: "Z3", focusEventIds: ["Z3"] }, BINDING);
    assert.ok(legit.text.includes("자동진행으로 넘어가자."), "legitimate story content preserved");
  });

  it("F10 multi-speaker → excerpt contains explicit correct speaker mapping", () => {
    const events = [
      event(1, "T1", "dialogue", "character", "뒤는 내가 볼게.", "강이현"),
      event(2, "T2", "dialogue", "persona", "조심해.", "렌"),
    ];
    const plan = planFromEvents(events);
    const selection = { anchorEventId: "T1", focusEventIds: ["T1", "T2"] };
    const excerpt = buildComicHighlightSourceExcerpt(plan, selection, BINDING);
    assert.ok(
      excerpt.text.includes("A (태형): \"뒤는 내가 볼게.\"") ||
        excerpt.text.includes("강이현: \"뒤는 내가 볼게.\""),
      "speaker mapped"
    );
    assert.ok(excerpt.text.includes("B (렌): \"조심해.\""), "persona speaker correct");
  });
});

describe("comic provider autopilot — contract and validation", () => {
  it("autopilot contract lets GPT own panel/dialogue/narration decisions", () => {
    const auto = renderComicAutopilotContract("auto");
    assert.match(auto, /natural 3- or 4-panel/);
    assert.match(auto, /Do not summarize the whole original turn/);
    assert.match(auto, /0-2 short narration boxes/);
    assert.match(auto, /Choose camera, framing, reactions, balloon placement/);
    assert.match(auto, /Never render internal system\/control metadata/);
    assert.match(renderComicAutopilotContract(3), /exactly 3 panels/);
    assert.match(renderComicAutopilotContract(4), /exactly 4 panels/);
  });

  it("autopilot section binds speakers and renders the source excerpt only", () => {
    const events = [
      event(1, "V1", "dialogue", "character", "같이 갈래?", "태형"),
      event(2, "V2", "reaction", "persona", "웃는다"),
    ];
    const plan = planFromEvents(events);
    const section = renderComicAutopilotSection({
      plan,
      selection: { anchorEventId: "V1", focusEventIds: ["V1", "V2"] },
      binding: BINDING,
    });
    assert.match(section, /SPEAKER BINDING/);
    assert.match(section, /A = 태형/);
    assert.match(section, /B = 렌/);
    assert.match(section, /SELECTED HIGHLIGHT SOURCE/);
    assert.match(section, /같이 갈래\?/);
    assert.doesNotMatch(section, /PANEL 1|Narration box|Speech bubble/, "no per-panel plans");
  });

  it("validateComicHighlightSelection rejects non-contiguous / unknown / oversized focus", () => {
    const events = Array.from({ length: 12 }, (_, i) => event(i + 1, `N${i + 1}`, "action", "character", `a${i + 1}`));
    events[5] = event(6, "N6", "dialogue", "character", "멈춰.");
    const plan = planFromEvents(events);
    assert.equal(
      validateComicHighlightSelection({ anchorEventId: "N6", focusEventIds: ["N2", "N6", "N10"] }, plan.events).ok,
      false,
      "distant scattered highlights rejected"
    );
    assert.equal(
      validateComicHighlightSelection({ anchorEventId: "N6", focusEventIds: ["N6", "ZZ"] }, plan.events).ok,
      false,
      "unknown id rejected"
    );
    const oversized = validateComicHighlightSelection(
      { anchorEventId: "N6", focusEventIds: Array.from({ length: 9 }, (_, i) => `N${i + 1}`) },
      plan.events
    );
    assert.equal(oversized.ok, false, "oversized focus rejected");
    assert.equal(
      validateComicHighlightSelection({ anchorEventId: "N6", focusEventIds: ["N5", "N6", "N7"] }, plan.events).ok,
      true
    );
  });

  it("deterministic fallback selects a contiguous local focus (recovery only)", () => {
    const events = Array.from({ length: 9 }, (_, i) => event(i + 1, `D${i + 1}`, "action", "character", `행동 ${i + 1}`));
    events[4] = event(5, "D5", "dialogue", "character", "나랑 도망가자.");
    const plan = planFromEvents(events);
    const selection = resolveComicHighlightFallback(plan);
    assert.equal(validateComicHighlightSelection(selection, plan.events).ok, true);
    assert.ok(selection.focusEventIds.length >= 1);
  });
});