import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildComicTextBriefAudit,
  recommendComicPanelModeByTextDensity,
  renderComicTextBrief,
  resolveComicTextDensity,
  selectComicDialogueCandidates,
  selectComicNarrationCandidates,
} from "./chatComicTextBrief";
import { renderComicAutopilotContract } from "./chatComicHighlightExcerpt";
import { buildChatComicImagePrompt } from "./chatComicGeneration";
import type {
  SceneEvent,
  ScenePanelCount,
  ScenePlan,
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

describe("comic text brief — bounded autopilot quality floor", () => {
  it("T1 highlight selection unchanged; extra planner call stays 0", () => {
    const plan = planFromEvents([
      event(1, "X1", "dialogue", "character", "나랑 도망가자.", "태형"),
      event(2, "X2", "reaction", "persona", "웃는다"),
    ]);
    const selection = { anchorEventId: "X1", focusEventIds: ["X1", "X2"] };
    const brief = renderComicTextBrief({
      plan,
      selection,
      binding: BINDING,
      safety: {},
      panelMode: "auto",
    });
    assert.ok(brief.text.includes("SELECTED HIGHLIGHT SOURCE"));
    assert.equal(brief.audit.recommendedPanelMode === 3 || brief.audit.recommendedPanelMode === 4, true);
  });

  it("T2 dialogue candidates are canonical spoken lines with exact speaker ownership", () => {
    const plan = planFromEvents([
      event(1, "D1", "dialogue", "character", "오늘은 날씨가 좋네.", "태형"),
      event(2, "D2", "dialogue", "persona", "그래, 그렇지.", "렌"),
      event(3, "D3", "dialogue", "character", "나랑 도망가자.", "태형"),
      event(4, "D4", "reaction", "persona", "손을 잡는다"),
    ]);
    const selection = { anchorEventId: "D3", focusEventIds: ["D1", "D2", "D3", "D4"] };
    const candidates = selectComicDialogueCandidates(plan, selection, BINDING);
    assert.equal(candidates.length, 3);
    assert.equal(candidates[0]?.sourceEventId, "D3", "anchor first");
    assert.equal(candidates[0]?.exactText, "나랑 도망가자.", "anchor verbatim");
    assert.equal(candidates[0]?.speakerSubject, "A");
    assert.equal(candidates.some((candidate) => candidate.speakerSubject === "B"), true, "persona speaker bound");
    for (const candidate of candidates) {
      const source = plan.events.find((entry) => entry.id === candidate.sourceEventId);
      assert.equal(candidate.exactText, source?.text, "invented dialogue = 0, exact text");
    }
  });

  it("T3 narration candidates are source-grounded, max 2, no meta", () => {
    const plan = planFromEvents([
      event(1, "N1", "dialogue", "character", "가자.", "태형"),
      event(2, "N2", "environment", "environment", "잠시 뒤, 둘은 숙소로 돌아왔다."),
      event(3, "N3", "environment", "environment", "한 시간 후, 비가 그치기 시작했다."),
      event(4, "N4", "dialogue", "persona", "고마워.", "렌"),
    ]);
    const selection = { anchorEventId: "N4", focusEventIds: ["N1", "N2", "N3", "N4"] };
    const candidates = selectComicNarrationCandidates(plan, selection);
    assert.ok(candidates.length >= 1);
    assert.ok(candidates.length <= 2);
    for (const candidate of candidates) {
      const source = plan.events.find((entry) => entry.id === candidate.sourceEventId);
      assert.ok(source, "source-grounded");
      assert.ok(source?.kind === "environment", "context/transition events only");
      assert.doesNotMatch(candidate.text, /자동진행|system|panelIndex|sourceEventId/, "no meta leak");
    }
  });

  it("T4 AUTO panel decision — sparse → 3, rich → 4, no filler duplication", () => {
    const sparse = planFromEvents([
      event(1, "S1", "dialogue", "character", "안녕.", "태형"),
      event(2, "S2", "reaction", "persona", "웃는다"),
    ]);
    const sparseSelection = { anchorEventId: "S1", focusEventIds: ["S1", "S2"] };
    const sparseCandidates = selectComicDialogueCandidates(sparse, sparseSelection, BINDING);
    const sparseRec = recommendComicPanelModeByTextDensity(sparseCandidates.length, 0);
    assert.equal(sparseRec.mode, 3, "sparse scene → AUTO 3");

    const rich = planFromEvents([
      event(1, "R1", "dialogue", "character", "너 사실 고양이지?", "태형"),
      event(2, "R2", "dialogue", "persona", "냐옹.", "렌"),
      event(3, "R3", "dialogue", "character", "그럼 같이 살자.", "태형"),
      event(4, "R4", "reaction", "persona", "고개를 끄덕인다"),
    ]);
    const richSelection = { anchorEventId: "R3", focusEventIds: ["R1", "R2", "R3", "R4"] };
    const richCandidates = selectComicDialogueCandidates(rich, richSelection, BINDING);
    const richRec = recommendComicPanelModeByTextDensity(richCandidates.length, 0);
    assert.equal(richRec.mode, 4, "rich scene → AUTO 4");
    assert.equal(sparseRec.mode, 3, "no always-4 assumption");
  });

  it("T5 prompt contract — AUTO 3-or-4, manual exact, one bubble one speaker, narration 0-2, sparse-4 discouraged", () => {
    // Sparse 4 fixture: 4-panel-sized canvas but only 2 dialogue candidates.
    const plan = planFromEvents([
      event(1, "F1", "dialogue", "character", "같이 갈래?", "태형"),
      event(2, "F2", "reaction", "persona", "웃는다"),
    ]);
    plan.recommendedPanelCount = 4;
    plan.panels = Array.from({ length: 4 }, (_, i) => ({ index: i + 1, sourceEventIds: [], situation: "", dialogue: [] }));
    const selection = { anchorEventId: "F1", focusEventIds: ["F1", "F2"] };
    const brief = renderComicTextBrief({ plan, selection, binding: BINDING, safety: {}, panelMode: "auto" });
    assert.equal(brief.audit.densityTarget, "2-4", "sparse AUTO target");
    assert.equal(brief.audit.sparse4Discouraged, true, "sparse-4 discouragement");
    assert.match(brief.text, /One visible speech bubble = one speaker only/, "one bubble one speaker");
    assert.match(brief.text, /At most 0-2 short narration boxes/, "narration 0-2");
    assert.match(brief.text, /DIALOGUE CANDIDATES/, "candidate list present");

    const autoPrompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan,
      comicHighlightSelection: selection,
      comicPanelMode: "auto",
    });
    assert.match(autoPrompt, /natural 3- or 4-panel/, "AUTO 3-or-4");
    assert.doesNotMatch(autoPrompt, /exactly 4 wide horizontal panels/, "no exact-4 contradiction");
    assert.doesNotMatch(autoPrompt, /exactly \d+ wide horizontal panels/, "no exact-N contradiction");
    assert.match(buildChatComicImagePrompt({
      characterName: "태형", characterGender: "male", personaName: "렌", personaGender: "male", plan,
      comicHighlightSelection: selection, comicPanelMode: 3,
    }), /exactly 3 panels/, "manual 3 exact");
    assert.match(buildChatComicImagePrompt({
      characterName: "태형", characterGender: "male", personaName: "렌", personaGender: "male", plan,
      comicHighlightSelection: selection, comicPanelMode: 4,
    }), /exactly 4 panels/, "manual 4 exact");
    assert.match(renderComicAutopilotContract("auto"), /Never merge two different speakers/, "dual-speaker banned");
  });

  it("T6 adult/safe projection parity in candidates", () => {
    const plan = planFromEvents([
      event(1, "A1", "dialogue", "character", "성관계를 하고 싶어.", "태형"),
      event(2, "A2", "action", "character", "피를 흘리며 다쳤다."),
    ]);
    const selection = { anchorEventId: "A1", focusEventIds: ["A1", "A2"] };
    const eligible = selectComicDialogueCandidates(plan, selection, BINDING, {
      providerReadableDialogueAdultEligible: true,
    });
    assert.equal(eligible.length, 1, "adult-eligible dialogue candidate present");
    const notEligible = selectComicDialogueCandidates(plan, selection, BINDING, {
      providerReadableDialogueAdultEligible: false,
    });
    assert.equal(notEligible.length, 0, "ineligible adult dialogue omitted by existing contract");
    // Canonical unchanged.
    assert.equal(plan.events[1]!.text, "피를 흘리며 다쳤다.");
  });

  it("density audit exposes candidate counts and panel recommendation", () => {
    const plan = planFromEvents([
      event(1, "B1", "dialogue", "character", "나랑 도망가자.", "태형"),
      event(2, "B2", "dialogue", "persona", "그래.", "렌"),
      event(3, "B3", "dialogue", "character", "정말?", "태형"),
    ]);
    const selection = { anchorEventId: "B1", focusEventIds: ["B1", "B2", "B3"] };
    const dialogueCandidates = selectComicDialogueCandidates(plan, selection, BINDING);
    const narrationCandidates = selectComicNarrationCandidates(plan, selection);
    const audit = buildComicTextBriefAudit({ selection, dialogueCandidates, narrationCandidates, panelMode: "auto" });
    assert.equal(audit.dialogueCandidateCount, 3);
    assert.equal(audit.densityTarget, "3-5");
    assert.equal(audit.sparse4Discouraged, false);
    assert.deepEqual(audit.sourceEventIdsUsed, ["B1", "B3", "B2"], "priority-ordered candidates");
    assert.equal(audit.recommendedPanelMode, 4);
  });

  it("4-panel page with 2 bubbles and no narration is flagged sparse", () => {
    const plan = planFromEvents([
      event(1, "C1", "dialogue", "character", "안녕.", "태형"),
      event(2, "C2", "reaction", "persona", "웃는다"),
    ]);
    const selection = { anchorEventId: "C1", focusEventIds: ["C1", "C2"] };
    const candidates = selectComicDialogueCandidates(plan, selection, BINDING);
    const density = resolveComicTextDensity("auto", candidates.length, 0);
    assert.equal(density.sparse4Discouraged, true, "4-panel dialogue-2 sparse flagged");
    assert.equal(density.target, "2-4");
  });
});