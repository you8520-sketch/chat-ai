import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileChatComicPanelSpec, renderChatComicPanelSpecSection } from "@/lib/chatComicPanelSpec";
import { compilerOnlyDuoVisualSubjects } from "@/lib/chatComicPanelSpec.fixtures";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  collectApprovedComicText,
  collectCanonicalSpeakerNames,
  extractDeterministicEvents,
  formatApprovedScenePlanForIllustration,
  projectComicPanelBeat,
  reflowScenePlanPanels,
  updatePanelDialogueAtIndex,
  validateScenePlan,
} from "@/lib/chatImageScenePlan";
import { planChatImageScene } from "@/lib/chatImageScenePlanner";
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

const ACTION_MIXED_FIXTURE = `권태현이 총구를 들어 복도를 겨눴다.
권태현: "엎드려."
강이현이 렌의 팔을 잡아당겼다.
강이현: "이쪽이야."
복도 끝의 비상등이 붉게 깜빡였다.`;

function actionMixedMessages() {
  return buildSceneSourceMessages([{ id: 1, role: "assistant", content: ACTION_MIXED_FIXTURE }]);
}

function nonDialogueSnapshot(events: ReturnType<typeof extractDeterministicEvents>) {
  return events
    .filter((event) => event.kind !== "dialogue")
    .map((event) => ({ kind: event.kind, actor: event.actor, text: event.text }));
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

function buildAdversarialProviderPlan() {
  const messages = multiSpeakerMessages();
  const canonical = buildDeterministicScenePlan(messages, 3, SPEAKER_CONTEXT);
  const dialogueEvents = canonical.events.filter((event) => event.kind === "dialogue");
  const ren = dialogueEvents.find((event) => event.speakerName === "렌");
  const gang = dialogueEvents.find((event) => event.speakerName === "강이현");
  const kwon = dialogueEvents.find((event) => event.speakerName === "권태현");
  assert.ok(ren && gang && kwon);
  assert.equal(ren.actor, "persona");
  assert.equal(gang.actor, "other");
  assert.equal(kwon.actor, "character");

  const providerPlan = {
    sceneBackground: canonical.sceneBackground,
    heroEventIds: canonical.heroEventIds,
    heroScene: canonical.heroScene,
    recommendedPanelCount: 3,
    panels: canonical.panels.map((panel) => ({
      index: panel.index,
      sourceEventIds: panel.sourceEventIds,
      situation: panel.situation,
      dialogue: panel.dialogue.map((line) => {
        if (line.sourceEventId === ren.id) {
          return {
            speaker: "character",
            text: line.text,
            sourceEventId: line.sourceEventId,
            provenance: "source",
          };
        }
        if (line.sourceEventId === gang.id) {
          return {
            speaker: "character",
            text: line.text,
            sourceEventId: line.sourceEventId,
            provenance: "source",
          };
        }
        return {
          speaker: line.speaker,
          text: line.text,
          sourceEventId: line.sourceEventId,
          provenance: "source",
        };
      }),
    })),
  };

  return { messages, canonical, providerPlan, ren, gang, kwon };
}

function validatedAdversarialPlan() {
  const { messages, providerPlan } = buildAdversarialProviderPlan();
  const validated = validateScenePlan(providerPlan, messages, {
    personaName: SPEAKER_CONTEXT.personaName,
    characterName: SPEAKER_CONTEXT.characterName,
    knownSpeakerNames: SPEAKER_CONTEXT.knownSpeakerNames,
  });
  assert.equal(validated.ok, true);
  return { messages, plan: validated.ok ? validated.plan : null };
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

  it("A16/A18/A19: named dialogue enriches identity without reclassifying non-dialogue beats", () => {
    const messages = actionMixedMessages();
    const baseline = nonDialogueSnapshot(extractDeterministicEvents(messages));
    const enriched = extractDeterministicEvents(messages, SPEAKER_CONTEXT);
    assert.deepEqual(nonDialogueSnapshot(enriched), baseline);

    const dialogue = enriched.filter((event) => event.kind === "dialogue");
    assert.deepEqual(
      dialogue.map((event) => ({ speakerName: event.speakerName, text: event.text })),
      [
        { speakerName: "권태현", text: "엎드려." },
        { speakerName: "강이현", text: "이쪽이야." },
      ]
    );
    assert.ok(
      enriched.some(
        (event) =>
          event.kind !== "dialogue" &&
          /비상등/.test(event.text)
      )
    );
    assert.ok(
      enriched.some(
        (event) =>
          event.kind !== "dialogue" &&
          /총구/.test(event.text)
      )
    );
    assert.ok(
      enriched.some(
        (event) =>
          event.kind !== "dialogue" &&
          /팔을/.test(event.text)
      )
    );
  });

  it("A17: unknown named NPC speakerName is collected for scene-scoped editor options", () => {
    const messages = buildSceneSourceMessages([
      {
        id: 1,
        role: "assistant",
        content: `민수: "잠깐."
권태현: "알겠어."`,
      },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2, {
      personaName: "렌",
      characterName: "권태현",
      knownSpeakerNames: ["권태현", "렌"],
    });
    const names = collectCanonicalSpeakerNames(plan);
    assert.ok(names.includes("민수"));
    assert.ok(names.includes("권태현"));
  });

  it("A15: provider plan without speakerName inherits canonical identity during validation", async () => {
    const messages = multiSpeakerMessages();
    const canonical = buildDeterministicScenePlan(messages, 3, SPEAKER_CONTEXT);
    const dialogueEvents = canonical.events.filter((event) => event.kind === "dialogue");
    const providerPlan = {
      sceneBackground: canonical.sceneBackground,
      heroEventIds: canonical.heroEventIds,
      heroScene: canonical.heroScene,
      recommendedPanelCount: 3,
      panels: canonical.panels.map((panel) => ({
        index: panel.index,
        sourceEventIds: panel.sourceEventIds,
        situation: panel.situation,
        dialogue: panel.dialogue.map((line) => ({
          speaker: line.speaker,
          text: line.text,
          sourceEventId: line.sourceEventId,
          provenance: "source",
        })),
      })),
    };
    const validated = validateScenePlan(providerPlan, messages, {
      personaName: SPEAKER_CONTEXT.personaName,
      characterName: SPEAKER_CONTEXT.characterName,
      knownSpeakerNames: SPEAKER_CONTEXT.knownSpeakerNames,
    });
    assert.equal(validated.ok, true);
    if (validated.ok) {
      const validatedDialogue = validated.plan.panels.flatMap((panel) => panel.dialogue);
      assert.deepEqual(
        validatedDialogue.map((line) => line.speakerName),
        dialogueEvents.map((event) => event.speakerName)
      );
    }

    const planned = await planChatImageScene({
      characterName: SPEAKER_CONTEXT.characterName,
      personaName: SPEAKER_CONTEXT.personaName,
      messages,
      speakerContext: SPEAKER_CONTEXT,
      complete: async () => JSON.stringify(providerPlan),
    });
    assert.equal(planned.usedFallback, false);
    assert.deepEqual(
      planned.plan.panels.flatMap((panel) => panel.dialogue.map((line) => line.speakerName)),
      ["렌", "강이현", "권태현"]
    );
  });

  it("A20: adversarial provider coarse-speaker mismatch canonicalizes to canonical identity", () => {
    const { plan } = validatedAdversarialPlan();
    assert.ok(plan);
    const dialogue = plan!.panels.flatMap((panel) => panel.dialogue);
    assert.deepEqual(
      dialogue.map((line) => ({ speaker: line.speaker, speakerName: line.speakerName, text: line.text })),
      [
        { speaker: "persona", speakerName: "렌", text: "조심해." },
        { speaker: "other", speakerName: "강이현", text: "뒤는 내가 볼게." },
        { speaker: "character", speakerName: "권태현", text: "먼저 올라가." },
      ]
    );
  });

  it("A21: named assistant persona hidden when personaVisible=false", () => {
    const { plan } = validatedAdversarialPlan();
    assert.ok(plan);
    const hidden = { personaVisible: false as const };
    const panel = plan!.panels.find((entry) =>
      entry.dialogue.some((line) => line.speakerName === "렌")
    );
    assert.ok(panel);
    const beat = projectComicPanelBeat(plan!, panel, hidden);
    assert.ok(!beat.dialogue.some((line) => line.speakerName === "렌" || line.text.includes("조심해")));
    const approved = collectApprovedComicText(plan!, hidden);
    assert.ok(!approved.some((text) => text.includes("조심해")));
    const spec = compileChatComicPanelSpec({
      plan: plan!,
      personaName: "렌",
      characterName: "권태현",
      visibility: hidden,
      subjects: trioVisualSubjects(),
    });
    const section = renderChatComicPanelSpecSection(spec);
    assert.doesNotMatch(section, /Speech bubble .*렌/);
    assert.doesNotMatch(section, /조심해/);
    assert.match(section, /Speech bubble .*강이현/);
    assert.match(section, /Speech bubble .*권태현/);
    const illustration = formatApprovedScenePlanForIllustration(plan!, hidden);
    assert.doesNotMatch(illustration, /조심해/);
  });

  it("A22: personaVisible=true retains all named speakers", () => {
    const { plan } = validatedAdversarialPlan();
    assert.ok(plan);
    const visible = { personaVisible: true as const };
    const dialogue = plan!.panels.flatMap((panel) =>
      projectComicPanelBeat(plan!, panel, visible).dialogue
    );
    assert.deepEqual(
      dialogue.map((line) => line.speakerName),
      ["렌", "강이현", "권태현"]
    );
    const spec = compileChatComicPanelSpec({
      plan: plan!,
      personaName: "렌",
      characterName: "권태현",
      visibility: visible,
      subjects: trioVisualSubjects(),
    });
    const section = renderChatComicPanelSpecSection(spec);
    assert.match(section, /Speech bubble \(B \/ 렌\)/);
    assert.match(section, /Speech bubble \(C \/ 강이현\)/);
    assert.match(section, /Speech bubble \(A \/ 권태현\)/);
  });

  it("A23: user_edit speaker changes remain editor-owned", () => {
    const { messages, providerPlan } = buildAdversarialProviderPlan();
    const validated = validateScenePlan(providerPlan, messages, {
      allowUserEdits: true,
      personaName: SPEAKER_CONTEXT.personaName,
      characterName: SPEAKER_CONTEXT.characterName,
      knownSpeakerNames: SPEAKER_CONTEXT.knownSpeakerNames,
    });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const panel = validated.plan.panels.find((entry) =>
      entry.dialogue.some((line) => line.speakerName === "강이현")
    );
    assert.ok(panel);
    const lineIndex = panel!.dialogue.findIndex((line) => line.speakerName === "강이현");
    const edited = updatePanelDialogueAtIndex(validated.plan, panel!.index, lineIndex, {
      speaker: "character",
      speakerName: "권태현",
      text: "뒤는 내가 볼게.",
    });
    const line = edited.panels
      .find((entry) => entry.index === panel!.index)
      ?.dialogue[lineIndex];
    assert.equal(line?.provenance, "user_edit");
    assert.equal(line?.speaker, "character");
    assert.equal(line?.speakerName, "권태현");
  });
});
