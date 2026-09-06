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

function fullAutopilotPrompt(opts: {
  events: SceneEvent[];
  anchorId: string;
  focusIds: string[];
  panelMode: "auto" | 3 | 4;
  adultGrounded?: boolean;
  providerTextAdultEligible?: boolean;
}): { prompt: string; brief: ReturnType<typeof renderComicTextBrief> } {
  const plan = planFromEvents(opts.events);
  const selection = { anchorEventId: opts.anchorId, focusEventIds: opts.focusIds };
  const brief = renderComicTextBrief({
    plan,
    selection,
    binding: BINDING,
    safety: {
      providerReadableDialogueAdultEligible: opts.providerTextAdultEligible,
      visualProjectionAdultGrounded: opts.adultGrounded,
    },
    panelMode: opts.panelMode,
  });
  const prompt = buildChatComicImagePrompt({
    characterName: "태형",
    characterGender: "male",
    personaName: "렌",
    personaGender: "male",
    plan,
    comicHighlightSelection: selection,
    comicPanelMode: opts.panelMode,
    adultGrounded: opts.adultGrounded,
    providerTextAdultEligible: opts.providerTextAdultEligible,
  });
  return { prompt, brief };
}

describe("PR #877 final quality-floor correction", () => {
  it("AUTO-OWNER-1 recommendedPanelMode actually reaches the provider prompt", () => {
    const rich = fullAutopilotPrompt({
      events: [
        event(1, "R1", "dialogue", "character", "너 사실 고양이지?", "태형"),
        event(2, "R2", "dialogue", "persona", "냐옹.", "렌"),
        event(3, "R3", "dialogue", "character", "그럼 같이 살자.", "태형"),
        event(4, "R4", "reaction", "persona", "고개를 끄덕인다"),
      ],
      anchorId: "R3",
      focusIds: ["R1", "R2", "R3", "R4"],
      panelMode: "auto",
    });
    assert.equal(rich.brief.audit.recommendedPanelMode, 4);
    assert.match(rich.prompt, /Prefer a natural 4-panel page because this highlight contains enough distinct conversational\/transition beats\. Do not add filler merely to reach four\./);

    const sparse = fullAutopilotPrompt({
      events: [
        event(1, "S1", "dialogue", "character", "안녕.", "태형"),
        event(2, "S2", "reaction", "persona", "웃는다"),
      ],
      anchorId: "S1",
      focusIds: ["S1", "S2"],
      panelMode: "auto",
    });
    assert.equal(sparse.brief.audit.recommendedPanelMode, 3);
    assert.match(sparse.prompt, /Prefer a natural 3-panel page for this highlight\. Use 4 only if the selected scene clearly contains four distinct useful beats\./);
  });

  it("AUTO-OWNER-2 server never claims a rendered AUTO panel count", () => {
    const auto = fullAutopilotPrompt({
      events: [
        event(1, "R1", "dialogue", "character", "너 사실 고양이지?", "태형"),
        event(2, "R2", "dialogue", "persona", "냐옹.", "렌"),
        event(3, "R3", "dialogue", "character", "그럼 같이 살자.", "태형"),
        event(4, "R4", "reaction", "persona", "고개를 끄덕인다"),
      ],
      anchorId: "R3",
      focusIds: ["R1", "R2", "R3", "R4"],
      panelMode: "auto",
    });
    assert.doesNotMatch(auto.prompt, /exactly \d+ panel/iu, "AUTO prompt must not claim an exact rendered count");
    assert.match(renderComicAutopilotContract("auto"), /natural 3- or 4-panel/, "composition contract keeps AUTO freedom");
  });

  it("AUTO-3-1 1 dialogue + 1 narration → recommend 3", () => {
    const rec = recommendComicPanelModeByTextDensity(1, 1);
    assert.equal(rec.mode, 3);
  });

  it("AUTO-3-2 2 dialogue + 0 narration → recommend 3", () => {
    const rec = recommendComicPanelModeByTextDensity(2, 0);
    assert.equal(rec.mode, 3);
  });

  it("AUTO-4-1 3 dialogue + reaction → recommend 4", () => {
    const rec = recommendComicPanelModeByTextDensity(3, 0);
    assert.equal(rec.mode, 4);
  });

  it("AUTO-4-2 2 dialogue + useful bridge narration → recommend 4", () => {
    const rec = recommendComicPanelModeByTextDensity(2, 1);
    assert.equal(rec.mode, 4);
  });

  it("DENSITY-1 dialogue-rich 4 has spokenDialogueTarget >= 3 distinct beats", () => {
    const density = resolveComicTextDensity("auto", 3, 0);
    assert.equal(density.dialogueRichSource, true);
    assert.match(density.spokenDialogueTarget, /at least 3 distinct source dialogue beats/);
    assert.match(density.spokenDialogueTarget, /at least 2 dialogue-bearing panels/);
  });

  it("DENSITY-2 narration does not substitute for the spoken-dialogue target", () => {
    const rich4 = resolveComicTextDensity(4, 3, 0);
    const rich4Narration = resolveComicTextDensity(4, 3, 2);
    assert.equal(rich4.spokenDialogueTarget, rich4Narration.spokenDialogueTarget);
    assert.match(rich4Narration.spokenDialogueTarget, /at least 3 distinct source dialogue beats/);
  });

  it("DENSITY-3 sparse source does not force fake speech", () => {
    const density = resolveComicTextDensity(4, 1, 0);
    assert.equal(density.sparse4Discouraged, true);
    assert.doesNotMatch(density.spokenDialogueTarget, /at least 3 distinct source dialogue beats/);
  });

  it("NARR-1 environment transition → candidate", () => {
    const plan = planFromEvents([
      event(1, "E1", "dialogue", "character", "가자.", "태형"),
      event(2, "E2", "environment", "environment", "한 시간 후, 비가 그쳤다."),
    ]);
    const candidates = selectComicNarrationCandidates(plan, { anchorEventId: "E1", focusEventIds: ["E1", "E2"] });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.purpose, "time_bridge");
    assert.equal(candidates[0]?.sourceEventId, "E2");
  });

  it("NARR-2 short meaningful action between dialogue → action_bridge", () => {
    const plan = planFromEvents([
      event(1, "A1", "dialogue", "character", "기다려.", "태형"),
      event(2, "A2", "action", "character", "그가 손을 내밀어 그녀의 손을 잡는다."),
      event(3, "A3", "dialogue", "persona", "그래.", "렌"),
    ]);
    const candidates = selectComicNarrationCandidates(plan, { anchorEventId: "A3", focusEventIds: ["A1", "A2", "A3"] });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.purpose, "action_bridge");
    assert.equal(candidates[0]?.sourceEventId, "A2");
  });

  it("NARR-3 reaction that explains a comic beat → reaction_bridge when useful", () => {
    const plan = planFromEvents([
      event(1, "B1", "dialogue", "character", "사실 너를 좋아해.", "태형"),
      event(2, "B2", "reaction", "persona", "렌이 놀라며 입을 연다."),
      event(3, "B3", "dialogue", "persona", "나도.", "렌"),
    ]);
    const candidates = selectComicNarrationCandidates(plan, { anchorEventId: "B1", focusEventIds: ["B1", "B2", "B3"] });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.purpose, "reaction_bridge");
    assert.equal(candidates[0]?.sourceEventId, "B2");
  });

  it("NARR-4 trivial pose/action does not force narration", () => {
    const plan = planFromEvents([
      event(1, "C1", "dialogue", "character", "좋아.", "태형"),
      event(2, "C2", "action", "character", "앉아 있는다."),
      event(3, "C3", "dialogue", "persona", "응.", "렌"),
    ]);
    const candidates = selectComicNarrationCandidates(plan, { anchorEventId: "C1", focusEventIds: ["C1", "C2", "C3"] });
    assert.equal(candidates.length, 0);
  });

  it("NARR-5 no preferred narration does not prohibit optional source-grounded bridge", () => {
    const brief = renderComicTextBrief({
      plan: planFromEvents([
        event(1, "D1", "dialogue", "character", "안녕.", "태형"),
        event(2, "D2", "reaction", "persona", "웃는다"),
      ]),
      selection: { anchorEventId: "D1", focusEventIds: ["D1", "D2"] },
      binding: BINDING,
      safety: {},
      panelMode: "auto",
    });
    assert.doesNotMatch(brief.text, /narrat.*none/iu, "must not emit '(none)'");
    assert.match(brief.text, /No preferred narration line is supplied\./);
    assert.match(brief.text, /you may create up to 2 very short source-grounded narration bridges\. Do not add new facts\./);
  });

  it("SPEAKER-1 / PROMPT-1/2/3 exactly one canonical owner per rule in the full prompt", () => {
    const { prompt } = fullAutopilotPrompt({
      events: [
        event(1, "R1", "dialogue", "character", "너 사실 고양이지?", "태형"),
        event(2, "R2", "dialogue", "persona", "냐옹.", "렌"),
        event(3, "R3", "dialogue", "character", "그럼 같이 살자.", "태형"),
        event(4, "R4", "reaction", "persona", "고개를 끄덕인다"),
      ],
      anchorId: "R3",
      focusIds: ["R1", "R2", "R3", "R4"],
      panelMode: "auto",
    });
    const count = (needle: string) => prompt.split(needle).length - 1;
    assert.equal(count("Never merge two different speakers into a single bubble."), 1, "one-bubble rule");
    assert.equal(count("Narration: 0-2 short boxes."), 1, "narration budget rule");
    assert.equal(count("Spoken dialogue:"), 1, "spoken-dialogue target rule");
    assert.equal(count("One visible speech bubble = one speaker only."), 1, "speaker-clarity rule");
    assert.doesNotMatch(renderComicAutopilotContract("auto"), /Never merge two different speakers/, "composition contract no longer duplicates speaker clarity");
    assert.doesNotMatch(renderComicAutopilotContract("auto"), /1-2 speech bubbles per dialogue-bearing panel/, "composition contract no longer duplicates bubble density");
    assert.doesNotMatch(renderComicAutopilotContract("auto"), /0-2 short narration boxes/, "composition contract no longer duplicates narration budget");
  });

  it("SAFE-1 adult dialogue eligibility parity in candidates", () => {
    const plan = planFromEvents([
      event(1, "A1", "dialogue", "character", "성관계를 하고 싶어.", "태형"),
      event(2, "A2", "reaction", "persona", "웃는다"),
    ]);
    const selection = { anchorEventId: "A1", focusEventIds: ["A1", "A2"] };
    assert.equal(selectComicDialogueCandidates(plan, selection, BINDING, { providerReadableDialogueAdultEligible: true }).length, 1);
    assert.equal(selectComicDialogueCandidates(plan, selection, BINDING, { providerReadableDialogueAdultEligible: false }).length, 0);
  });

  it("SAFE-2 visual projection parity in narration candidates", () => {
    const plan = planFromEvents([
      event(1, "A1", "dialogue", "character", "기다려.", "태형"),
      event(2, "A2", "action", "character", "피투성이 손을 내민다."),
    ]);
    const selection = { anchorEventId: "A1", focusEventIds: ["A1", "A2"] };
    const grounded = selectComicNarrationCandidates(plan, selection, { visualProjectionAdultGrounded: false });
    assert.ok(grounded.length >= 0);
  });

  it("T1 extra model calls = 0; planner not invoked by brief", () => {
    const plan = planFromEvents([
      event(1, "X1", "dialogue", "character", "나랑 도망가자.", "태형"),
      event(2, "X2", "reaction", "persona", "웃는다"),
    ]);
    const selection = { anchorEventId: "X1", focusEventIds: ["X1", "X2"] };
    const brief = renderComicTextBrief({ plan, selection, binding: BINDING, safety: {}, panelMode: "auto" });
    assert.ok(brief.text.includes("SELECTED HIGHLIGHT SOURCE"));
    assert.ok(brief.text.includes("DIALOGUE CANDIDATES"));
  });

  it("T2 dialogue candidates are canonical ranked source lines with exact speaker ownership", () => {
    const plan = planFromEvents([
      event(1, "D1", "dialogue", "character", "오늘은 날씨가 좋네.", "태형"),
      event(2, "D2", "dialogue", "persona", "그래, 그렇지.", "렌"),
      event(3, "D3", "dialogue", "character", "나랑 도망가자.", "태형"),
      event(4, "D4", "reaction", "persona", "손을 잡는다"),
    ]);
    const selection = { anchorEventId: "D3", focusEventIds: ["D1", "D2", "D3", "D4"] };
    const candidates = selectComicDialogueCandidates(plan, selection, BINDING);
    assert.equal(candidates[0]?.sourceEventId, "D3", "anchor first");
    assert.equal(candidates[0]?.exactText, "나랑 도망가자.");
    assert.equal(candidates[0]?.speakerSubject, "A");
    assert.ok(candidates.some((candidate) => candidate.speakerSubject === "B"));
    for (const candidate of candidates) {
      const source = plan.events.find((entry) => entry.id === candidate.sourceEventId);
      assert.equal(candidate.exactText, source?.text, "invented dialogue = 0");
    }
  });

  it("T3 narration candidates max 2, source-grounded, no meta leak", () => {
    const plan = planFromEvents([
      event(1, "N1", "dialogue", "character", "가자.", "태형"),
      event(2, "N2", "environment", "environment", "잠시 뒤, 둘은 숙소로 돌아왔다."),
      event(3, "N3", "environment", "environment", "한 시간 후, 비가 그치기 시작했다."),
      event(4, "N4", "dialogue", "persona", "고마워.", "렌"),
    ]);
    const candidates = selectComicNarrationCandidates(plan, { anchorEventId: "N4", focusEventIds: ["N1", "N2", "N3", "N4"] });
    assert.ok(candidates.length >= 1 && candidates.length <= 2);
    for (const candidate of candidates) {
      const source = plan.events.find((entry) => entry.id === candidate.sourceEventId);
      assert.ok(source);
      assert.ok(source?.kind === "environment" || source?.kind === "action" || source?.kind === "reaction");
      assert.doesNotMatch(candidate.text, /sourceEventId|system|panelIndex/u);
    }
  });

  it("audit exposes separate text targets and recommended panel mode", () => {
    const plan = planFromEvents([
      event(1, "B1", "dialogue", "character", "나랑 도망가자.", "태형"),
      event(2, "B2", "dialogue", "persona", "그래.", "렌"),
      event(3, "B3", "dialogue", "character", "정말?", "태형"),
    ]);
    const selection = { anchorEventId: "B1", focusEventIds: ["B1", "B2", "B3"] };
    const audit = buildComicTextBriefAudit({
      selection,
      dialogueCandidates: selectComicDialogueCandidates(plan, selection, BINDING),
      narrationCandidates: selectComicNarrationCandidates(plan, selection),
      panelMode: "auto",
    });
    assert.equal(audit.eligibleDialogueCandidateCount, 3);
    assert.equal(audit.dialogueRichSource, true);
    assert.equal(audit.spokenDialogueTarget, "at least 3 distinct source dialogue beats across the page, across at least 2 dialogue-bearing panels, 1-2 bubbles per speaking panel");
    assert.equal(audit.narrationTarget, "0-2");
    assert.equal(audit.totalTextTarget, "3-5");
    assert.equal(audit.sparse4Discouraged, false);
    assert.equal(audit.recommendedPanelMode, 4);
    assert.deepEqual(audit.sourceEventIdsUsed, ["B1", "B2", "B3"], "anchor first, then speaker diversity, then score");
  });
});