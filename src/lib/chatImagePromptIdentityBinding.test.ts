import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildChatComicImagePrompt, auditComicDialogueWhitelist } from "@/lib/chatComicGeneration";
import {
  COMIC_PANEL_BENCHMARK_FIXTURES,
  scenePlanForFixture,
} from "@/lib/chatComicPanelSpec.fixtures";
import { compileChatComicPanelSpec } from "@/lib/chatComicPanelSpec";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  normalizePanelDialogueEdits,
} from "@/lib/chatImageScenePlan";
import {
  auditPromptIdentityBinding,
  buildPromptSubjectMap,
  referenceOwnerMap,
} from "@/lib/chatImagePromptSubjectMap";
import {
  bindChatImageReferencePack,
  buildChatDuoVisualSubjects,
} from "@/lib/chatImageVisualIdentity";

function duoSubjects(characterName: string, personaName: string) {
  return bindChatImageReferencePack({
    template: { url: "/image-templates/comic-vertical-sample-hq.webp", role: "layout template" },
    subjectsInImageOrder: buildChatDuoVisualSubjects({
      characterName,
      characterGender: "male",
      characterImageUrl: `/ref/${characterName}`,
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaName,
      personaGender: "female",
      personaImageUrl: `/ref/${personaName}`,
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
    }),
  }).subjects;
}

function compileDuoFixture(fixtureId: string) {
  const fixture = COMIC_PANEL_BENCHMARK_FIXTURES.find((item) => item.id === fixtureId);
  assert.ok(fixture, `missing fixture ${fixtureId}`);
  const plan = scenePlanForFixture(fixture);
  const subjects = duoSubjects(fixture.expectedCast.character, fixture.expectedCast.persona);
  const prompt = buildChatComicImagePrompt({
    characterName: fixture.expectedCast.character,
    characterGender: "male",
    personaName: fixture.expectedCast.persona,
    personaGender: "female",
    plan,
    subjects,
    characterImageUrl: `/ref/${fixture.expectedCast.character}`,
    personaImageUrl: `/ref/${fixture.expectedCast.persona}`,
  });
  return { fixture, plan, subjects, prompt };
}

describe("chatImagePromptIdentityBinding — duo canonical namespace", () => {
  it("F01 maps character to SUBJECT A and persona to SUBJECT B consistently", () => {
    const { fixture, subjects, prompt } = compileDuoFixture("F01-2panel-invite");
    const map = buildPromptSubjectMap(subjects);
    assert.equal(map.subjects[0]?.name, fixture.expectedCast.character);
    assert.equal(map.subjects[0]?.label, "A");
    assert.equal(map.subjects[1]?.name, fixture.expectedCast.persona);
    assert.equal(map.subjects[1]?.label, "B");

    const audit = auditPromptIdentityBinding(prompt);
    assert.equal(audit.promptSubjectLabelOwnerCount, 1);
    assert.equal(audit.subjectLabelConflictCount, 0);
    assert.equal(audit.referenceOwnerConflictCount, 0);
    assert.equal(audit.actionOwnerConflictCount, 0);
    assert.equal(audit.speechOwnerConflictCount, 0);

    assert.match(prompt, /\[SUBJECT A — CHAT CHARACTER: 태형\]/);
    assert.match(prompt, /\[SUBJECT B — USER PERSONA: 렌\]/);
    assert.match(prompt, /A = chat character \(태형\)/);
    assert.match(prompt, /B = user persona \(렌\)/);
    assert.ok(prompt.includes("Speech bubble (B / persona):"));
    assert.ok(prompt.includes("같이 갈래?"));
    assert.ok(prompt.includes("Speech bubble (A / character):"));
    assert.ok(prompt.includes("그래."));
    assert.doesNotMatch(prompt, /A = persona \(렌\)/);
    assert.doesNotMatch(prompt, /B = character \(태형\)/);
  });

  it("reference image owners match subject map", () => {
    const { subjects } = compileDuoFixture("F01-2panel-invite");
    const map = buildPromptSubjectMap(subjects);
    const refs = referenceOwnerMap(map, true);
    assert.deepEqual(
      refs.map((entry) => entry.owner),
      ["태형", "렌"]
    );
    assert.equal(refs[0]?.image, 2);
    assert.equal(refs[1]?.image, 3);
  });
});

describe("chatImagePromptIdentityBinding — F08 action ownership", () => {
  it("preserves closing action without wrong subject action label", () => {
    const { plan, subjects, prompt } = compileDuoFixture("F08-4panel-chase");
    const spec = compileChatComicPanelSpec({
      plan,
      personaName: "한별",
      characterName: "시우",
      subjects,
    });
    const closing = spec.panels[3];
    assert.ok(closing);
    assert.match(closing.situation, /한별이 코너에서 시우의 소매를 붙잡는다/);
    assert.equal(
      closing.subjectActions.some((action) => action.text.includes("한별")),
      false,
      "must not label 한별 action under character subject"
    );
    assert.ok(
      closing.sceneAction?.includes("한별이 코너에서 시우의 소매를 붙잡는다") ||
        closing.situation.includes("한별이 코너에서 시우의 소매를 붙잡는다")
    );

    const audit = auditPromptIdentityBinding(prompt);
    assert.equal(audit.actionOwnerConflictCount, 0);
    assert.doesNotMatch(prompt, /B action \(시우\): 한별/);
    assert.doesNotMatch(prompt, /^B action: 한별/m);
  });
});

describe("chatImagePromptIdentityBinding — F04 source action preservation", () => {
  it("keeps 서연 umbrella action in final panel spec", () => {
    const { plan, subjects, prompt } = compileDuoFixture("F04-3koma-rain");
    const spec = compileChatComicPanelSpec({
      plan,
      personaName: "서연",
      characterName: "도윤",
      subjects,
    });
    const events = plan.events.map((event) => event.text).join("\n");
    assert.match(events, /서연이 우산을 더 가까이 건넨다/);

    const closing = spec.panels[2];
    assert.ok(closing);
    const panelText = [
      closing.situation,
      closing.sceneAction ?? "",
      ...closing.subjectActions.map((action) => action.text),
    ].join("\n");
    assert.match(panelText, /서연이 우산을 더 가까이 건넨다/);
    assert.match(prompt, /Speech bubble \(A \/ character\):.*고마워/);
  });
});

describe("chatImagePromptIdentityBinding — user edit speaker", () => {
  it("maps edited speaker to canonical prompt subject label", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: '"그래."' },
    ]);
    let plan = buildDeterministicScenePlan(messages, 2);
    const editedDialogue = normalizePanelDialogueEdits(plan.panels[0]!.dialogue, [
      {
        speaker: "persona",
        text: "그래.",
        provenance: "user_edit",
      },
    ]);
    plan = {
      ...plan,
      panels: plan.panels.map((panel, index) =>
        index === 0 ? { ...panel, dialogue: editedDialogue } : panel
      ),
    };
    const subjects = duoSubjects("태형", "렌");
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "female",
      plan,
      subjects,
    });
    assert.match(prompt, /Speech bubble \(B \/ persona\): “그래.”/);
    assert.doesNotMatch(prompt, /Speech bubble \(A \/ character\): “그래.”/);
    assert.equal(auditPromptIdentityBinding(prompt).speechOwnerConflictCount, 0);
  });
});

describe("chatImagePromptIdentityBinding — persona hidden", () => {
  it("uses visual subject A for visible main character when persona hidden", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: '"안녕."' },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const subjects = duoSubjects("태현", "렌");
    const prompt = buildChatComicImagePrompt({
      characterName: "태현",
      characterGender: "male",
      personaName: "렌",
      personaGender: "female",
      plan,
      subjects,
      contentKind: "simulation",
      castManifest: {
        compositionGoal: "duo_focus",
        subjects: [
          {
            key: "main_character",
            role: "main_character",
            name: "태현",
            included: true,
            importance: "primary",
            referenceImageUrl: "/ref/태현",
            sourceKind: "main_character",
            visualRole: "chat character",
            gender: "male",
            appearanceMode: "image_only",
            savedAppearance: "",
            attachReference: true,
            eventSubjectIds: [],
            mentionNames: [],
            compositionGoal: "",
          },
        ],
        eventSubjectBindings: [],
      },
      castSelected: [
        {
          key: "main_character",
          role: "main_character",
          name: "태현",
          included: true,
          importance: "primary",
          referenceImageUrl: "/ref/태현",
          sourceKind: "main_character",
          visualRole: "chat character",
          gender: "male",
          appearanceMode: "image_only",
          savedAppearance: "",
          attachReference: true,
          eventSubjectIds: [],
          mentionNames: [],
          compositionGoal: "",
        },
      ],
    });
    assert.match(prompt, /A = chat character \(태현\)/);
    assert.match(prompt, /Speech bubble \(A \/ character\): “안녕.”/);
    assert.doesNotMatch(prompt, /persona A off-camera/);
    assert.match(prompt, /SUBJECT A \(태현\) centered; persona off-camera only/);
  });
});

describe("chatImagePromptIdentityBinding — negative controls", () => {
  it("detects reversed cast labels in audit", () => {
    const { prompt } = compileDuoFixture("F01-2panel-invite");
    const conflictPrompt = prompt.replace(
      "A = chat character (태형)",
      "A = chat character (렌)"
    );
    assert.ok(auditPromptIdentityBinding(conflictPrompt).subjectLabelConflictCount > 0);
  });

  it("detects wrong action owner in audit", () => {
    const prompt = [
      "[SUBJECT A — CHAT CHARACTER: 시우]",
      "[SUBJECT B — USER PERSONA: 한별]",
      "COMIC PANEL SPEC",
      "Cast:",
      "A = chat character (시우)",
      "B = user persona (한별)",
      "B action (한별): 시우가 뛴다",
    ].join("\n");
    assert.ok(auditPromptIdentityBinding(prompt).actionOwnerConflictCount > 0);
  });
});

describe("chatImagePromptIdentityBinding — whitelist regression", () => {
  it("auditComicDialogueWhitelist stays aligned after identity bind", () => {
    const { plan, prompt } = compileDuoFixture("F01-2panel-invite");
    const audit = auditComicDialogueWhitelist({
      plan,
      personaName: "렌",
      characterName: "태형",
    });
    assert.equal(audit.panelTextWhitelistMismatchCount, 0);
    assert.equal(audit.userEditDialogueMismatchCount, 0);
    assert.ok(prompt.includes("같이 갈래?"));
    assert.ok(prompt.includes("그래."));
  });
});
