import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildComicHighlightStoryboard,
  applyComicHighlightStoryboardToPlan,
  renderComicHighlightScript,
  resolveComicFocusWindow,
  selectComicAnchor,
  COMIC_PANEL_MODES,
} from "./chatComicHighlightStoryboard";
import { COMIC_NARRATION_MAX_CHARS } from "./chatComicNarrationMinifier";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
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
  sourceRole: "user" | "assistant" = "assistant",
  speakerName?: string
): SceneEvent {
  return {
    id,
    order,
    sourceMessageId: 1,
    sourceRole,
    kind,
    actor,
    text,
    segmentKind: kind === "action" ? "action" : kind === "environment" ? "narration" : "dialogue",
    ...(speakerName ? { speakerName } : {}),
  };
}

function planFromEvents(events: SceneEvent[], panelCount: ScenePanelCount = 4): ScenePlan {
  return {
    sceneBackground: "ordinary indoor room",
    atmosphere: "calm",
    events,
    heroEventIds: [events[0]?.id ?? ""],
    heroScene: events[0]?.text ?? "",
    recommendedPanelCount: panelCount,
    panels: [],
  };
}

describe("comic highlight storyboard — fixture matrix", () => {
  it("A. long dialogue-heavy RP selects ONE anchor and a local focus window", () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      event(i + 1, `e${i + 1}`, "dialogue", i % 2 === 0 ? "character" : "persona", `열두 번째 대사 중 ${i + 1}번째 말입니다.`)
    );
    events[7] = event(8, "e8", "dialogue", "character", "나랑 도망가자.");
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    assert.equal(storyboard.audit.anchorEventCount, 1);
    assert.equal(storyboard.anchor.type, "dialogue");
    assert.equal(storyboard.anchor.eventId, "e8", "anchor is the decision-bearing line");
    assert.ok(storyboard.focusWindowEventIds.includes("e8"));
    assert.ok(
      storyboard.focusWindowEventIds.every((id) =>
        storyboard.focusWindowEventIds.indexOf(id) === 0
          ? true
          : Number(id.slice(1)) > Number(storyboard.focusWindowEventIds[storyboard.focusWindowEventIds.indexOf(id) - 1]!.slice(1))
      ),
      "focus window is chronological and contiguous"
    );
    assert.ok(storyboard.focusWindowEventIds.length < plan.events.length, "not whole-turn summary");
  });

  it("B. one powerful dialogue → AUTO 3 (context → anchor → reaction)", () => {
    const events = [
      event(1, "e1", "action", "character", "상대를 바라본다"),
      event(2, "e2", "dialogue", "character", "같이 갈래?"),
      event(3, "e3", "reaction", "persona", "놀라며 미소를 짓는다"),
    ];
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    assert.equal(storyboard.anchor.eventId, "e2");
    assert.equal(storyboard.panelCount, 3);
    assert.deepEqual(
      storyboard.panels.map((panel) => panel.purpose),
      ["context", "anchor", "reaction"]
    );
  });

  it("C. dialogue needing setup → AUTO 4 (context → approach → anchor → reaction)", () => {
    const events = [
      event(1, "e1", "action", "character", "복도를 걸어간다"),
      event(2, "e2", "action", "character", "문 앞에서 멈춘다"),
      event(3, "e3", "dialogue", "character", "나랑 도망가자."),
      event(4, "e4", "reaction", "persona", "손을 내밀며 웃는다"),
    ];
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    assert.equal(storyboard.anchor.eventId, "e3");
    assert.equal(storyboard.panelCount, 4);
    assert.deepEqual(
      storyboard.panels.map((panel) => panel.purpose),
      ["context", "approach", "anchor", "reaction"]
    );
  });

  it("D. no-dialogue action turn → action anchor, zero invented dialogue", () => {
    const events = [
      event(1, "e1", "action", "character", "문 앞에 도착한다"),
      event(2, "e2", "action", "character", "문을 연다"),
      event(3, "e3", "reaction", "persona", "그를 발견하고 멈춘다"),
      event(4, "e4", "action", "character", "조용히 다가간다"),
    ];
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    assert.equal(storyboard.anchor.type, "action");
    assert.equal(storyboard.audit.inventedDialogueCount, 0);
    assert.equal(
      storyboard.panels.flatMap((panel) => panel.dialogue).length,
      0,
      "no invented dialogue on a no-dialogue turn"
    );
  });

  it("E. long literary prose → no prose dump, no first-sentence bias", () => {
    const longProse =
      "그가 오랫동안 말없이 서 있자, 그녀도 그 자리에서 걸음을 멈추었다. 방 안의 공기는 차갑고 무거웠고, 창밖의 비는 여전히 내리고 있었다. 그리고 마침내 그가 입을 열었다.";
    const events = [
      event(1, "e1", "action", "character", longProse),
      event(2, "e2", "reaction", "persona", "고개를 든다"),
    ];
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    for (const panel of storyboard.panels) {
      if (panel.narration) {
        assert.ok(panel.narration.length <= COMIC_NARRATION_MAX_CHARS + 8);
        assert.doesNotMatch(panel.narration, /원문|prose|novel/i);
      }
    }
    assert.equal(storyboard.audit.firstSentenceNarrationSelection, 0);
    assert.equal(storyboard.audit.midClauseTruncationCount, 0);
  });

  it("F. comedy → punchline anchor and reaction preserved", () => {
    const events = [
      event(1, "e1", "dialogue", "character", "너 사실 고양이지?"),
      event(2, "e2", "reaction", "persona", "냐옹이라고 답한다"),
    ];
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    assert.equal(storyboard.anchor.type, "dialogue");
    assert.ok(
      storyboard.panels.some((panel) =>
        panel.dialogue.some((line) => line.text === "너 사실 고양이지?")
      ),
      "punchline preserved verbatim"
    );
  });

  it("G. quiet romance → no artificial escalation (AUTO 3)", () => {
    const events = [
      event(1, "e1", "action", "character", "곁에 앉는다"),
      event(2, "e2", "dialogue", "character", "오늘도 좋았어."),
      event(3, "e3", "reaction", "persona", "어깨에 기대며 미소 짓는다"),
    ];
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    assert.equal(storyboard.panelCount, 3);
    assert.equal(storyboard.audit.inventedEventCount, 0);
  });

  it("H. location transition → short narration bridge", () => {
    const events = [
      event(1, "e1", "action", "character", "둘은 숙소로 향한다"),
      event(2, "e2", "environment", "environment", "잠시 뒤, 둘은 숙소로 돌아왔다."),
      event(3, "e3", "dialogue", "character", "머리부터 말리자."),
      event(4, "e4", "reaction", "persona", "수건을 건넨다"),
    ];
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    const narrations = storyboard.panels.flatMap((panel) => (panel.narration ? [panel.narration] : []));
    assert.ok(narrations.length >= 1, "transition event yields a narration bridge");
    assert.ok(narrations.length <= 2);
    assert.doesNotMatch(narrations.join(" "), /\n|。\s+\S/u, "single complete clauses");
  });

  it("I. very sparse source → AUTO 3 rather than manufacturing a fourth event", () => {
    const events = [
      event(1, "e1", "action", "character", "고개를 든다"),
      event(2, "e2", "dialogue", "character", "안녕."),
    ];
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    assert.equal(storyboard.panelCount, 3);
    assert.equal(storyboard.audit.inventedEventCount, 0);
    assert.ok(
      storyboard.panels.every((panel) => panel.sourceEventIds.length <= 1),
      "no fabricated fourth beat"
    );
  });
});

describe("comic highlight storyboard — regressions", () => {
  it("ANCHOR-1 dialogue present → exactly one primary dialogue anchor", () => {
    const events = [
      event(1, "e1", "action", "character", "다가간다"),
      event(2, "e2", "dialogue", "character", "보고 싶었어."),
      event(3, "e3", "reaction", "persona", "움직임을 멈춘다"),
    ];
    const plan = planFromEvents(events);
    const anchor = selectComicAnchor(plan);
    assert.equal(anchor.type, "dialogue");
    assert.equal(anchor.eventId, "e2");
  });

  it("ANCHOR-2 no meaningful dialogue → exactly one action anchor", () => {
    const events = [
      event(1, "e1", "action", "character", "문을 연다"),
      event(2, "e2", "reaction", "persona", "그를 발견한다"),
      event(3, "e3", "action", "character", "손을 내민다"),
    ];
    const plan = planFromEvents(events);
    const anchor = selectComicAnchor(plan);
    assert.equal(anchor.type, "action");
  });

  it("ANCHOR-3 anchor by semantic importance, not positional last", () => {
    const events = [
      event(1, "e1", "dialogue", "character", "오늘은 날씨가 좋네."),
      event(2, "e2", "dialogue", "character", "좋은 생각이 있어."),
      event(3, "e3", "dialogue", "character", "나랑 도망가자."),
      event(4, "e4", "reaction", "persona", "놀라며 웃는다"),
    ];
    const plan = planFromEvents(events);
    const anchor = selectComicAnchor(plan);
    assert.notEqual(anchor.eventId, "e1", "not first");
    assert.equal(anchor.eventId, "e3", "decision-bearing line wins, not the last line");
  });

  it("WINDOW-1/2/3 focus is chronological, locally connected, and not whole-turn", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      event(i + 1, `e${i + 1}`, "action", i % 2 === 0 ? "character" : "persona", `행동 ${i + 1}`)
    );
    events[9] = event(10, "e10", "dialogue", "character", "멈춰."); // anchor middle
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    const windowIds = storyboard.focusWindowEventIds;
    assert.ok(windowIds.length >= 3 && windowIds.length <= 6);
    const positions = windowIds.map((id) => events.findIndex((event) => event.id === id));
    for (let i = 1; i < positions.length; i += 1) {
      assert.ok(positions[i]! > positions[i - 1]!, "chronological");
      assert.ok(positions[i]! - positions[i - 1]! === 1, "contiguous — no jumps across the turn");
    }
    assert.ok(windowIds.length < 20, "whole-turn coverage NOT required for comic");
    assert.ok(storyboard.focusWindowEventIds.includes("e10"));
  });

  it("DIALOGUE-1/2/3 anchor verbatim, no invented dialogue, essential adjacent allowed", () => {
    const events = [
      event(1, "e1", "dialogue", "persona", "어디?"),
      event(2, "e2", "dialogue", "character", "나랑 도망가자."),
      event(3, "e3", "reaction", "persona", "손을 잡는다"),
    ];
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    const allDialogue = storyboard.panels.flatMap((panel) => panel.dialogue);
    assert.ok(allDialogue.some((line) => line.text === "나랑 도망가자."), "anchor verbatim");
    assert.ok(allDialogue.some((line) => line.text === "어디?"), "essential adjacent dialogue kept");
    assert.equal(storyboard.audit.inventedDialogueCount, 0);
    for (const line of allDialogue) {
      assert.ok(events.some((ev) => ev.kind === "dialogue" && ev.text === line.text), "every line is source verbatim");
    }
  });

  it("NARR-2/3 narration ≤ 2/page and may coexist with dialogue", () => {
    const events = [
      event(1, "e1", "environment", "environment", "한 시간 후, 비가 그치기 시작했다."),
      event(2, "e2", "dialogue", "character", "머리부터 말리자."),
      event(3, "e3", "reaction", "persona", "수건을 건넨다"),
    ];
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    assert.ok(storyboard.narrationCount <= 2);
    const narrationPanels = storyboard.panels.filter((panel) => panel.narration);
    assert.ok(narrationPanels.length <= 2);
    // Narration coexisting with a dialogue panel is allowed (no dialogue-forbidden rule).
    const dialogued = storyboard.panels.find((panel) => panel.dialogue.length > 0);
    assert.ok(dialogued, "dialogue panel exists");
  });

  it("PANEL-4 long source does not force 4; PANEL-5/6 manual 3 and 4 respect source", () => {
    // Long source, simple anchor window → AUTO 3.
    const longTurn = Array.from({ length: 20 }, (_, i) =>
      event(i + 1, `e${i + 1}`, "action", i % 2 === 0 ? "character" : "persona", `행동 ${i + 1}`)
    );
    longTurn[15] = event(16, "e16", "dialogue", "character", "같이 갈래?");
    longTurn[16] = event(17, "e17", "reaction", "persona", "웃으며 고개를 끄덕인다");
    const plan = planFromEvents(longTurn);
    const auto = buildComicHighlightStoryboard(plan);
    assert.equal(auto.panelCount, 3, "long source but simple anchor window → 3");

    const manual4 = buildComicHighlightStoryboard(plan, { manualPanelCount: 4 });
    assert.equal(manual4.panelCount, 4);
    assert.equal(manual4.audit.inventedEventCount, 0, "manual 4 never invents filler");
    const manual3 = buildComicHighlightStoryboard(plan, { manualPanelCount: 3 });
    assert.equal(manual3.panelCount, 3);
  });

  it("DELTA-1 panels advance the micro-scene (distinct source beats per panel)", () => {
    const events = [
      event(1, "e1", "action", "character", "고양이가 다가온다"),
      event(2, "e2", "action", "character", "손을 내민다"),
      event(3, "e3", "dialogue", "character", "얘들아."),
      event(4, "e4", "reaction", "persona", "고양이를 쓰다듬는다"),
    ];
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    const ids = storyboard.panels.map((panel) => panel.sourceEventIds[0]).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, "each panel advances to a distinct source beat");
  });

  it("CALL-1 extra planner call count is zero", () => {
    const events = [event(1, "e1", "action", "character", "다가간다")];
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    assert.equal(storyboard.audit.extraPlannerCallCount, 0);
  });

  it("presentation plan keeps canonical events lossless and swaps panels", () => {
    const events = [
      event(1, "e1", "action", "character", "다가간다"),
      event(2, "e2", "dialogue", "character", "같이 갈래?"),
      event(3, "e3", "reaction", "persona", "고개를 끄덕인다"),
    ];
    const plan = planFromEvents(events, 3);
    const storyboard = buildComicHighlightStoryboard(plan);
    const presented = applyComicHighlightStoryboardToPlan(plan, storyboard);
    assert.equal(presented.events.length, plan.events.length, "canonical events preserved (lossless)");
    assert.equal(presented.recommendedPanelCount, storyboard.panelCount);
    assert.deepEqual(presented.panels.map((panel) => panel.sourceEventIds), storyboard.panels.map((panel) => panel.sourceEventIds));
  });

  it("renderComicHighlightScript is concise with ANCHOR/CONTINUITY/PANEL sections", () => {
    const events = [
      event(1, "e1", "action", "character", "상대를 바라본다"),
      event(2, "e2", "dialogue", "character", "같이 갈래?"),
      event(3, "e3", "reaction", "persona", "웃는다"),
    ];
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    assert.equal(storyboard.panelCount, 3);
    const script = renderComicHighlightScript(storyboard);
    assert.match(script, /COMIC FORMAT: 3 panels/);
    assert.match(script, /ANCHOR: Panel 2 contains the dialogue anchor/);
    assert.match(script, /PANEL 1 — CONTEXT/);
    assert.match(script, /PANEL 2 — ANCHOR/);
    assert.match(script, /PANEL 3 — REACTION/);
    assert.match(script, /같이 갈래\?/);
  });

  it("COMIC_PANEL_MODES = auto | 3 | 4 (2-panel removed)", () => {
    assert.deepEqual([...COMIC_PANEL_MODES], ["auto", 3, 4]);
  });

  it("impact: anchor-first turn still yields a reaction after the anchor", () => {
    const events = [
      event(1, "e1", "dialogue", "character", "나랑 도망가자."),
      event(2, "e2", "reaction", "persona", "놀라며 웃는다"),
    ];
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    assert.equal(storyboard.anchor.eventId, "e1");
    assert.deepEqual(
      storyboard.panels.map((panel) => panel.purpose),
      ["context", "anchor", "reaction"]
    );
  });

  it("impact: same speaker several consecutive lines keeps one anchor", () => {
    const events = [
      event(1, "e1", "dialogue", "character", "첫 번째 말입니다."),
      event(2, "e2", "dialogue", "character", "두 번째 말입니다."),
      event(3, "e3", "dialogue", "character", "좋은 생각이 있어."),
      event(4, "e4", "dialogue", "character", "나랑 도망가자."),
      event(5, "e5", "reaction", "persona", "고개를 끄덕인다"),
    ];
    const plan = planFromEvents(events);
    const storyboard = buildComicHighlightStoryboard(plan);
    assert.equal(storyboard.audit.anchorEventCount, 1);
    assert.equal(storyboard.anchor.eventId, "e4");
  });
});

describe("comic highlight storyboard — deterministic scene builder integration", () => {
  it("works on a message-derived plan (whole-turn events preserved)", () => {
    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([
        { id: 1, role: "user", content: '"같이 갈래?"' },
        { id: 2, role: "assistant", content: '*놀라며 웃는다* "그래."' },
      ]),
      2
    );
    const storyboard = buildComicHighlightStoryboard(plan);
    assert.equal(storyboard.audit.inventedEventCount, 0);
    assert.ok(storyboard.panelCount === 3 || storyboard.panelCount === 4);
    const presented = applyComicHighlightStoryboardToPlan(plan, storyboard);
    assert.equal(presented.events.length, plan.events.length);
  });
});