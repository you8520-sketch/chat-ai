import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildStrictComicFallbackPrompt,
  buildStrictLdDuoFallbackPrompt,
} from "@/lib/chatImageStrictSafetyFallbackPrompt";
import { buildLdSceneGenerationPlan } from "@/lib/chatLdIllustrationGeneration";
import {
  clipSavedAppearanceForStrictFallback,
  extractVisualAppearance,
  prepareSubjectsForStrictFallback,
  renderChatImageStyleFidelityContract,
  resolveRequestAppearanceModes,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";
import {
  EXACT_USER_PERSONA_APPEARANCE_WITH_PUPIL_SHAPE,
  syntheticComicPlan,
} from "@/lib/chatImageVisualIdentity.fixtures";

const PERSONA_DESC = EXACT_USER_PERSONA_APPEARANCE_WITH_PUPIL_SHAPE;
const RED_PUPIL_MARKER = /Pupil color: red/i;

const DUO_SUBJECTS: ChatImageVisualSubject[] = [
  {
    key: "character",
    name: "에단",
    gender: "male",
    role: "chat character",
    referenceImageUrl: "/c.webp",
    referenceIndex: 1,
    savedAppearance: "검은 홍채, 붉은 동공",
    appearanceMode: "image_plus_saved",
    sourceKind: "main_character",
  },
  {
    key: "persona",
    name: "리프트",
    gender: "female",
    role: "user persona",
    referenceImageUrl: "/p.webp",
    referenceIndex: 2,
    savedAppearance: PERSONA_DESC,
    appearanceMode: "image_plus_saved",
    sourceKind: "persona",
  },
];

describe("chatImageSubjectFidelity — deterministic reproduction", () => {
  it("SUBJECT-PROOF-1 persona description extracts visual appearance for image_plus_saved", () => {
    const extracted = extractVisualAppearance(PERSONA_DESC);
    assert.ok(extracted.includes("붉은 동공"), "visual extractor must retain red pupil clause");
    const modes = resolveRequestAppearanceModes({
      characterImages: [{ url: "/primary.webp" }],
      selectedCharacterImageUrl: "/primary.webp",
      characterSavedAppearance: "검은 홍채, 붉은 동공",
      personaSavedAppearance: extracted,
    });
    assert.equal(modes.personaAppearanceMode, "image_plus_saved");
  });

  it("SUBJECT-PROOF-2 comic primary includes normalized red pupil for persona", () => {
    const { prompt } = syntheticComicPlan();
    assert.match(prompt, RED_PUPIL_MARKER);
    assert.match(prompt, /SUBJECT B[\s\S]*Appearance mode: IMAGE_PLUS_SAVED/);
  });

  it("SUBJECT-PROOF-3 comic strict fallback preserves persona immutable eye traits", () => {
    const { subjects } = syntheticComicPlan();
    const strict = buildStrictComicFallbackPrompt({
      panelCount: 3,
      characterName: "CharacterA",
      characterGender: "male",
      personaName: "UserPersona",
      personaGender: "female",
      subjects,
      compositionMode: "full_provider_rendered",
    });
    assert.match(strict, RED_PUPIL_MARKER);
    assert.match(strict, /UserPersona[\s\S]*Appearance mode: IMAGE_PLUS_SAVED/);
  });

  it("SUBJECT-PROOF-4 LD strict fallback parity with primary persona eye traits", () => {
    const primary = buildLdSceneGenerationPlan({
      characterName: "에단",
      characterGender: "male",
      personaName: "리프트",
      personaGender: "female",
      characterImageUrl: "/c.webp",
      characterSavedAppearance: "검은 홍채",
      characterAppearanceMode: "image_plus_saved",
      personaImageUrl: "/p.webp",
      personaSavedAppearance: PERSONA_DESC,
      personaAppearanceMode: "image_plus_saved",
      currentTurn: "카페에서 대화한다.",
    }).prompt;
    const strict = buildStrictLdDuoFallbackPrompt({
      characterName: "에단",
      characterGender: "male",
      personaName: "리프트",
      personaGender: "female",
      subjects: DUO_SUBJECTS,
      sceneSourceText: "카페에서 대화한다.",
      adultGrounded: false,
    });
    assert.match(primary, RED_PUPIL_MARKER);
    assert.match(strict, RED_PUPIL_MARKER);
  });

  it("SUBJECT-PROOF-5 untrusted supporting cast saved appearance stays stripped in strict", () => {
    const supporting: ChatImageVisualSubject = {
      key: "support-1",
      name: "조연",
      gender: "female",
      role: "supporting",
      referenceImageUrl: "/support.webp",
      referenceIndex: 3,
      savedAppearance: "CLIENT_PROMPT_INJECTION evil scene text",
      appearanceMode: "image_plus_saved",
      sourceKind: "cast_member",
      trustedSavedAppearance: false,
    };
    const clipped = clipSavedAppearanceForStrictFallback(supporting);
    assert.equal(clipped, "");
    const prepared = prepareSubjectsForStrictFallback([supporting])[0]!;
    assert.equal(prepared.savedAppearance, "");
    assert.equal(prepared.appearanceMode, "image_only");
  });

  it("SUBJECT-PROOF-6 style owner preserves immutable traits during multi-subject convergence", () => {
    const style = renderChatImageStyleFidelityContract({
      hasTemplate: true,
      subjectCount: 2,
    });
    assert.match(style, /preserve each subject's immutable identity traits/i);
  });
});
