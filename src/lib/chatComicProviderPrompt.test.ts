import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  auditProviderPromptDialogueLeak,
  buildChatComicGenerationPlan,
  buildChatComicImagePrompt,
  countProviderPromptReadableDialogue,
} from "@/lib/chatComicGeneration";
import { compileComicTextOverlaySvg } from "@/lib/chatComicTextOverlay";
import { buildChatComicPanelSpecVisualSection } from "@/lib/chatComicPanelSpec";
import {
  bindApprovedCastManifest,
  groundCastIntent,
} from "@/lib/chatImageCastManifest";
import {
  type ChatImageCastIntentManifest,
} from "@/lib/chatImageCast";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
} from "@/lib/chatImageScenePlan";
import {
  EXACT_USER_PERSONA_APPEARANCE_WITH_PUPIL_SHAPE,
  SCENE_BUILDER_SHARED_DUO,
  SYNTHETIC_CHARACTER_A_APPEARANCE,
} from "@/lib/chatImageVisualIdentity.fixtures";
import { createVisualSubjectKey } from "@/lib/visualSubjects";

const PERSONA_URL = "/synthetic/user-persona-primary.webp";
const MAIN_URL = "/synthetic/character-a-primary.webp";
const SUPPORT_URL = "/synthetic/support-a.webp";
const SUPPORT_SUBJECT_KEY = createVisualSubjectKey();

const GROUND_CTX = {
  persona: {
    name: "렌",
    gender: "female" as const,
    referenceImageUrl: PERSONA_URL,
    savedAppearance: EXACT_USER_PERSONA_APPEARANCE_WITH_PUPIL_SHAPE,
    appearanceMode: "image_plus_saved" as const,
  },
  mainCharacter: {
    name: "라이크",
    gender: "male" as const,
    referenceImageUrl: MAIN_URL,
    savedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
    appearanceMode: "image_plus_saved" as const,
  },
  selectableAssets: [
    {
      url: SUPPORT_URL,
      tag: "강이현",
      visualSubjectKey: SUPPORT_SUBJECT_KEY,
    },
  ],
  visualSubjects: [
    {
      subjectKey: SUPPORT_SUBJECT_KEY,
      name: "강이현",
      savedAppearance: "검은 단발",
      representativeAssetUrl: SUPPORT_URL,
      sourceCharacterId: null,
    },
  ],
  characterAssets: [
    { url: MAIN_URL, tag: "라이크" },
    { url: SUPPORT_URL, tag: "강이현", visualSubjectKey: SUPPORT_SUBJECT_KEY },
  ],
};

function trioIntent(): ChatImageCastIntentManifest {
  return {
    compositionGoal: "trio_group",
    subjects: [
      {
        key: "persona",
        role: "persona",
        name: "렌",
        included: true,
        importance: "primary",
        visibility: "required_visible",
      },
      {
        key: "main_character",
        role: "main_character",
        name: "라이크",
        included: true,
        importance: "primary",
        visibility: "required_visible",
      },
      {
        key: "supporting:강이현",
        role: "supporting_character",
        name: "강이현",
        included: true,
        importance: "primary",
        visibility: "required_visible",
        requestedReferenceAssetUrl: SUPPORT_URL,
      },
    ],
  };
}

function groundTrioPlan(plan: ReturnType<typeof buildDeterministicScenePlan>) {
  const grounded = groundCastIntent(trioIntent(), GROUND_CTX, plan);
  assert.equal(grounded.ok, true);
  if (!grounded.ok) throw new Error(grounded.reason);
  return grounded.manifest;
}

function assertZeroProviderDialogueLeak(
  prompt: string,
  plan: ReturnType<typeof buildDeterministicScenePlan>
) {
  const audit = auditProviderPromptDialogueLeak({ prompt, plan });
  assert.equal(countProviderPromptReadableDialogue(prompt), 0);
  assert.equal(audit.canonicalDialogueOccurrenceCount, 0);
  assert.equal(audit.userEditOccurrenceCount, 0);
  assert.equal(audit.leakedTexts.length, 0);
  assert.doesNotMatch(prompt, /EVENT SUBJECT BINDINGS/);
}

describe("cast-aware comic provider prompt regressions CAST-P1–P5", () => {
  it("CAST-P1: cast-aware approved dialogue reaches the full-provider prompt; raw source marker does not", () => {
    const dialogue = "같이 갈래?";
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: `TIER1_DIALOGUE_SECRET\n"${dialogue}"` },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2, {
      personaName: "렌",
      characterName: "라이크",
    });
    const manifest = groundTrioPlan(plan);
    const production = buildChatComicGenerationPlan({
      ...SCENE_BUILDER_SHARED_DUO,
      personaName: "렌",
      characterName: "라이크",
      plan,
      castManifest: manifest,
    });
    assert.ok(production.prompt.includes(dialogue), "approved dialogue is in the full-provider prompt");
    assert.ok(!production.prompt.includes("TIER1_DIALOGUE_SECRET"), "raw source marker never leaks");

    const svg = compileComicTextOverlaySvg({
      width: 1008,
      height: 1408,
      panelCount: 2,
      plan,
      subjects: production.subjects,
    });
    assert.ok(svg.includes(dialogue));
  });

  it("CAST-P2: cast-aware safe action binding survives in visual panel spec", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: "라이크가 렌의 손을 잡는다." },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2, {
      personaName: "렌",
      characterName: "라이크",
    });
    const manifest = groundTrioPlan(plan);
    const bound = bindApprovedCastManifest(manifest);
    const prompt = buildChatComicImagePrompt({
      characterName: "라이크",
      characterGender: "male",
      personaName: "렌",
      personaGender: "female",
      plan,
      castManifest: manifest,
      castSelected: bound.selected,
      subjects: bound.subjects,
    });
    assertZeroProviderDialogueLeak(prompt, plan);
    const visual = buildChatComicPanelSpecVisualSection({
      plan,
      personaName: "렌",
      characterName: "라이크",
      subjects: bound.subjects,
      castSelected: bound.selected,
      eventSubjectBindings: manifest.eventSubjectBindings,
    });
    assert.match(visual + prompt, /손/);
  });

  it("CAST-P3: risky raw dialogue marker never reaches Tier-1 provider prompt", () => {
    const risky = "TIER1_RAW_UNSAFE_SECRET_성관계";
    const messages = buildSceneSourceMessages([{ id: 1, role: "assistant", content: `"${risky}"` }]);
    const plan = buildDeterministicScenePlan(messages, 2, {
      personaName: "렌",
      characterName: "라이크",
    });
    const manifest = groundTrioPlan(plan);
    const production = buildChatComicGenerationPlan({
      ...SCENE_BUILDER_SHARED_DUO,
      personaName: "렌",
      characterName: "라이크",
      plan,
      castManifest: manifest,
    });
    assertZeroProviderDialogueLeak(production.prompt, plan);
    assert.equal(production.prompt.split("TIER1_RAW_UNSAFE_SECRET").length - 1, 0);
    assert.equal(production.prompt.split("성관계").length - 1, 0);
  });

  it("CAST-P4: named supporting speaker mapping and dialogue reach the full-provider prompt", () => {
    const messages = buildSceneSourceMessages([
      {
        id: 1,
        role: "assistant",
        content: ['강이현: "뒤는 내가 볼게."', '라이크: "조심해."'].join("\n"),
      },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2, {
      personaName: "렌",
      characterName: "라이크",
      knownSpeakerNames: ["강이현", "라이크", "렌"],
    });
    const manifest = groundTrioPlan(plan);
    const production = buildChatComicGenerationPlan({
      ...SCENE_BUILDER_SHARED_DUO,
      personaName: "렌",
      characterName: "라이크",
      plan,
      castManifest: manifest,
    });
    assert.ok(production.prompt.includes("뒤는 내가 볼게."));
    assert.ok(production.prompt.includes("조심해."));
    assert.ok(
      plan.panels.some((panel) =>
        panel.dialogue.some((line) => line.speakerName === "강이현")
      )
    );
    assert.ok(
      manifest.subjects.some(
        (subject) => subject.name === "강이현" && subject.included
      )
    );
  });

  it("CAST-P5: duo without castManifest still includes readable approved dialogue", () => {
    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([{ id: 1, role: "user", content: '"안녕."' }]),
      2
    );
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "female",
      plan,
    });
    assert.ok(prompt.includes("안녕."));
    assert.match(prompt, /RENDER THE COMPLETE MANHWA PAGE WITH READABLE KOREAN TEXT/);
  });
});
