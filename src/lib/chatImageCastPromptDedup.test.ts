import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildChatComicGenerationPlan } from "./chatComicGeneration";
import { buildLdSceneGenerationPlan } from "./chatLdIllustrationGeneration";
import {
  groundCastIntent,
  type GroundCastContext,
} from "./chatImageCastManifest";
import {
  draftCastIntentFromMentions,
  applyUserCastEdits,
} from "./chatImageCast";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
} from "./chatImageScenePlan";
import {
  EXACT_USER_PERSONA_APPEARANCE_WITH_PUPIL_SHAPE,
  SCENE_BUILDER_SHARED_DUO,
  SYNTHETIC_CHARACTER_A_APPEARANCE,
} from "./chatImageVisualIdentity.fixtures";
import { createVisualSubjectKey } from "./visualSubjects";

const PERSONA_URL = "/synthetic/user-persona-primary.webp";
const MAIN_URL = "/synthetic/character-a-primary.webp";
const SUPPORT_REF_URL = "/synthetic/support-with-ref.webp";
const SUPPORT_SAVED_ONLY_APPEARANCE = "long silver hair, violet eyes, white coat";

const SUPPORT_REF_KEY = createVisualSubjectKey();
const SUPPORT_SAVED_KEY = createVisualSubjectKey();

const QUARTET_GROUND_CTX: GroundCastContext = {
  persona: {
    name: "UserPersona",
    gender: "female",
    referenceImageUrl: PERSONA_URL,
    savedAppearance: EXACT_USER_PERSONA_APPEARANCE_WITH_PUPIL_SHAPE,
    appearanceMode: "image_plus_saved",
  },
  mainCharacter: {
    name: "CharacterA",
    gender: "male",
    referenceImageUrl: MAIN_URL,
    savedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
    appearanceMode: "image_plus_saved",
  },
  selectableAssets: [
    { url: SUPPORT_REF_URL, tag: "SupportRef", visualSubjectKey: SUPPORT_REF_KEY },
  ],
  visualSubjects: [
    {
      subjectKey: SUPPORT_REF_KEY,
      name: "SupportRef",
      savedAppearance: "short black hair",
      representativeAssetUrl: SUPPORT_REF_URL,
      sourceCharacterId: null,
    },
    {
      subjectKey: SUPPORT_SAVED_KEY,
      name: "SupportSaved",
      savedAppearance: SUPPORT_SAVED_ONLY_APPEARANCE,
      representativeAssetUrl: null,
      sourceCharacterId: null,
    },
  ],
  characterAssets: [
    { url: MAIN_URL, tag: "CharacterA" },
    { url: SUPPORT_REF_URL, tag: "SupportRef", visualSubjectKey: SUPPORT_REF_KEY },
  ],
};

function castBlock(prompt: string): string {
  const start = prompt.indexOf("APPROVED CAST MANIFEST");
  assert.ok(start >= 0, "missing APPROVED CAST MANIFEST");
  const identityStart = prompt.indexOf("SUBJECT IDENTITY MANIFEST", start);
  assert.ok(identityStart > start, "missing SUBJECT IDENTITY MANIFEST");
  return prompt.slice(start, identityStart);
}

function identityBlock(prompt: string): string {
  const start = prompt.indexOf("SUBJECT IDENTITY MANIFEST");
  assert.ok(start >= 0, "missing SUBJECT IDENTITY MANIFEST");
  const contractStart = prompt.indexOf("IDENTITY OWNERSHIP IS STRICT", start);
  assert.ok(contractStart > start, "missing IDENTITY OWNERSHIP IS STRICT");
  return prompt.slice(start, contractStart);
}

function assertPromptOwnerDedup(prompt: string, opts: {
  referenceOwners: Array<{ index: number; name: string }>;
  savedAppearanceOnly?: { subjectName: string; text: string };
}) {
  assert.equal([...prompt.matchAll(/APPROVED CAST MANIFEST/g)].length, 1);
  assert.equal([...prompt.matchAll(/SUBJECT IDENTITY MANIFEST/g)].length, 1);
  assert.equal([...prompt.matchAll(/IDENTITY OWNERSHIP IS STRICT/g)].length, 1);

  const cast = castBlock(prompt);
  assert.doesNotMatch(cast, /belongs ONLY/);
  assert.doesNotMatch(cast, /Never borrow another subject/);
  assert.doesNotMatch(cast, /Never copy one simulation member/);
  assert.doesNotMatch(cast, /Never copy the main character/);
  assert.doesNotMatch(cast, /Never map a no-photo subject/);

  for (const owner of opts.referenceOwners) {
    const line = `Reference: Image ${owner.index} belongs ONLY to ${owner.name}.`;
    assert.equal(
      [...prompt.matchAll(new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))].length,
      1,
      `duplicate reference owner line for ${owner.name}`
    );
  }

  if (opts.savedAppearanceOnly) {
    const { subjectName, text } = opts.savedAppearanceOnly;
    const identity = identityBlock(prompt);
    assert.match(identity, new RegExp(text));
    assert.doesNotMatch(cast, new RegExp(text));
    assert.match(cast, new RegExp(`${subjectName}: SAVED-ONLY fidelity`));
    assert.equal([...prompt.matchAll(new RegExp(text, "g"))].length, 1);
  }

  assert.match(cast, /Exactly 4 recurring identities/);
  assert.match(cast, /importance=primary/);
  assert.match(cast, /importance=secondary/);
  assert.match(cast, /visibility=required_visible/);
  assert.match(cast, /visibility=preferred_visible/);
  assert.match(cast, /CAST FIDELITY TIERS/);
  assert.match(cast, /COMPOSITION GOAL:/);
}

describe("chatImageCastPromptDedup", () => {
  it("character comic/LD final prompts keep single identity owners without cast duplication", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: "*손을 흔든다* SupportRef가 고개를 끄덕였다." },
      { id: 2, role: "assistant", content: "SupportSaved가 옆에서 미소 지었다." },
    ]);
    const plan = buildDeterministicScenePlan(messages, 3);
    const supportRefEvent = plan.events.find((event) => event.text.includes("SupportRef"))?.id;
    assert.ok(supportRefEvent);

    let intent = draftCastIntentFromMentions({
      personaName: "UserPersona",
      mainCharacterName: "CharacterA",
      castMentions: [{ name: "SupportRef", sourceEventIds: [supportRefEvent!] }],
    });
    intent = {
      ...intent,
      subjects: [
        ...intent.subjects,
        {
          key: "supporting:SupportSaved",
          role: "supporting_character",
          name: "SupportSaved",
          included: true,
          importance: "secondary",
          visibility: "preferred_visible",
        },
      ],
    };
    intent = applyUserCastEdits(intent, "supporting:SupportRef", {
      included: true,
      requestedReferenceAssetUrl: SUPPORT_REF_URL,
      importance: "primary",
    });

    const grounded = groundCastIntent(intent, QUARTET_GROUND_CTX, plan);
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);

    const comic = buildChatComicGenerationPlan({
      ...SCENE_BUILDER_SHARED_DUO,
      plan,
      castManifest: grounded.manifest,
      contentKind: "character",
    });
    assertPromptOwnerDedup(comic.prompt, {
      referenceOwners: [
        { index: 2, name: "UserPersona" },
        { index: 3, name: "CharacterA" },
        { index: 4, name: "SupportRef" },
      ],
      savedAppearanceOnly: {
        subjectName: "SupportSaved",
        text: SUPPORT_SAVED_ONLY_APPEARANCE,
      },
    });
    assert.doesNotMatch(castBlock(comic.prompt), /EVENT SUBJECT BINDINGS/);
    assert.match(comic.prompt, /COMIC PANEL SPEC — FULL PROVIDER-RENDERED MANHWA PAGE/);

    const ld = buildLdSceneGenerationPlan({
      ...SCENE_BUILDER_SHARED_DUO,
      approvedScenePlan: plan,
      castManifest: grounded.manifest,
      contentKind: "character",
    });
    assertPromptOwnerDedup(ld.prompt, {
      referenceOwners: [
        { index: 1, name: "UserPersona" },
        { index: 2, name: "CharacterA" },
        { index: 3, name: "SupportRef" },
      ],
      savedAppearanceOnly: {
        subjectName: "SupportSaved",
        text: SUPPORT_SAVED_ONLY_APPEARANCE,
      },
    });
    assert.match(castBlock(ld.prompt), /EVENT SUBJECT BINDINGS/);
  });

  it("simulation comic/LD final prompts preserve isolated member identities without cast duplication", () => {
    const memberA = "MemberA";
    const memberB = "MemberB";
    const memberSaved = "MemberSaved";
    const urlA = "/synthetic/sim-a.webp";
    const urlB = "/synthetic/sim-b.webp";
    const keyA = createVisualSubjectKey();
    const keyB = createVisualSubjectKey();
    const keySaved = createVisualSubjectKey();
    const savedAppearance = "green eyes, braided hair, red scarf";

    const simIntent: ChatImageCastIntentManifest = {
      compositionGoal: "ensemble_scene",
      subjects: [
        {
          key: "persona",
          role: "persona",
          name: "Viewer",
          included: true,
          importance: "secondary",
          visibility: "preferred_visible",
        },
        {
          key: `supporting:${memberA}`,
          role: "supporting_character",
          name: memberA,
          included: true,
          importance: "primary",
          visibility: "required_visible",
          requestedReferenceAssetUrl: urlA,
        },
        {
          key: `supporting:${memberB}`,
          role: "supporting_character",
          name: memberB,
          included: true,
          importance: "primary",
          visibility: "required_visible",
          requestedReferenceAssetUrl: urlB,
        },
        {
          key: `supporting:${memberSaved}`,
          role: "supporting_character",
          name: memberSaved,
          included: true,
          importance: "secondary",
          visibility: "preferred_visible",
        },
      ],
    };

    const simCtx: GroundCastContext = {
      persona: {
        name: "Viewer",
        gender: "female",
        referenceImageUrl: PERSONA_URL,
        savedAppearance: "",
        appearanceMode: "image_only",
      },
      mainCharacter: {
        name: "UnusedMain",
        gender: "other",
        referenceImageUrl: "",
        savedAppearance: "",
        appearanceMode: "image_only",
      },
      selectableAssets: [
        { url: urlA, tag: memberA, visualSubjectKey: keyA },
        { url: urlB, tag: memberB, visualSubjectKey: keyB },
        { url: PERSONA_URL, tag: "Viewer" },
      ],
      visualSubjects: [
        {
          subjectKey: keyA,
          name: memberA,
          savedAppearance: "appearance A",
          representativeAssetUrl: urlA,
          sourceCharacterId: null,
        },
        {
          subjectKey: keyB,
          name: memberB,
          savedAppearance: "appearance B",
          representativeAssetUrl: urlB,
          sourceCharacterId: null,
        },
        {
          subjectKey: keySaved,
          name: memberSaved,
          savedAppearance,
          representativeAssetUrl: null,
          sourceCharacterId: null,
        },
      ],
      characterAssets: [
        { url: urlA, tag: memberA, visualSubjectKey: keyA },
        { url: urlB, tag: memberB, visualSubjectKey: keyB },
        { url: PERSONA_URL, tag: "Viewer" },
      ],
    };

    const grounded = groundCastIntent(simIntent, simCtx, undefined, "simulation");
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);

    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([
        { id: 1, role: "assistant", content: `${memberA}와 ${memberB}가 ${memberSaved}를 바라본다.` },
      ]),
      2
    );

    const comic = buildChatComicGenerationPlan({
      characterName: "SimTitle",
      characterGender: "other",
      personaName: "Viewer",
      personaGender: "female",
      characterImageUrl: "",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaImageUrl: PERSONA_URL,
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
      plan,
      castManifest: grounded.manifest,
      contentKind: "simulation",
    });

    assertPromptOwnerDedup(comic.prompt, {
      referenceOwners: [
        { index: 2, name: "Viewer" },
        { index: 3, name: memberA },
        { index: 4, name: memberB },
      ],
      savedAppearanceOnly: { subjectName: memberSaved, text: savedAppearance },
    });
    assert.doesNotMatch(comic.prompt, /UnusedMain/);

    const ld = buildLdSceneGenerationPlan({
      characterName: "SimTitle",
      characterGender: "other",
      personaName: "Viewer",
      personaGender: "female",
      characterImageUrl: "",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaImageUrl: PERSONA_URL,
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
      approvedScenePlan: plan,
      castManifest: grounded.manifest,
      contentKind: "simulation",
    });

    assertPromptOwnerDedup(ld.prompt, {
      referenceOwners: [
        { index: 1, name: "Viewer" },
        { index: 2, name: memberA },
        { index: 3, name: memberB },
      ],
      savedAppearanceOnly: { subjectName: memberSaved, text: savedAppearance },
    });
    assert.doesNotMatch(ld.prompt, /UnusedMain/);
  });
});
