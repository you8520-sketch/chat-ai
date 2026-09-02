import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileChatComicPanelSpec, renderChatComicPanelSpecSection } from "@/lib/chatComicPanelSpec";
import { compilerOnlyDuoVisualSubjects } from "@/lib/chatComicPanelSpec.fixtures";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  extractDeterministicEvents,
  reflowScenePlanPanels,
  updatePanelDialogueAtIndex,
} from "@/lib/chatImageScenePlan";
import { buildTrpgGmNarrationSceneMessages } from "@/lib/trpg/trpgAiFocusSelection";
import { parseTrpgSceneSpeech } from "@/lib/trpg/sceneSpeech";

const MULTI_SPEAKER_NARRATION = `렌: "조심해."
강이현: "뒤는 내가 볼게."
권태현: "먼저 올라가."
GM: 아래쪽에서 기생종들이 닥트를 긁기 시작한다.`;

const SPEAKER_CONTEXT = {
  personaName: "렌",
  characterName: "권태현",
  knownSpeakerNames: ["강이현", "권태현", "렌"],
};

function multiSpeakerMessages() {
  return buildTrpgGmNarrationSceneMessages(MULTI_SPEAKER_NARRATION);
}

function trioVisualSubjects() {
  return [
    ...compilerOnlyDuoVisualSubjects({
      personaName: "렌",
      characterName: "권태현",
    }),
    {
      key: "supporting:강이현",
      role: "supporting_character",
      name: "강이현",
      gender: "female" as const,
      referenceIndex: 3,
      appearanceMode: "image_only" as const,
      sourceKind: "cast_member" as const,
    },
  ];
}

describe("chat image multi-speaker dialogue identity", () => {
  it("A2/A4 BEFORE baseline: named speakers collapse without speaker context", () => {
    const events = extractDeterministicEvents(multiSpeakerMessages());
    const dialogue = events.filter((event) => event.kind === "dialogue");
    assert.equal(dialogue.length, 3);
    assert.ok(dialogue.every((event) => event.actor === "character"));
    assert.ok(dialogue.every((event) => !event.speakerName));
  });

  it("A2/A3/A4/A11: canonical speakerName preserved from attributed TRPG speech", () => {
    const events = extractDeterministicEvents(multiSpeakerMessages(), SPEAKER_CONTEXT);
    const dialogue = events.filter((event) => event.kind === "dialogue");
    assert.deepEqual(
      dialogue.map((event) => ({ speakerName: event.speakerName, text: event.text })),
      [
        { speakerName: "렌", text: "조심해." },
        { speakerName: "강이현", text: "뒤는 내가 볼게." },
        { speakerName: "권태현", text: "먼저 올라가." },
      ]
    );
    assert.ok(events.every((event) => event.text !== "아래쪽에서 기생종들이 닥트를 긁기 시작한다." || event.kind !== "dialogue"));
    assert.ok(!dialogue.some((event) => event.speakerName === "GM"));
  });

  it("A1/A8: panel allocation keeps distinct speaker identities across 2/3/4-cut", () => {
    for (const count of [2, 3, 4] as const) {
      const plan = buildDeterministicScenePlan(multiSpeakerMessages(), count, SPEAKER_CONTEXT);
      const speakers = plan.panels.flatMap((panel) =>
        panel.dialogue.map((line) => line.speakerName)
      );
      assert.deepEqual(speakers, ["렌", "강이현", "권태현"]);
    }
  });

  it("A5: preview projection exposes canonical speaker names", () => {
    const plan = buildDeterministicScenePlan(multiSpeakerMessages(), 3, SPEAKER_CONTEXT);
    const labels = plan.panels.flatMap((panel) =>
      panel.dialogue.map((line) => line.speakerName)
    );
    assert.deepEqual(labels, ["렌", "강이현", "권태현"]);
  });

  it("A6/A7: editor reflow preserves speaker identity", () => {
    const plan = buildDeterministicScenePlan(multiSpeakerMessages(), 2, SPEAKER_CONTEXT);
    const panel = plan.panels[0];
    assert.ok(panel);
    const lineIndex = panel.dialogue.findIndex((line) => line.speakerName === "강이현");
    assert.ok(lineIndex >= 0);
    const edited = updatePanelDialogueAtIndex(plan, panel.index, lineIndex, {
      text: "뒤는 내가 볼게.",
      speaker: "other",
      speakerName: "강이현",
    });
    const reflowed = reflowScenePlanPanels(edited, 3);
    const restored = reflowed.panels.flatMap((item) => item.dialogue);
    assert.ok(restored.some((line) => line.speakerName === "강이현" && line.text === "뒤는 내가 볼게."));
  });

  it("A9/A10: final bubble whitelist maps lines to named cast labels", () => {
    const plan = buildDeterministicScenePlan(multiSpeakerMessages(), 3, SPEAKER_CONTEXT);
    const spec = compileChatComicPanelSpec({
      plan,
      personaName: "렌",
      characterName: "권태현",
      subjects: trioVisualSubjects(),
    });
    const section = renderChatComicPanelSpecSection(spec);
    assert.match(section, /Speech bubble \(B \/ 렌\): “조심해.”/);
    assert.match(section, /Speech bubble \(C \/ 강이현\): “뒤는 내가 볼게.”/);
    assert.match(section, /Speech bubble \(A \/ 권태현\): “먼저 올라가.”/);
    assert.doesNotMatch(section, /Speech bubble .*GM/);
  });

  it("A12: 1:1 chat without attributed names keeps persona/character coarse slots", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"안녕."' },
      { id: 2, role: "assistant", content: '"반가워."' },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2, SPEAKER_CONTEXT);
    const dialogue = plan.panels.flatMap((panel) => panel.dialogue);
    assert.equal(dialogue.length, 2);
    assert.equal(dialogue[0]?.speaker, "persona");
    assert.equal(dialogue[1]?.speaker, "character");
    assert.ok(!dialogue[0]?.speakerName);
    assert.ok(!dialogue[1]?.speakerName);
  });

  it("A13: persona speaker lines remain persona when sourced from user role", () => {
    const messages = buildSceneSourceMessages([{ id: 1, role: "user", content: '"조심해."' }]);
    const events = extractDeterministicEvents(messages, SPEAKER_CONTEXT);
    assert.equal(events[0]?.actor, "persona");
  });

  it("TRPG parser remains source for attributed line detection", () => {
    const beats = parseTrpgSceneSpeech(MULTI_SPEAKER_NARRATION, SPEAKER_CONTEXT.knownSpeakerNames);
    assert.deepEqual(
      beats.filter((beat) => beat.speaker).map((beat) => beat.speaker),
      ["렌", "강이현", "권태현", "GM"]
    );
  });
});
