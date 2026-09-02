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
  extractDeterministicEvents,
  projectComicPanelCompactDialoguePreview,
  reflowScenePlanPanels,
  validateScenePlan,
  type SceneDialogue,
} from "@/lib/chatImageScenePlan";
import { planChatImageScene } from "@/lib/chatImageScenePlanner";

const PERSONA = "렌";
const CHARACTER = "태형";

function oneToOneMessages() {
  return buildSceneSourceMessages([
    { id: 1, role: "user", content: '"내가 좋아?"' },
    { id: 2, role: "assistant", content: '"좋냐고……? 하, 미치겠네."' },
  ]);
}

function sameTextDistinctEventsMessages() {
  return buildSceneSourceMessages([
    { id: 1, role: "user", content: '"가지 마."' },
    { id: 2, role: "assistant", content: '"가지 마."' },
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

function sourceEventIdCounts(plan: ReturnType<typeof buildDeterministicScenePlan>) {
  const ids = plan.panels.flatMap((panel) =>
    panel.dialogue
      .filter((line) => line.provenance === "source")
      .map((line) => line.sourceEventId)
      .filter(Boolean)
  );
  const counts = new Map<string, number>();
  for (const id of ids) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

describe("comic dialogue speaker editor regression", () => {
  it("S2 BEFORE: coarse assistant line selectedKey character: did not match legacy character:태형 option", () => {
    const plan = buildDeterministicScenePlan(oneToOneMessages(), 2);
    const assistant = plan.panels
      .flatMap((panel) => panel.dialogue)
      .find((line) => line.speaker === "character");
    assert.ok(assistant);
    const legacySelectedKey = `${assistant!.speaker}:${assistant!.speakerName ?? ""}`;
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
  it("D1: same sourceEventId same panel twice → canonical plan keeps first occurrence only", () => {
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
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const sourceId = line.sourceEventId!;
    assert.equal(validated.plan.panels[0]!.dialogue.filter((row) => row.sourceEventId === sourceId).length, 1);
  });

  it("D2: same sourceEventId across two panels → canonical plan keeps first occurrence only", () => {
    const plan = buildDeterministicScenePlan(oneToOneMessages(), 2);
    const line = plan.panels[0]!.dialogue[0]!;
    const forged = {
      sceneBackground: plan.sceneBackground,
      heroEventIds: plan.heroEventIds,
      heroScene: plan.heroScene,
      recommendedPanelCount: 2,
      panels: plan.panels.map((panel, index) =>
        index === 1
          ? {
              ...panel,
              dialogue: [{ ...line, provenance: "source" as const }, ...panel.dialogue],
            }
          : panel
      ),
    };
    const validated = validateScenePlan(forged, oneToOneMessages(), {
      personaName: PERSONA,
      characterName: CHARACTER,
    });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const sourceId = line.sourceEventId!;
    const occurrences = validated.plan.panels.flatMap((panel) =>
      panel.dialogue.filter((row) => row.sourceEventId === sourceId)
    );
    assert.equal(occurrences.length, 1);
    assert.equal(occurrences[0]!.text, line.text);
  });

  it("D3: deterministic plan — one source event → one dialogue occurrence", () => {
    const plan = buildDeterministicScenePlan(oneToOneMessages(), 2);
    for (const [, count] of sourceEventIdCounts(plan)) {
      assert.equal(count, 1);
    }
  });

  it("D4: different user and assistant text → both retained", () => {
    const plan = buildDeterministicScenePlan(oneToOneMessages(), 2);
    const dialogue = plan.panels.flatMap((panel) => panel.dialogue);
    assert.equal(dialogue.length, 2);
    assert.ok(dialogue.some((line) => line.speaker === "persona"));
    assert.ok(dialogue.some((line) => line.speaker === "character"));
  });

  it("D5: same text + different genuine source events → both retained with distinct speakers", () => {
    const messages = sameTextDistinctEventsMessages();
    const events = extractDeterministicEvents(messages);
    const dialogues = events.filter((event) => event.kind === "dialogue");
    assert.equal(dialogues.length, 2);
    assert.notEqual(dialogues[0]!.id, dialogues[1]!.id);
    assert.equal(dialogues[0]!.sourceRole, "user");
    assert.equal(dialogues[1]!.sourceRole, "assistant");

    const plan = buildDeterministicScenePlan(messages, 2);
    const lines = plan.panels.flatMap((panel) => panel.dialogue);
    const matching = lines.filter((line) => line.text.includes("가지 마"));
    assert.equal(matching.length, 2);
    assert.ok(matching.some((line) => line.speaker === "persona"));
    assert.ok(matching.some((line) => line.speaker === "character"));
    assert.notEqual(matching[0]!.sourceEventId, matching[1]!.sourceEventId);

    for (const line of matching) {
      assertMatchingOption(line, plan);
      if (line.speaker === "persona") {
        assert.equal(resolveDialogueSpeakerOptionKey(line, PERSONA, CHARACTER), "persona:");
      }
      if (line.speaker === "character") {
        assert.equal(resolveDialogueSpeakerOptionKey(line, PERSONA, CHARACTER), "character:");
      }
    }

    const spec = compileChatComicPanelSpec({
      plan,
      personaName: PERSONA,
      characterName: CHARACTER,
      subjects: duoVisualSubjectsForCast({ personaName: PERSONA, characterName: CHARACTER }),
    });
    const section = renderChatComicPanelSpecSection(spec);
    assert.match(section, /Speech bubble \(B \/ persona\).*가지 마\./s);
    assert.match(section, /Speech bubble \(A \/ character\).*가지 마\./s);
  });

  it("D7: exact text equality alone does not classify assistant dialogue as assistant_echo", () => {
    const events = extractDeterministicEvents(sameTextDistinctEventsMessages());
    assert.equal(events.filter((event) => event.kind === "dialogue").length, 2);
    assert.equal(events.filter((event) => event.kind === "assistant_echo").length, 0);
  });

  it("D8: two identical user_edit lines → both preserved", () => {
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

  it("D9: reflow does not duplicate same sourceEventId", () => {
    const plan = buildDeterministicScenePlan(screenshotMessages(), 2);
    const reflowed = reflowScenePlanPanels(plan, 3);
    for (const [, count] of sourceEventIdCounts(reflowed)) {
      assert.equal(count, 1);
    }
  });

  it("D10: AI plan validation repairs duplicate sourceEventId without invalidating plan", () => {
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
    assert.equal(validated.ok, true);
  });

  it("D1-PRODUCTION: duplicate source dialogue is deterministically repaired without provider fallback", async () => {
    const messages = oneToOneMessages();
    const base = buildDeterministicScenePlan(messages, 2);
    const line = base.panels[0]!.dialogue[0]!;
    const duplicated = {
      sceneBackground: base.sceneBackground,
      heroEventIds: base.heroEventIds,
      heroScene: base.heroScene,
      recommendedPanelCount: 2,
      panels: base.panels.map((panel, index) =>
        index === 0
          ? {
              ...panel,
              dialogue: [line, { ...line, provenance: "source" as const }],
            }
          : panel
      ),
    };
    let calls = 0;
    const result = await planChatImageScene({
      characterName: CHARACTER,
      personaName: PERSONA,
      messages,
      complete: async () => {
        calls += 1;
        return JSON.stringify(duplicated);
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.usedFallback, false);
    assert.ok(result.plan.panels.length >= 1);
    const sourceId = line.sourceEventId!;
    const occurrences = result.plan.panels.flatMap((panel) =>
      panel.dialogue.filter((row) => row.sourceEventId === sourceId)
    );
    assert.equal(occurrences.length, 1);
  });

  it("D12: screenshot-style fixture — same-text distinct source events show correct speakers; duplicate sourceEventId repaired", () => {
    const plan = buildDeterministicScenePlan(screenshotMessages(), 3);
    for (const line of plan.panels.flatMap((panel) => panel.dialogue)) {
      assertMatchingOption(line, plan);
    }

    const repeatedText = "정말? 다 내어준다고? 그렇게 내가 마음에 들어?";
    const matching = plan.panels.flatMap((panel) =>
      panel.dialogue.filter((line) => line.text.includes(repeatedText))
    );
    if (matching.length >= 2) {
      assert.notEqual(matching[0]!.sourceEventId, matching[1]!.sourceEventId);
      assert.notEqual(matching[0]!.speaker, matching[1]!.speaker);
    }

    for (const [, count] of sourceEventIdCounts(plan)) {
      assert.equal(count, 1);
    }

    const forged = {
      sceneBackground: plan.sceneBackground,
      heroEventIds: plan.heroEventIds,
      heroScene: plan.heroScene,
      recommendedPanelCount: 3,
      panels: plan.panels.map((panel, index) =>
        index === 0 && panel.dialogue[0]
          ? {
              ...panel,
              dialogue: [panel.dialogue[0], { ...panel.dialogue[0], provenance: "source" as const }],
            }
          : panel
      ),
    };
    const validated = validateScenePlan(forged, screenshotMessages(), {
      personaName: PERSONA,
      characterName: CHARACTER,
    });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const firstSourceId = plan.panels[0]!.dialogue[0]!.sourceEventId!;
    assert.equal(
      validated.plan.panels[0]!.dialogue.filter((row) => row.sourceEventId === firstSourceId).length,
      1
    );
  });
});
