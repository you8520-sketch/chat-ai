import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileChatComicPanelSpec, renderChatComicPanelSpecSection } from "@/lib/chatComicPanelSpec";
import { duoVisualSubjectsForCast } from "@/lib/chatComicPanelSpec.fixtures";
import {
  buildDialogueSpeakerOptions,
  dialogueSpeakerChoiceKey,
  resolveDialogueSpeakerOptionKey,
} from "@/lib/chatImageDialogueSpeakerEditor";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  collectApprovedComicText,
  extractDeterministicEvents,
  projectComicPanelCompactDialoguePreview,
  reflowScenePlanPanels,
  validateScenePlan,
  visualEvents,
  type SceneDialogue,
} from "@/lib/chatImageScenePlan";

const PERSONA = "렌";
const CHARACTER = "태형";

function oneToOneMessages() {
  return buildSceneSourceMessages([
    { id: 1, role: "user", content: '"내가 좋아?"' },
    { id: 2, role: "assistant", content: '"좋냐고……? 하, 미치겠네."' },
  ]);
}

function screenshotMessages() {
  return buildSceneSourceMessages([
    {
      id: 1,
      role: "user",
      content: [
        '"내가 좋아?"',
        '"정말? 다 내어준다고? 그렇게 내가 마음에 들어?"',
      ].join("\n"),
    },
    {
      id: 2,
      role: "assistant",
      content: [
        '"정말? 다 내어준다고? 그렇게 내가 마음에 들어?"',
        '"웃…… 하, 렌……"',
        '"좋냐고……? 하, 미치겠네. 그걸 말이라고 물어?"',
        '"좋아해, 렌. 좋아해서 미칠 것 같아..."',
      ].join("\n"),
    },
  ]);
}

function assertMatchingOption(
  line: SceneDialogue,
  plan: ReturnType<typeof buildDeterministicScenePlan>,
  personaVisible = true
) {
  const choices = buildDialogueSpeakerOptions({
    personaName: PERSONA,
    characterName: CHARACTER,
    canonicalSpeakerNames: plan.panels.flatMap((panel) =>
      panel.dialogue.map((row) => row.speakerName).filter(Boolean) as string[]
    ),
    personaVisible,
    includeOther: line.speaker === "other" && !line.speakerName,
  });
  const selectedKey = resolveDialogueSpeakerOptionKey(line, PERSONA, CHARACTER);
  assert.ok(
    choices.some(
      (choice) => dialogueSpeakerChoiceKey(choice.value, choice.speakerName) === selectedKey
    ),
    `missing option for ${selectedKey}`
  );
  return { selectedKey, choices };
}

describe("comic dialogue speaker editor regression", () => {
  it("S2 BEFORE: coarse assistant line selectedKey character: did not match legacy character:태형 option", () => {
    const plan = buildDeterministicScenePlan(oneToOneMessages(), 2);
    const assistant = plan.panels
      .flatMap((panel) => panel.dialogue)
      .find((line) => line.speaker === "character");
    assert.ok(assistant);
    const legacySelectedKey = `${assistant!.speaker}:${assistant!.speakerName ?? ""}`;
    // Pre-fix editor built named primary options (character:태형), not coarse slots (character:).
    const legacyOptions = [
      { value: "persona" as const, label: PERSONA, speakerName: PERSONA },
      { value: "character" as const, label: CHARACTER, speakerName: CHARACTER },
    ];
    assert.equal(legacySelectedKey, "character:");
    assert.ok(
      !legacyOptions.some(
        (choice) => dialogueSpeakerChoiceKey(choice.value, choice.speakerName) === legacySelectedKey
      )
    );
    const fixedKey = resolveDialogueSpeakerOptionKey(assistant!, PERSONA, CHARACTER);
    const fixedOptions = buildDialogueSpeakerOptions({
      personaName: PERSONA,
      characterName: CHARACTER,
      personaVisible: true,
      includeOther: false,
    });
    assert.equal(fixedKey, "character:");
    assert.ok(
      fixedOptions.some(
        (choice) => dialogueSpeakerChoiceKey(choice.value, choice.speakerName) === fixedKey
      )
    );
  });

  it("S1/S2/S9: 1:1 user and assistant coarse speakers match dropdown options", () => {
    const plan = buildDeterministicScenePlan(oneToOneMessages(), 2);
    for (const line of plan.panels.flatMap((panel) => panel.dialogue)) {
      const { selectedKey } = assertMatchingOption(line, plan);
      if (line.speaker === "persona") assert.equal(selectedKey, "persona:");
      if (line.speaker === "character") assert.equal(selectedKey, "character:");
    }
  });

  it("S22 compact preview labels match coarse canonical speakers", () => {
    const plan = buildDeterministicScenePlan(oneToOneMessages(), 2);
    const speakers = plan.panels.flatMap((panel) =>
      projectComicPanelCompactDialoguePreview(panel, { personaVisible: true }).previewLines.map(
        (line) => line.speaker
      )
    );
    assert.deepEqual(speakers, ["persona", "character"]);
  });

  it("S15 final bubble mapping unchanged for coarse 1:1 plan", () => {
    const plan = buildDeterministicScenePlan(oneToOneMessages(), 2);
    const spec = compileChatComicPanelSpec({
      plan,
      personaName: PERSONA,
      characterName: CHARACTER,
      subjects: duoVisualSubjectsForCast({ personaName: PERSONA, characterName: CHARACTER }),
    });
    const section = renderChatComicPanelSpecSection(spec);
    assert.match(section, /Speech bubble \(B \/ persona\)/);
    assert.match(section, /Speech bubble \(A \/ character\)/);
  });
});

describe("comic dialogue duplication regression", () => {
  it("D7/D12: assistant repeating preceding user dialogue is assistant_echo, not panel duplicate", () => {
    const events = extractDeterministicEvents(screenshotMessages());
    const echo = events.find(
      (event) =>
        event.kind === "assistant_echo" &&
        event.text.includes("정말? 다 내어준다고? 그렇게 내가 마음에 들어?")
    );
    assert.ok(echo);
    const plan = buildDeterministicScenePlan(screenshotMessages(), 3);
    for (const panel of plan.panels) {
      const texts = panel.dialogue.map((line) => line.text);
      const dupes = texts.filter((text, index) => texts.indexOf(text) !== index);
      assert.deepEqual(dupes, [], `panel ${panel.index} has duplicate text: ${dupes.join(" | ")}`);
    }
    const visualDialogue = visualEvents(plan.events).filter((event) => event.kind === "dialogue");
    const repeatedText = visualDialogue.filter((event) =>
      event.text.includes("정말? 다 내어준다고? 그렇게 내가 마음에 들어?")
    );
    assert.equal(repeatedText.length, 1);
  });

  it("D1: duplicate sourceEventId in provider plan is rejected", () => {
    const plan = buildDeterministicScenePlan(oneToOneMessages(), 2);
    const line = plan.panels[0]!.dialogue[0]!;
    const forged = {
      sceneBackground: plan.sceneBackground,
      heroEventIds: plan.heroEventIds,
      heroScene: plan.heroScene,
      recommendedPanelCount: 2,
      panels: plan.panels.map((panel, index) =>
        index === 0
          ? {
              ...panel,
              dialogue: [line, { ...line, provenance: "source" as const }],
            }
          : panel
      ),
    };
    const validated = validateScenePlan(forged, oneToOneMessages(), {
      personaName: PERSONA,
      characterName: CHARACTER,
    });
    assert.equal(validated.ok, false);
    if (!validated.ok) assert.match(validated.reason, /dialogue sourceEvent duplicated/);
  });

  it("D5: distinct user and assistant dialogue both retained", () => {
    const plan = buildDeterministicScenePlan(oneToOneMessages(), 2);
    const dialogue = plan.panels.flatMap((panel) => panel.dialogue);
    assert.equal(dialogue.length, 2);
    assert.ok(dialogue.some((line) => line.speaker === "persona"));
    assert.ok(dialogue.some((line) => line.speaker === "character"));
  });

  it("D7: assistant line matching only preceding user message dialogue becomes assistant_echo", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"가지 마."' },
      { id: 2, role: "assistant", content: '"가지 마."' },
    ]);
    const events = extractDeterministicEvents(messages);
    assert.equal(events.filter((event) => event.kind === "dialogue").length, 1);
    assert.ok(events.some((event) => event.kind === "assistant_echo"));
  });

  it("D8: user_edit duplicate text lines are preserved", () => {
    const plan = buildDeterministicScenePlan(oneToOneMessages(), 2);
    const panel = plan.panels[0];
    assert.ok(panel);
    const duplicatedUserEdit = {
      ...plan,
      panels: plan.panels.map((row) =>
        row.index === panel!.index
          ? {
              ...row,
              dialogue: [
                ...row.dialogue,
                {
                  speaker: "character" as const,
                  text: "테스트",
                  provenance: "user_edit" as const,
                },
                {
                  speaker: "character" as const,
                  text: "테스트",
                  provenance: "user_edit" as const,
                },
              ],
            }
          : row
      ),
    };
    const texts = duplicatedUserEdit.panels[0]!.dialogue.filter((line) => line.text === "테스트");
    assert.equal(texts.length, 2);
  });

  it("D9: reflow does not duplicate source dialogue", () => {
    const plan = buildDeterministicScenePlan(screenshotMessages(), 2);
    const reflowed = reflowScenePlanPanels(plan, 3);
    const sourceIds = reflowed.panels.flatMap((panel) =>
      panel.dialogue
        .filter((line) => line.provenance === "source")
        .map((line) => line.sourceEventId)
        .filter(Boolean)
    );
    assert.equal(sourceIds.length, new Set(sourceIds).size);
  });

  it("SCREENSHOT ACCEPTANCE: panel 1 speakers match without duplicate echo text", () => {
    const plan = buildDeterministicScenePlan(screenshotMessages(), 3);
    const panel1 = plan.panels[0];
    assert.ok(panel1);
    for (const line of panel1.dialogue) {
      assertMatchingOption(line, plan);
      if (line.speaker === "persona") {
        assert.equal(resolveDialogueSpeakerOptionKey(line, PERSONA, CHARACTER), "persona:");
      }
      if (line.speaker === "character") {
        assert.equal(resolveDialogueSpeakerOptionKey(line, PERSONA, CHARACTER), "character:");
      }
    }
    const approved = collectApprovedComicText(plan);
    const repeated = approved.filter((text) =>
      text.includes("정말? 다 내어준다고? 그렇게 내가 마음에 들어?")
    );
    assert.equal(repeated.length, 1);
  });
});
