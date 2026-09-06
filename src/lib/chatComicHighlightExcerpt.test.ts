import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildComicHighlightSourceExcerpt,
  renderComicAutopilotContract,
  renderComicAutopilotSection,
  resolveComicHighlightFallback,
} from "./chatComicHighlightExcerpt";
import { buildChatComicImagePrompt } from "./chatComicGeneration";
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
    assert.equal(excerpt.audit.narrativeSourceOwner, "canonical_events_only", "proven structural owner");
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
    assert.doesNotMatch(auto, /0-2 short narration boxes/, "narration budget owned by text brief, not composition contract");
    assert.match(auto, /Choose camera, framing, reactions, balloon placement/);
    assert.match(auto, /Use only spoken lines from the selected source scene/, "DIALOGUE-1 source-only contract");
    assert.doesNotMatch(auto, /invent unrelated dialogue/, "DIALOGUE-2 no related-invention invitation");
    assert.match(renderComicAutopilotContract(3), /exactly 3 panels/);
    assert.match(renderComicAutopilotContract(4), /exactly 4 panels/);
  });

  it("SAFE-1/2/3/4 safe projection applied to selected excerpt without mutating canonical", () => {
    const events = [
      event(1, "SA1", "dialogue", "character", "오늘은 날씨가 좋네.", "태형"),
      event(2, "SA2", "action", "character", "피를 흘리며 손을 다쳤다."),
    ];
    const plan = planFromEvents(events);
    const selection = { anchorEventId: "SA1", focusEventIds: ["SA1", "SA2"] };
    // SAFE-1: safe dialogue preserved.
    const safe = buildComicHighlightSourceExcerpt(plan, selection, BINDING);
    assert.ok(safe.text.includes("오늘은 날씨가 좋네."));
    // SAFE-3: unsafe visual prose is projected (graphic/violence-sensitive action).
    const projected = buildComicHighlightSourceExcerpt(plan, selection, BINDING, {
      visualProjectionAdultGrounded: false,
    });
    assert.ok(!projected.text.includes("피를 흘리며"), "unsafe action prose projected/omitted");
    // SAFE-5: canonical events unchanged.
    assert.equal(plan.events[1]!.text, "피를 흘리며 손을 다쳤다.");
  });

  it("SAFE-4 adult eligibility parity — eligible adult dialogue kept, ineligible omitted", () => {
    const events = [
      event(1, "AD1", "dialogue", "character", "성관계를 하고 싶어.", "태형"),
    ];
    const plan = planFromEvents(events);
    const selection = { anchorEventId: "AD1", focusEventIds: ["AD1"] };
    const adultEligible = buildComicHighlightSourceExcerpt(plan, selection, BINDING, {
      providerReadableDialogueAdultEligible: true,
    });
    assert.ok(adultEligible.text.includes("성관계를 하고 싶어."), "adult-eligible dialogue kept");
    const notEligible = buildComicHighlightSourceExcerpt(plan, selection, BINDING, {
      providerReadableDialogueAdultEligible: false,
    });
    assert.doesNotMatch(notEligible.text, /성관계/, "ineligible adult dialogue omitted by existing contract");
  });

  it("SAFE-PARITY-1..6 visual projection and dialogue eligibility are independent contexts", () => {
    // Adult-explicit DIALOGUE is governed by the dialogue eligibility context only.
    const events = [
      event(1, "SV1", "dialogue", "character", "성관계를 하고 싶어.", "태형"),
      event(2, "SV2", "action", "character", "겹치며 벗고 눕는다."),
    ];
    const plan = planFromEvents(events);
    const selection = { anchorEventId: "SV1", focusEventIds: ["SV1", "SV2"] };
    // SAFE-PARITY-2: dialogue eligible (room adult mode) while visual projection stays
    // non-adult (normal production) → the dialogue is kept, the explicit visual action
    // is projected away. This mirrors pre-#875 (adultGrounded=false visual context).
    const normalProduction = buildComicHighlightSourceExcerpt(plan, selection, BINDING, {
      providerReadableDialogueAdultEligible: true,
      visualProjectionAdultGrounded: false,
    });
    assert.ok(normalProduction.text.includes("성관계를 하고 싶어."), "SAFE-PARITY-2 dialogue kept");
    assert.doesNotMatch(normalProduction.text, /벗|눕|겹치/, "SAFE-PARITY-3 explicit visual action projected");
    // SAFE-PARITY-4 graphic violence projected; SAFE-PARITY-5 self-harm projected.
    const gvPlan = planFromEvents([event(1, "GV1", "action", "character", "피를 흘리며 베였다.")]);
    const gv = buildComicHighlightSourceExcerpt(gvPlan, { anchorEventId: "GV1", focusEventIds: ["GV1"] }, BINDING, {
      visualProjectionAdultGrounded: false,
    });
    assert.doesNotMatch(gv.text, /피를 흘/, "SAFE-PARITY-4 graphic violence projected");
    const shPlan = planFromEvents([event(1, "SH1", "dialogue", "character", "손목을 긋고 싶다.")]);
    const sh = buildComicHighlightSourceExcerpt(shPlan, { anchorEventId: "SH1", focusEventIds: ["SH1"] }, BINDING, {
      providerReadableDialogueAdultEligible: true,
    });
    assert.doesNotMatch(sh.text, /손목을 긋/, "SAFE-PARITY-5 self-harm omitted by existing eligibility");
    // SAFE-PARITY-6 canonical events unchanged.
    assert.equal(plan.events[1]!.text, "겹치며 벗고 눕는다.");
    assert.equal(gvPlan.events[0]!.text, "피를 흘리며 베였다.");
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

  it("FALLBACK-WIRE-1/2/3 deterministic selection supplied by the route activates autopilot", () => {
    // plan has no comicHighlightSelection; opts supplies the recovery selection.
    const plan = planFromEvents([
      event(1, "W1", "action", "character", "상대를 바라본다"),
      event(2, "W2", "dialogue", "character", "같이 갈래?", "태형"),
      event(3, "W3", "reaction", "persona", "웃는다"),
    ]);
    const fallback = resolveComicHighlightFallback(plan);
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan,
      comicHighlightSelection: fallback,
      comicPanelMode: "auto",
    });
    assert.match(prompt, /SELECTED HIGHLIGHT SOURCE/, "FALLBACK-WIRE-1 autopilot active");
    assert.ok(prompt.includes(fallback.focusEventIds.length > 0 ? "같이 갈래?" : ""), "FALLBACK-WIRE-2 excerpt uses fallback focus");
    assert.doesNotMatch(prompt, /COMIC PANEL SPEC — FULL PROVIDER-RENDERED MANHWA PAGE/, "FALLBACK-WIRE-3 no panel-spec path");
    assert.doesNotMatch(prompt, /exactly \d+ wide horizontal panels/, "AUTO-2 no exact-N contradiction");
  });

  it("PLANNER-WIRE-1 planner selection present is used unchanged", () => {
    const plan = planFromEvents([
      event(1, "P1", "dialogue", "character", "나랑 도망가자.", "태형"),
      event(2, "P2", "reaction", "persona", "웃는다"),
    ]);
    const selection = { anchorEventId: "P1", focusEventIds: ["P1", "P2"] };
    const planWith = { ...plan, comicHighlightSelection: selection };
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan: planWith,
      comicPanelMode: "auto",
    });
    assert.match(prompt, /SELECTED HIGHLIGHT SOURCE/);
    assert.match(prompt, /나랑 도망가자\./);
  });

  it("AUTO-REAL-1/2 real AUTO freedom regardless of underlying plan.panels.length", () => {
    const plan4 = planFromEvents([
      event(1, "R1", "dialogue", "character", "같이 갈래?", "태형"),
      event(2, "R2", "reaction", "persona", "웃는다"),
    ]);
    plan4.recommendedPanelCount = 4;
    plan4.panels = Array.from({ length: 4 }, (_, i) => ({
      index: i + 1,
      sourceEventIds: [],
      situation: "",
      dialogue: [],
    }));
    const autoPrompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan: plan4,
      comicHighlightSelection: { anchorEventId: "R1", focusEventIds: ["R1", "R2"] },
      comicPanelMode: "auto",
    });
    assert.match(autoPrompt, /natural 3- or 4-panel/, "AUTO-1 3-or-4 freedom");
    assert.doesNotMatch(autoPrompt, /exactly 4 panels|exactly 4 wide|exactly 4/, "AUTO-REAL-1 no exact-4 contradiction");
    assert.match(buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan: plan4,
      comicHighlightSelection: { anchorEventId: "R1", focusEventIds: ["R1", "R2"] },
      comicPanelMode: 3,
    }), /exactly 3 panels/, "AUTO-3 manual 3 exact");
    assert.match(buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan: plan4,
      comicHighlightSelection: { anchorEventId: "R1", focusEventIds: ["R1", "R2"] },
      comicPanelMode: 4,
    }), /exactly 4 panels/, "AUTO-4 manual 4 exact");
  });

  it("AUTO-META-1..7 AUTO panel mode is separated from canvas size in the route", () => {
    const route = readFileSync("src/app/api/chat/comic-generation/route.ts", "utf8");
    assert.match(route, /canvasPanelCount/, "canvas size bucket is a distinct owner");
    assert.match(route, /requestedPanelMode === "auto" \? 4 : requestedPanelMode/, "AUTO-META-2 tall canvas");
    assert.match(route, /panelMode: autopilotActive \? requestedPanelMode : undefined/, "AUTO-META-5 panelMode persisted");
    assert.match(route, /panelCount: autopilotActive \? undefined : panelCount/, "AUTO-META-3 response never claims actual 4 for AUTO");
    assert.match(route, /"장면 컷만화"/, "AUTO-META-4 user-visible title does not claim 4");
    assert.match(route, /`장면 \$\{panelCount\}컷`/, "manual title keeps exact count");
    assert.match(route, /chargeReason/, "billing reason present");
  });
});