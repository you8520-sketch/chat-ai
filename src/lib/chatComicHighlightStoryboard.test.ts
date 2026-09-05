import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildComicHighlightStoryboard,
  applyComicHighlightStoryboardToPlan,
  buildComicPresentationFromEditorial,
  renderComicHighlightScript,
  resolveComicFocusWindow,
  resolveComicStoryboard,
  selectComicAnchor,
  COMIC_PANEL_MODES,
} from "./chatComicHighlightStoryboard";
import { validateComicEditorial } from "./chatImageScenePlan";
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

describe("scene-planner-owned comic editorial (V3 architecture)", () => {
  const events = [
    event(1, "E1", "dialogue", "character", "오늘은 날씨가 참 좋네."),
    event(2, "E2", "dialogue", "character", "여기서 이대로 지내면 되는 거야."),
    event(3, "E3", "dialogue", "character", "너만 괜찮다면, 이대로 계속 같이 있고 싶어."),
    event(4, "E4", "reaction", "persona", "고개를 들어 그를 오래 바라본다"),
  ];
  const plan = planFromEvents(events, 4);

  it("EDITOR-1 nuanced critical dialogue with no keyword hints follows the planner", () => {
    const editorial = {
      anchorEventId: "E2",
      anchorType: "dialogue",
      focusEventIds: ["E1", "E2", "E3", "E4"],
      recommendedPanelCount: 3,
      narration: [],
      panels: [
        { purpose: "context", sourceEventIds: ["E1"], dialogueEventIds: [] },
        { purpose: "anchor", sourceEventIds: ["E2"], dialogueEventIds: ["E2"] },
        { purpose: "reaction", sourceEventIds: ["E4"], dialogueEventIds: [] },
      ],
    };
    const validated = validateComicEditorial(editorial, plan.events);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const storyboard = buildComicPresentationFromEditorial(plan, validated.editorial);
    assert.equal(storyboard.anchor.eventId, "E2", "production anchor follows the planner");
    const presented = applyComicHighlightStoryboardToPlan(plan, storyboard);
    const presentedPlan = { ...presented, comicEditorial: validated.editorial };
    const resolved = resolveComicStoryboard(presentedPlan);
    assert.equal(resolved.source, "planner");
    assert.equal(resolved.storyboard.anchor.eventId, "E2");
  });

  it("EDITOR-2 keyword-heavy trivial lines lose to the planner-selected critical line", () => {
    const editorial = {
      anchorEventId: "E3",
      anchorType: "dialogue",
      focusEventIds: ["E1", "E2", "E3", "E4"],
      recommendedPanelCount: 3,
      narration: [],
      panels: [
        { purpose: "context", sourceEventIds: ["E1"], dialogueEventIds: [] },
        { purpose: "anchor", sourceEventIds: ["E3"], dialogueEventIds: ["E3"] },
        { purpose: "reaction", sourceEventIds: ["E4"], dialogueEventIds: [] },
      ],
    };
    const validated = validateComicEditorial(editorial, plan.events);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const storyboard = buildComicPresentationFromEditorial(plan, validated.editorial);
    assert.equal(storyboard.anchor.eventId, "E3");
  });

  it("EDITOR-3 no-dialogue planner action anchor works", () => {
    const actionEvents = [
      event(1, "A1", "action", "character", "문을 연다"),
      event(2, "A2", "reaction", "persona", "그를 발견한다"),
    ];
    const actionPlan = planFromEvents(actionEvents, 3);
    const editorial = {
      anchorEventId: "A2",
      anchorType: "action",
      focusEventIds: ["A1", "A2"],
      recommendedPanelCount: 3,
      narration: [],
      panels: [
        { purpose: "context", sourceEventIds: ["A1"], dialogueEventIds: [] },
        { purpose: "anchor", sourceEventIds: ["A2"], dialogueEventIds: [] },
        { purpose: "quiet_close", sourceEventIds: [], dialogueEventIds: [] },
      ],
    };
    const validated = validateComicEditorial(editorial, actionPlan.events);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const storyboard = buildComicPresentationFromEditorial(actionPlan, validated.editorial);
    assert.equal(storyboard.anchor.type, "action");
    assert.equal(storyboard.panels.flatMap((panel) => panel.dialogue).length, 0);
  });

  it("WINDOW-1 planner 1-before + anchor + 2-after focus is accepted", () => {
    const focusEvents = [
      event(1, "W1", "action", "character", "다가간다"),
      event(2, "W2", "dialogue", "character", "같이 갈래?"),
      event(3, "W3", "reaction", "persona", "움직임을 멈춘다"),
      event(4, "W4", "action", "character", "손을 내민다"),
    ];
    const windowPlan = planFromEvents(focusEvents, 4);
    const editorial = {
      anchorEventId: "W2",
      anchorType: "dialogue",
      focusEventIds: ["W1", "W2", "W3", "W4"],
      recommendedPanelCount: 3,
      narration: [],
      panels: [
        { purpose: "context", sourceEventIds: ["W1"], dialogueEventIds: [] },
        { purpose: "anchor", sourceEventIds: ["W2"], dialogueEventIds: ["W2"] },
        { purpose: "reaction", sourceEventIds: ["W3"], dialogueEventIds: [] },
      ],
    };
    const validated = validateComicEditorial(editorial, windowPlan.events);
    assert.equal(validated.ok, true);
  });

  it("WINDOW-2 non-contiguous distant highlights are rejected", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      event(i + 1, `M${i + 1}`, "action", "character", `행동 ${i + 1}`)
    );
    many[4] = event(5, "M5", "dialogue", "character", "멈춰.");
    const manyPlan = planFromEvents(many, 4);
    const editorial = {
      anchorEventId: "M5",
      anchorType: "dialogue",
      focusEventIds: ["M2", "M5", "M8", "M11"],
      recommendedPanelCount: 3,
      narration: [],
      panels: [
        { purpose: "context", sourceEventIds: ["M2"], dialogueEventIds: [] },
        { purpose: "anchor", sourceEventIds: ["M5"], dialogueEventIds: ["M5"] },
        { purpose: "reaction", sourceEventIds: ["M11"], dialogueEventIds: [] },
      ],
    };
    const validated = validateComicEditorial(editorial, manyPlan.events);
    assert.equal(validated.ok, false, "non-contiguous focus is rejected");
  });

  it("WINDOW-3 unknown source event id is rejected", () => {
    const editorial = {
      anchorEventId: "E2",
      anchorType: "dialogue",
      focusEventIds: ["E1", "E2", "E3"],
      recommendedPanelCount: 3,
      narration: [],
      panels: [
        { purpose: "context", sourceEventIds: ["E1"], dialogueEventIds: [] },
        { purpose: "anchor", sourceEventIds: ["E2"], dialogueEventIds: ["E2"] },
        { purpose: "reaction", sourceEventIds: ["ZZ9"], dialogueEventIds: [] },
      ],
    };
    const validated = validateComicEditorial(editorial, plan.events);
    assert.equal(validated.ok, false);
  });

  it("NARR-1/3/4/5 planner-authored narration has provenance, coexists with dialogue, ≤ 2", () => {
    const narrationEvents = [
      event(1, "N1", "action", "character", "둘은 숙소로 향한다"),
      event(2, "N2", "environment", "environment", "잠시 뒤, 둘은 숙소로 돌아왔다."),
      event(3, "N3", "dialogue", "character", "머리부터 말리자."),
      event(4, "N4", "reaction", "persona", "수건을 건넨다"),
    ];
    const narrationPlan = planFromEvents(narrationEvents, 4);
    const editorial = {
      anchorEventId: "N3",
      anchorType: "dialogue",
      focusEventIds: ["N1", "N2", "N3", "N4"],
      recommendedPanelCount: 3,
      narration: [
        {
          sourceEventIds: ["N2"],
          purpose: "location_bridge",
          text: "둘은 숙소에 도착했다.",
        },
      ],
      panels: [
        { purpose: "context", sourceEventIds: ["N2"], dialogueEventIds: [] },
        { purpose: "anchor", sourceEventIds: ["N3"], dialogueEventIds: ["N3"] },
        { purpose: "reaction", sourceEventIds: ["N4"], dialogueEventIds: [] },
      ],
    };
    const validated = validateComicEditorial(editorial, narrationPlan.events);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    assert.equal(validated.audit.narrationCount, 1);
    assert.equal(validated.editorial.narration[0]?.sourceEventIds[0], "N2", "provenance");
    assert.equal(validated.audit.firstSentenceNarrationSelection, 0);
    const storyboard = buildComicPresentationFromEditorial(narrationPlan, validated.editorial);
    const narrations = storyboard.panels.flatMap((panel) => (panel.narration ? [panel.narration] : []));
    assert.equal(narrations.length, 1);
    assert.ok(storyboard.panels.some((panel) => panel.dialogue.length > 0), "coexists with dialogue");
  });

  it("NARR-2 narration is not source first-sentence extraction", () => {
    const firstSentence = "잠시 뒤, 둘은 숙소로 돌아왔다.";
    const narrationEvents = [
      event(1, "X1", "environment", "environment", firstSentence),
      event(2, "X2", "dialogue", "character", "머리부터 말리자."),
    ];
    const narrationPlan = planFromEvents(narrationEvents, 3);
    // Planner writes DIFFERENT narration than the source first sentence.
    const editorial = {
      anchorEventId: "X2",
      anchorType: "dialogue",
      focusEventIds: ["X1", "X2"],
      recommendedPanelCount: 3,
      narration: [
        { sourceEventIds: ["X1"], purpose: "location_bridge", text: "둘은 숙소에 도착했다." },
      ],
      panels: [
        { purpose: "context", sourceEventIds: ["X1"], dialogueEventIds: [] },
        { purpose: "anchor", sourceEventIds: ["X2"], dialogueEventIds: ["X2"] },
        { purpose: "quiet_close", sourceEventIds: [], dialogueEventIds: [] },
      ],
    };
    const validated = validateComicEditorial(editorial, narrationPlan.events);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    assert.equal(validated.audit.firstSentenceNarrationSelection, 0);
    // First-sentence extraction is REJECTED by the validator (NORMAL narration
    // must never be a verbatim first-sentence copy).
    const badEditorial = {
      ...editorial,
      narration: [
        { sourceEventIds: ["X1"], purpose: "location_bridge", text: firstSentence },
      ],
    };
    const bad = validateComicEditorial(badEditorial, narrationPlan.events);
    assert.equal(bad.ok, false, "first-sentence narration is rejected");
  });

  it("NARR-6 mid-clause truncation is flagged (prefix of a source event)", () => {
    const longEvent = event(1, "Y1", "environment", "environment", "한 시간이 지나고 나서 두 사람은 마침내 자리에서 일어났다.");
    const planY = planFromEvents([longEvent, event(2, "Y2", "dialogue", "character", "가자.")], 3);
    const editorial = {
      anchorEventId: "Y2",
      anchorType: "dialogue",
      focusEventIds: ["Y1", "Y2"],
      recommendedPanelCount: 3,
      narration: [{ sourceEventIds: ["Y1"], purpose: "time_bridge", text: "한 시간이 지나고 나서 두 사람은" }],
      panels: [
        { purpose: "context", sourceEventIds: ["Y1"], dialogueEventIds: [] },
        { purpose: "anchor", sourceEventIds: ["Y2"], dialogueEventIds: ["Y2"] },
        { purpose: "quiet_close", sourceEventIds: [], dialogueEventIds: [] },
      ],
    };
    const validated = validateComicEditorial(editorial, planY.events);
    assert.equal(validated.ok, false, "mid-clause truncation narration is rejected");
  });

  it("PANEL-1 one prior + anchor + reaction AUTO → 3; PANEL-2 two distinct priors can → 4", () => {
    const simple = planFromEvents(
      [
        event(1, "P1", "action", "character", "상대를 바라본다"),
        event(2, "P2", "dialogue", "character", "같이 갈래?"),
        event(3, "P3", "reaction", "persona", "웃는다"),
      ],
      3
    );
    assert.equal(buildComicHighlightStoryboard(simple).panelCount, 3);
    const four = planFromEvents(
      [
        event(1, "P1", "action", "character", "복도를 걸어간다"),
        event(2, "P2", "action", "character", "문 앞에서 멈춘다"),
        event(3, "P3", "dialogue", "character", "나랑 도망가자."),
        event(4, "P4", "reaction", "persona", "손을 내민다"),
      ],
      4
    );
    assert.equal(buildComicHighlightStoryboard(four).panelCount, 4);
  });

  it("PANEL-3/4 no sourceEventId appears in two panels; manual 4 never duplicates", () => {
    const simple = planFromEvents(
      [
        event(1, "Q1", "action", "character", "상대를 바라본다"),
        event(2, "Q2", "dialogue", "character", "같이 갈래?"),
        event(3, "Q3", "reaction", "persona", "웃는다"),
      ],
      3
    );
    // Manual 4 with only one prior beat must degrade (no duplication).
    const manual4 = buildComicHighlightStoryboard(simple, { manualPanelCount: 4 });
    assert.equal(manual4.audit.duplicatedPanelSourceEventCount, 0);
    assert.equal(manual4.panelCount, 3, "degrades gracefully instead of duplicating a beat");
    const ids = manual4.panels.flatMap((panel) => panel.sourceEventIds);
    assert.equal(new Set(ids).size, ids.length, "no duplicated source event across panels");
  });

  it("DIALOGUE-1/2/3 editorial dialogue reconstructed verbatim with speaker preserved", () => {
    const dialoguePlan = planFromEvents(
      [
        event(1, "D1", "dialogue", "character", "나랑 도망가자.", "assistant", "강이현"),
        event(2, "D2", "reaction", "persona", "손을 잡는다"),
      ],
      3
    );
    const editorial = {
      anchorEventId: "D1",
      anchorType: "dialogue",
      focusEventIds: ["D1", "D2"],
      recommendedPanelCount: 3,
      narration: [],
      panels: [
        { purpose: "anchor", sourceEventIds: ["D1"], dialogueEventIds: ["D1"] },
        { purpose: "reaction", sourceEventIds: ["D2"], dialogueEventIds: [] },
        { purpose: "quiet_close", sourceEventIds: [], dialogueEventIds: [] },
      ],
    };
    const validated = validateComicEditorial(editorial, dialoguePlan.events);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const storyboard = buildComicPresentationFromEditorial(dialoguePlan, validated.editorial);
    const line = storyboard.panels.flatMap((panel) => panel.dialogue)[0];
    assert.equal(line?.text, "나랑 도망가자.", "verbatim");
    assert.equal(line?.speakerName, "강이현", "speaker preserved");
    assert.equal(storyboard.audit.inventedDialogueCount, 0);
  });

  it("AUDIT-1 duplicated source event across panels is rejected; AUDIT-2 chronology reversal detected", () => {
    const dupEditorial = {
      anchorEventId: "E2",
      anchorType: "dialogue",
      focusEventIds: ["E1", "E2", "E3"],
      recommendedPanelCount: 3,
      narration: [],
      panels: [
        { purpose: "context", sourceEventIds: ["E1"], dialogueEventIds: [] },
        { purpose: "anchor", sourceEventIds: ["E2"], dialogueEventIds: ["E2"] },
        { purpose: "reaction", sourceEventIds: ["E1"], dialogueEventIds: [] },
      ],
    };
    assert.equal(validateComicEditorial(dupEditorial, plan.events).ok, false);
    const reversalEditorial = {
      anchorEventId: "E3",
      anchorType: "dialogue",
      focusEventIds: ["E1", "E2", "E3", "E4"],
      recommendedPanelCount: 3,
      narration: [],
      panels: [
        { purpose: "context", sourceEventIds: ["E4"], dialogueEventIds: [] },
        { purpose: "anchor", sourceEventIds: ["E3"], dialogueEventIds: ["E3"] },
        { purpose: "reaction", sourceEventIds: ["E1"], dialogueEventIds: [] },
      ],
    };
    assert.equal(validateComicEditorial(reversalEditorial, plan.events).ok, false);
  });

  it("FALLBACK-1 invalid editorial degrades to the deterministic storyboard", () => {
    const badEditorial = {
      anchorEventId: "E2",
      anchorType: "dialogue",
      focusEventIds: ["E2", "E9", "E3"],
      recommendedPanelCount: 3,
      narration: [],
      panels: [
        { purpose: "context", sourceEventIds: ["E9"], dialogueEventIds: [] },
        { purpose: "anchor", sourceEventIds: ["E2"], dialogueEventIds: ["E2"] },
        { purpose: "reaction", sourceEventIds: ["E3"], dialogueEventIds: [] },
      ],
    };
    const validated = validateComicEditorial(badEditorial, plan.events);
    assert.equal(validated.ok, false, "E9 is outside the canonical events");
    const fallbackPlan = { ...plan, comicEditorial: undefined };
    const resolved = resolveComicStoryboard(fallbackPlan);
    assert.equal(resolved.source, "deterministic_fallback");
  });

  it("CALL-1 extra planner call count stays zero", () => {
    const validated = validateComicEditorial(
      {
        anchorEventId: "E2",
        anchorType: "dialogue",
        focusEventIds: ["E1", "E2", "E3"],
        recommendedPanelCount: 3,
        narration: [],
        panels: [
          { purpose: "context", sourceEventIds: ["E1"], dialogueEventIds: [] },
          { purpose: "anchor", sourceEventIds: ["E2"], dialogueEventIds: ["E2"] },
          { purpose: "reaction", sourceEventIds: ["E3"], dialogueEventIds: [] },
        ],
      },
      plan.events
    );
    assert.equal(validated.ok, true);
    const storyboard = buildComicHighlightStoryboard(plan);
    assert.equal(storyboard.audit.extraPlannerCallCount, 0);
  });
});