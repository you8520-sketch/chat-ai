import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildChatComicImagePrompt,
} from "./chatComicGeneration";
import {
  auditComicDialogueWhitelist,
  countUserEditDialogueMismatch,
} from "./chatComicDialogueAudit";
import { compileChatComicPanelSpec } from "./chatComicPanelSpec";
import { duoVisualSubjectsForCast } from "./chatComicPanelSpec.fixtures";
import {
  addPanelDialogueLine,
  applyUserPanelEdits,
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  collectApprovedComicText,
  movePanelDialogueLine,
  projectComicPanelBeat,
  removePanelDialogueLine,
  resolveScenePresentationVisibility,
  updatePanelDialogueAtIndex,
  type ScenePlan,
} from "./chatImageScenePlan";

const PERSONA = "렌";
const CHARACTER = "태형";

const DUO_MESSAGES = buildSceneSourceMessages([
  { id: 1, role: "user", content: '*후드 귀를 만진다*\n"같이 갈래?"' },
  { id: 2, role: "assistant", content: '렌이 후드를 만지자 태형이 고개를 돌렸다. "그래."' },
]);

function duoPlan(panelCount: 2 | 3 | 4 = 2): ScenePlan {
  return buildDeterministicScenePlan(DUO_MESSAGES, panelCount);
}

function duoSubjects() {
  return duoVisualSubjectsForCast({
    characterName: CHARACTER,
    personaName: PERSONA,
  });
}

function bubbleTexts(plan: ScenePlan, personaVisible = true): string[] {
  const visibility = { personaVisible };
  return compileChatComicPanelSpec({
    plan,
    personaName: PERSONA,
    characterName: CHARACTER,
    visibility,
    subjects: duoSubjects(),
  }).panels.flatMap((panel) => panel.speechBubbles.map((bubble) => bubble.text));
}

describe("chatImageSceneDialogueEditor regressions", () => {
  it("D1 — two speakers: all lines visible in projection", () => {
    const plan = duoPlan(2);
    const texts = plan.panels.flatMap((panel) => panel.dialogue.map((line) => line.text));
    assert.ok(texts.some((text) => text.includes("같이 갈래")));
    assert.ok(texts.some((text) => text.includes("그래")));
    assert.equal(plan.panels[0]?.dialogue.length >= 1, true);
    assert.equal(plan.panels.some((panel) => panel.dialogue.length >= 2) || texts.length >= 2, true);
  });

  it("D2 — wrong speaker correction marks user_edit and keeps canonical events", () => {
    const plan = duoPlan(2);
    const panel = plan.panels.find((row) =>
      row.dialogue.some((line) => line.text.includes("같이 갈래"))
    );
    assert.ok(panel);
    const lineIndex = panel!.dialogue.findIndex((line) => line.text.includes("같이 갈래"));
    const edited = updatePanelDialogueAtIndex(plan, panel!.index, lineIndex, {
      speaker: "character",
    });
    const line = edited.panels
      .find((row) => row.index === panel!.index)
      ?.dialogue[lineIndex];
    assert.equal(line?.provenance, "user_edit");
    assert.equal(line?.speaker, "character");
    assert.equal(edited.events, plan.events);
    const bubbles = bubbleTexts(edited);
    assert.ok(bubbles.some((text) => text.includes("같이 갈래")));
  });

  it("D3 — text edit updates whitelist only to new text", () => {
    const plan = duoPlan(2);
    const panel = plan.panels.find((row) =>
      row.dialogue.some((line) => line.text.includes("그래"))
    );
    assert.ok(panel);
    const lineIndex = panel!.dialogue.findIndex((line) => line.text.includes("그래"));
    const edited = updatePanelDialogueAtIndex(plan, panel!.index, lineIndex, {
      text: "좋아.",
    });
    const line = edited.panels
      .find((row) => row.index === panel!.index)
      ?.dialogue[lineIndex];
    assert.equal(line?.provenance, "user_edit");
    const whitelist = collectApprovedComicText(edited);
    assert.ok(whitelist.includes("좋아."));
    assert.equal(whitelist.includes("그래."), false);
    const audit = auditComicDialogueWhitelist({
      plan: edited,
      personaName: PERSONA,
      characterName: CHARACTER,
    });
    assert.equal(audit.panelTextWhitelistMismatchCount, 0);
    assert.equal(audit.userEditDialogueMismatchCount, 0);
  });

  it("D4 — delete dialogue yields silent panel without stale whitelist text", () => {
    const plan = duoPlan(2);
    const panel = plan.panels[0];
    assert.ok(panel);
    let edited = plan;
    for (let index = panel!.dialogue.length - 1; index >= 0; index -= 1) {
      edited = removePanelDialogueLine(edited, panel!.index, index);
    }
    const beat = projectComicPanelBeat(edited, edited.panels[0]!, {
      personaVisible: true,
    });
    assert.equal(beat.dialogue.length, 0);
    const whitelist = collectApprovedComicText(edited);
    for (const line of panel!.dialogue) {
      if (line.text.trim()) {
        assert.equal(whitelist.includes(line.text), false);
      }
    }
  });

  it("D5 — add dialogue appears in final bubble text", () => {
    const plan = duoPlan(2);
    const panel = plan.panels[0];
    assert.ok(panel);
    let edited = addPanelDialogueLine(plan, panel!.index, "persona");
    edited = updatePanelDialogueAtIndex(
      edited,
      panel!.index,
      edited.panels[0]!.dialogue.length - 1,
      { text: "잠깐." }
    );
    const line = edited.panels[0]?.dialogue.at(-1);
    assert.equal(line?.provenance, "user_edit");
    assert.equal(line?.text, "잠깐.");
    assert.ok(bubbleTexts(edited).includes("잠깐."));
  });

  it("D6 — reorder preserves UI order in final prompt bubbles", () => {
    const plan = applyUserPanelEdits(duoPlan(2), 1, {
      dialogue: [
        { speaker: "persona", text: "하나.", provenance: "user_edit" },
        { speaker: "character", text: "둘.", provenance: "user_edit" },
      ],
    });
    const reordered = movePanelDialogueLine(plan, 1, 1, "up");
    const texts = reordered.panels[0]?.dialogue.map((line) => line.text) ?? [];
    assert.deepEqual(texts, ["둘.", "하나."]);
    const panelBubbles = compileChatComicPanelSpec({
      plan: reordered,
      personaName: PERSONA,
      characterName: CHARACTER,
      subjects: duoSubjects(),
    })
      .panels.find((panel) => panel.index === 1)
      ?.speechBubbles.map((bubble) => bubble.text);
    assert.deepEqual(panelBubbles, ["둘.", "하나."]);
  });

  it("D7 — multiple lines from same speaker are all kept", () => {
    const plan = applyUserPanelEdits(duoPlan(2), 1, {
      dialogue: [
        { speaker: "persona", text: "하나.", provenance: "user_edit" },
        { speaker: "persona", text: "둘.", provenance: "user_edit" },
      ],
    });
    const personaLines = plan.panels[0]?.dialogue.filter((line) => line.speaker === "persona") ?? [];
    assert.equal(personaLines.length, 2);
    assert.deepEqual(bubbleTexts(plan).filter((text) => text === "하나." || text === "둘."), [
      "하나.",
      "둘.",
    ]);
  });

  it("D8 — empty line is excluded from final prompt bubbles", () => {
    const plan = addPanelDialogueLine(duoPlan(2), 1, "persona");
    const beat = projectComicPanelBeat(plan, plan.panels[0]!, { personaVisible: true });
    assert.equal(beat.dialogue.some((line) => !line.text.trim()), false);
    const prompt = buildChatComicImagePrompt({
      characterName: CHARACTER,
      characterGender: "male",
      personaName: PERSONA,
      personaGender: "female",
      plan,
    });
    assert.doesNotMatch(prompt, /Speech bubble.*“”/);
  });

  it("D9 — persona hidden excludes persona dialogue from visible bubbles", () => {
    const plan = duoPlan(2);
    const visibility = resolveScenePresentationVisibility({
      contentKind: "simulation",
      castManifest: {
        subjects: [{ role: "persona", included: false }],
      },
    });
    assert.equal(visibility.personaVisible, false);
    const beat = projectComicPanelBeat(plan, plan.panels[0]!, visibility);
    assert.equal(
      beat.dialogue.some((line) => line.speaker === "persona"),
      false
    );
    const whitelist = collectApprovedComicText(plan, visibility);
    assert.equal(whitelist.some((text) => text.includes("같이 갈래")), false);
  });

  it("D10 — other speaker stays generic without invented cast name", () => {
    const plan = applyUserPanelEdits(duoPlan(2), 1, {
      dialogue: [{ speaker: "other", text: "잠깐만.", provenance: "user_edit" }],
    });
    const spec = compileChatComicPanelSpec({
      plan,
      personaName: PERSONA,
      characterName: CHARACTER,
      subjects: duoSubjects(),
    });
    const labels = spec.panels.flatMap((panel) =>
      panel.speechBubbles.map((bubble) => bubble.speakerLabel)
    );
    assert.ok(labels.includes("other"));
    assert.equal(labels.includes("강우"), false);
  });
});

describe("chatImageSceneDialogueEditor counter negative controls", () => {
  it("USER_EDIT_DIALOGUE_MISMATCH_COUNT detects stale final bubbles", () => {
    const plan = duoPlan(2);
    const auditClean = auditComicDialogueWhitelist({
      plan,
      personaName: PERSONA,
      characterName: CHARACTER,
    });
    assert.equal(auditClean.userEditDialogueMismatchCount, 0);

    const panel = plan.panels.find((row) =>
      row.dialogue.some((line) => line.text.includes("그래"))
    );
    assert.ok(panel);
    const lineIndex = panel!.dialogue.findIndex((line) => line.text.includes("그래"));
    const edited = updatePanelDialogueAtIndex(plan, panel!.index, lineIndex, {
      text: "좋아.",
    });
    assert.equal(
      countUserEditDialogueMismatch(edited, bubbleTexts(edited)),
      0
    );
    assert.ok(
      countUserEditDialogueMismatch(edited, bubbleTexts(plan)) > 0
    );
  });
});
