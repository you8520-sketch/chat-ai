import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildChatComicImagePrompt } from "./chatComicGeneration";
import { auditComicDialogueWhitelist } from "./chatComicDialogueAudit";
import { compileComicTextOverlaySvg } from "./chatComicTextOverlay";
import { compileChatComicPanelSpec } from "./chatComicPanelSpec";
import { duoVisualSubjectsForCast } from "./chatComicPanelSpec.fixtures";
import {
  addPanelDialogueLine,
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  collectApprovedComicText,
  normalizeDialogueTextForOutput,
  preserveDialogueEditText,
  updatePanelDialogueAtIndex,
  type ScenePlan,
} from "./chatImageScenePlan";

const PERSONA = "렌";
const CHARACTER = "태형";

function bubbleTexts(plan: ScenePlan): string[] {
  return compileChatComicPanelSpec({
    plan,
    personaName: PERSONA,
    characterName: CHARACTER,
    subjects: duoVisualSubjectsForCast({
      characterName: CHARACTER,
      personaName: PERSONA,
    }),
  }).panels.flatMap((panel) => panel.speechBubbles.map((bubble) => bubble.text));
}

function simulateTyping(
  plan: ScenePlan,
  panelIndex: number,
  lineIndex: number,
  steps: readonly string[]
): ScenePlan {
  let current = plan;
  for (const text of steps) {
    current = updatePanelDialogueAtIndex(current, panelIndex, lineIndex, { text });
    const line = current.panels.find((panel) => panel.index === panelIndex)?.dialogue[lineIndex];
    assert.equal(line?.text, text, `typing step lost characters: expected "${text}"`);
    if (text.endsWith(" ") && text.length > 1) {
      assert.ok(line?.text.endsWith(" "), `trailing space lost at step "${text}"`);
    }
  }
  return current;
}

describe("chatImageDialogueKeystroke typing lifecycle", () => {
  it("T1 preserves spaces while typing and normalizes final output", () => {
    const base = buildDeterministicScenePlan(
      buildSceneSourceMessages([{ id: 1, role: "assistant", content: '"안녕."' }]),
      2
    );
    const withLine = addPanelDialogueLine(base, 1, "persona");
    const lineIndex = (withLine.panels.find((panel) => panel.index === 1)?.dialogue.length ?? 1) - 1;
    const steps = ["같이", "같이 ", "같이 가", "같이 가자", "같이 가자."] as const;
    const edited = simulateTyping(withLine, 1, lineIndex, steps);
    const stored = edited.panels.find((panel) => panel.index === 1)?.dialogue[lineIndex]?.text;
    assert.equal(stored, "같이 가자.");
    const finalText = normalizeDialogueTextForOutput(stored);
    assert.equal(finalText, "같이 가자.");
    assert.equal(preserveDialogueEditText("같이 "), "같이 ");
    const bubbles = bubbleTexts(edited);
    assert.ok(bubbles.includes("같이 가자."));
    const whitelist = collectApprovedComicText(edited);
    assert.ok(whitelist.includes("같이 가자."));
    assert.equal(
      auditComicDialogueWhitelist({
        plan: edited,
        personaName: PERSONA,
        characterName: CHARACTER,
      }).panelTextWhitelistMismatchCount,
      0
    );
  });

  it("T2 preserves 잠깐 + space typing and final output", () => {
    const base = buildDeterministicScenePlan(
      buildSceneSourceMessages([{ id: 1, role: "assistant", content: '"안녕."' }]),
      2
    );
    const withLine = addPanelDialogueLine(base, 1, "character");
    const lineIndex = 0;
    const edited = simulateTyping(withLine, 1, lineIndex, ["잠깐 ", "잠깐 기다려."]);
    assert.equal(
      edited.panels.find((panel) => panel.index === 1)?.dialogue[lineIndex]?.text,
      "잠깐 기다려."
    );
    assert.ok(bubbleTexts(edited).includes("잠깐 기다려."));
  });

  it("T3 collapses double spaces only at final output boundary", () => {
    const base = buildDeterministicScenePlan(
      buildSceneSourceMessages([{ id: 1, role: "assistant", content: '"안녕."' }]),
      2
    );
    const withLine = addPanelDialogueLine(base, 1, "persona");
    const lineIndex = 0;
    const edited = updatePanelDialogueAtIndex(withLine, 1, lineIndex, {
      text: "같이  가자.",
    });
    assert.equal(edited.panels.find((panel) => panel.index === 1)?.dialogue[lineIndex]?.text, "같이  가자.");
    assert.equal(normalizeDialogueTextForOutput("같이  가자."), "같이 가자.");
    assert.ok(bubbleTexts(edited).includes("같이 가자."));
  });

  it("T4 keeps last typed character through immediate overlay projection", () => {
    const base = buildDeterministicScenePlan(
      buildSceneSourceMessages([{ id: 1, role: "assistant", content: '"안녕."' }]),
      2
    );
    const withLine = addPanelDialogueLine(base, 1, "persona");
    const edited = updatePanelDialogueAtIndex(withLine, 1, 0, { text: "Room 3으로 가자." });
    const prompt = buildChatComicImagePrompt({
      characterName: CHARACTER,
      characterGender: "male",
      personaName: PERSONA,
      personaGender: "female",
      plan: edited,
    });
    const overlaySvg = compileComicTextOverlaySvg({
      width: 400,
      height: 800,
      panelCount: 2,
      plan: edited,
    });
    assert.match(overlaySvg, /Room 3으로 가자\./);
    assert.doesNotMatch(prompt, /Room 3으로 가자\./);
    assert.ok(bubbleTexts(edited).includes("Room 3으로 가자."));
  });

  it("negative control: old cleanLine-style collapse would fail mid-typing", () => {
    const collapsed = normalizeDialogueTextForOutput("같이 ");
    assert.equal(collapsed, "같이");
    assert.notEqual(collapsed, "같이 ");
  });
});
