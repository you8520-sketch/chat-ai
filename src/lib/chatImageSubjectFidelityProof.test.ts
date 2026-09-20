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
  renderCrossSubjectTraitIsolation,
  resolveRequestAppearanceModes,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";
import { SYNTHETIC_CHARACTER_A_APPEARANCE } from "@/lib/chatImageVisualIdentity.fixtures";
import {
  EXACT_USER_PERSONA_APPEARANCE_WITH_PUPIL_SHAPE,
  syntheticComicPlan,
} from "@/lib/chatImageVisualIdentity.fixtures";

const PERSONA_DESC = EXACT_USER_PERSONA_APPEARANCE_WITH_PUPIL_SHAPE;
const RED_PUPIL_MARKER = /Pupil color: red/i;

function subjectManifestBlock(prompt: string, letter: "A" | "B"): string {
  const match = prompt.match(
    new RegExp(`\\[SUBJECT ${letter}[\\s\\S]*?(?=\\[SUBJECT [A-Z]|\\nSTYLE FIDELITY|$)`)
  );
  return match?.[0] ?? "";
}

const DUO_SUBJECTS: ChatImageVisualSubject[] = [
  {
    key: "character",
    name: "에단",
    gender: "male",
    role: "chat character",
    referenceImageUrl: "/c.webp",
    referenceIndex: 1,
    savedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
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

  it("TRAIT-BLEED-1 comic primary binds red pupils to persona block only", () => {
    const { prompt } = syntheticComicPlan();
    const blockA = subjectManifestBlock(prompt, "A");
    const blockB = subjectManifestBlock(prompt, "B");
    assert.match(blockB, /UserPersona ONLY — Pupil color: red/i);
    assert.match(blockB, /UserPersona ONLY — Iris color: black/i);
    assert.match(blockA, /CharacterA ONLY — Iris color: red/i);
    assert.match(blockA, /CharacterA ONLY — Pupil color: black/i);
    assert.doesNotMatch(blockA, /CharacterA ONLY — Pupil color: red/i);
    assert.doesNotMatch(blockB, /UserPersona ONLY — Iris color: red/i);
    assert.doesNotMatch(blockA, /UserPersona ONLY/);
    assert.doesNotMatch(blockB, /CharacterA ONLY — Iris color: red/);
    assert.doesNotMatch(blockB, /CharacterA ONLY — Pupil color: black/);
  });

  it("TRAIT-BLEED-2 cross-subject isolation lists exclusive eye ownership", () => {
    const { prompt, subjects } = syntheticComicPlan();
    const isolation = renderCrossSubjectTraitIsolation(subjects);
    assert.match(isolation, /CharacterA \(SUBJECT A\):.*iris red.*pupil black/i);
    assert.match(isolation, /UserPersona \(SUBJECT B\):.*iris black.*pupil red/i);
    assert.match(prompt, /CROSS-SUBJECT IMMUTABLE TRAIT ISOLATION/);
    assert.match(prompt, /Never swap, merge, or duplicate these eye traits/);
  });

  it("TRAIT-BLEED-3 strict fallback preserves subject-bound eye traits and isolation", () => {
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
    assert.match(strict, /UserPersona ONLY — Pupil color: red/i);
    assert.match(strict, /CharacterA ONLY — Iris color: red/i);
    assert.match(strict, /CROSS-SUBJECT IMMUTABLE TRAIT ISOLATION/);
    assert.doesNotMatch(
      subjectManifestBlock(strict, "A"),
      /UserPersona ONLY — Pupil color: red/
    );
  });

  it("TRAIT-BLEED-4 LD primary and strict share the same trait isolation owner", () => {
    const primary = buildLdSceneGenerationPlan({
      characterName: "에단",
      characterGender: "male",
      personaName: "리프트",
      personaGender: "female",
      characterImageUrl: "/c.webp",
      characterSavedAppearance: SYNTHETIC_CHARACTER_A_APPEARANCE,
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
    for (const prompt of [primary, strict]) {
      assert.match(prompt, /리프트 ONLY — Pupil color: red/i);
      assert.match(prompt, /에단 ONLY — Iris color: red/i);
      assert.match(prompt, /CROSS-SUBJECT IMMUTABLE TRAIT ISOLATION/);
    }
  });
});
