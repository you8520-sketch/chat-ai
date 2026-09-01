import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditComicDialogueWhitelist, buildChatComicGenerationPlan } from "@/lib/chatComicGeneration";
import {
  buildProductionDuoGenerationPlanForFixture,
  COMIC_PANEL_BENCHMARK_FIXTURES,
  PRODUCTION_COMIC_TEMPLATE_URL,
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
  productionReferenceOwnerMap,
} from "@/lib/chatImagePromptSubjectMap";

function compileProductionDuoFixture(fixtureId: string) {
  const fixture = COMIC_PANEL_BENCHMARK_FIXTURES.find((item) => item.id === fixtureId);
  assert.ok(fixture, `missing fixture ${fixtureId}`);
  const plan = scenePlanForFixture(fixture);
  const production = buildProductionDuoGenerationPlanForFixture({
    plan,
    characterName: fixture.expectedCast.character,
    personaName: fixture.expectedCast.persona,
  });
  return { fixture, plan, production };
}

describe("chatImagePromptIdentityBinding — duo canonical namespace", () => {
  it("F01 maps character to SUBJECT A and persona to SUBJECT B consistently", () => {
    const { fixture, production } = compileProductionDuoFixture("F01-2panel-invite");
    const { subjects, prompt } = production;
    const map = buildPromptSubjectMap(subjects);
    assert.equal(map.subjects[0]?.name, fixture.expectedCast.character);
    assert.equal(map.subjects[0]?.label, "A");
    assert.equal(map.subjects[1]?.name, fixture.expectedCast.persona);
    assert.equal(map.subjects[1]?.label, "B");

    const audit = auditPromptIdentityBinding(prompt);
    assert.equal(audit.subjectLabelConflictCount, 0);
    assert.equal(audit.referenceOwnerConflictCount, 0);
    assert.equal(audit.templateReferenceOwnerConflictCount, 0);
    assert.equal(audit.referenceSlotConflictCount, 0);
    assert.equal(audit.actionOwnerConflictCount, 0);
    assert.equal(audit.speechOwnerConflictCount, 0);

    assert.match(prompt, /Reference image 1 is LAYOUT AND FINISH ONLY/i);
    assert.match(prompt, /\[SUBJECT A — CHAT CHARACTER: 태형\]/);
    assert.match(prompt, /\[SUBJECT B — USER PERSONA: 렌\]/);
    assert.match(prompt, /Reference: Image 2 belongs ONLY to 태형/);
    assert.match(prompt, /Reference: Image 3 belongs ONLY to 렌/);
    assert.match(prompt, /A = chat character \(태형\)/);
    assert.match(prompt, /B = user persona \(렌\)/);
    assert.ok(prompt.includes("Speech bubble (B / persona):"));
    assert.ok(prompt.includes("같이 갈래?"));
    assert.ok(prompt.includes("Speech bubble (A / character):"));
    assert.ok(prompt.includes("그래."));
    assert.doesNotMatch(prompt, /A = persona \(렌\)/);
    assert.doesNotMatch(prompt, /B = character \(태형\)/);
    assert.doesNotMatch(prompt, /Reference: Image 1 belongs ONLY to 태형/);
  });

  it("production reference map includes template slot before human subjects", () => {
    const { fixture, production } = compileProductionDuoFixture("F01-2panel-invite");
    const refs = productionReferenceOwnerMap({
      referenceUrls: production.referenceUrls,
      subjects: production.subjects,
      templateUrl: PRODUCTION_COMIC_TEMPLATE_URL,
    });
    assert.deepEqual(
      refs.map((entry) => entry.owner),
      [
        "template / composition only",
        `chat character: ${fixture.expectedCast.character}`,
        `user persona: ${fixture.expectedCast.persona}`,
      ]
    );
    assert.equal(refs[0]?.image, 1);
    assert.equal(refs[1]?.image, 2);
    assert.equal(refs[2]?.image, 3);
  });
});

describe("chatImagePromptIdentityBinding — F08 action ownership", () => {
  it("preserves closing action without wrong subject action label", () => {
    const { plan, production } = compileProductionDuoFixture("F08-4panel-chase");
    const { subjects, prompt } = production;
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
    assert.equal(audit.templateReferenceOwnerConflictCount, 0);
    assert.doesNotMatch(prompt, /B action \(시우\): 한별/);
    assert.doesNotMatch(prompt, /^B action: 한별/m);
  });
});

describe("chatImagePromptIdentityBinding — F04 source action preservation", () => {
  it("keeps 서연 umbrella action in final panel spec", () => {
    const { plan, production } = compileProductionDuoFixture("F04-3koma-rain");
    const { subjects, prompt } = production;
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
    const production = buildProductionDuoGenerationPlanForFixture({
      plan,
      characterName: "태형",
      personaName: "렌",
    });
    const prompt = production.prompt;
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
    const castManifest = {
      compositionGoal: "duo_focus" as const,
      subjects: [
        {
          key: "main_character",
          role: "main_character",
          name: "태현",
          included: true,
          importance: "primary" as const,
          referenceImageUrl: "/ref/태현",
          sourceKind: "main_character" as const,
          visualRole: "chat character",
          gender: "male" as const,
          appearanceMode: "image_only" as const,
          savedAppearance: "",
          attachReference: true,
          eventSubjectIds: [],
          mentionNames: [],
          compositionGoal: "",
        },
      ],
      eventSubjectBindings: [],
    };
    const production = buildChatComicGenerationPlan({
      characterName: "태현",
      characterGender: "male",
      personaName: "렌",
      personaGender: "female",
      characterImageUrl: "/ref/태현",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaImageUrl: "/ref/렌",
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
      plan,
      castManifest,
      contentKind: "simulation",
    });
    const prompt = production.prompt;
    assert.match(prompt, /A = chat character \(태현\)/);
    assert.match(prompt, /Speech bubble \(A \/ character\): “안녕.”/);
    assert.doesNotMatch(prompt, /persona A off-camera/);
    assert.match(prompt, /SUBJECT A \(태현\) centered; persona off-camera only/);
    assert.equal(auditPromptIdentityBinding(prompt).subjectLabelConflictCount, 0);
  });
});

describe("chatImagePromptIdentityBinding — negative controls", () => {
  it("detects reversed cast labels in audit", () => {
    const { production } = compileProductionDuoFixture("F01-2panel-invite");
    const conflictPrompt = production.prompt.replace(
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

  it("detects template slot assigned to human subject", () => {
    const prompt = [
      "Reference image 1 is LAYOUT AND FINISH ONLY",
      "[SUBJECT A — CHAT CHARACTER: 태형]",
      "Reference: Image 1 belongs ONLY to 태형.",
      "[SUBJECT B — USER PERSONA: 렌]",
      "Reference: Image 3 belongs ONLY to 렌.",
      "COMIC PANEL SPEC",
      "Cast:",
      "A = chat character (태형)",
      "B = user persona (렌)",
    ].join("\n");
    assert.ok(auditPromptIdentityBinding(prompt).templateReferenceOwnerConflictCount > 0);
  });

  it("detects duplicate reference slot owners", () => {
    const prompt = [
      "[SUBJECT A — CHAT CHARACTER: 태형]",
      "Reference: Image 2 belongs ONLY to 태형.",
      "[SUBJECT B — USER PERSONA: 렌]",
      "Reference: Image 2 belongs ONLY to 렌.",
      "COMIC PANEL SPEC",
      "Cast:",
      "A = chat character (태형)",
      "B = user persona (렌)",
    ].join("\n");
    assert.ok(auditPromptIdentityBinding(prompt).referenceSlotConflictCount > 0);
  });
});

describe("chatImagePromptIdentityBinding — whitelist regression", () => {
  it("auditComicDialogueWhitelist stays aligned after identity bind", () => {
    const { plan, production } = compileProductionDuoFixture("F01-2panel-invite");
    const audit = auditComicDialogueWhitelist({
      plan,
      personaName: "렌",
      characterName: "태형",
    });
    assert.equal(audit.panelTextWhitelistMismatchCount, 0);
    assert.equal(audit.userEditDialogueMismatchCount, 0);
    assert.ok(production.prompt.includes("같이 갈래?"));
    assert.ok(production.prompt.includes("그래."));
  });
});

describe("chatImagePromptIdentityBinding — benchmark corpus counters", () => {
  it("production generation plan corpus has zero identity conflicts", () => {
    let subjectLabelConflictTotal = 0;
    let templateReferenceOwnerConflictTotal = 0;
    let referenceSlotConflictTotal = 0;
    let actionOwnerConflictTotal = 0;
    let speechOwnerConflictTotal = 0;

    for (const fixture of COMIC_PANEL_BENCHMARK_FIXTURES) {
      const plan = scenePlanForFixture(fixture);
      const production = buildProductionDuoGenerationPlanForFixture({
        plan,
        characterName: fixture.expectedCast.character,
        personaName: fixture.expectedCast.persona,
      });
      const audit = auditPromptIdentityBinding(production.prompt);
      subjectLabelConflictTotal += audit.subjectLabelConflictCount;
      templateReferenceOwnerConflictTotal += audit.templateReferenceOwnerConflictCount;
      referenceSlotConflictTotal += audit.referenceSlotConflictCount;
      actionOwnerConflictTotal += audit.actionOwnerConflictCount;
      speechOwnerConflictTotal += audit.speechOwnerConflictCount;
    }

    assert.equal(subjectLabelConflictTotal, 0);
    assert.equal(templateReferenceOwnerConflictTotal, 0);
    assert.equal(referenceSlotConflictTotal, 0);
    assert.equal(actionOwnerConflictTotal, 0);
    assert.equal(speechOwnerConflictTotal, 0);
  });
});
