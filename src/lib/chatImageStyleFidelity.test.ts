import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildChatComicGenerationPlan } from "@/lib/chatComicGeneration";
import { buildDeterministicScenePlan, buildSceneSourceMessages } from "@/lib/chatImageScenePlan";
import {
  buildStrictComicFallbackPrompt,
  buildStrictLdDuoFallbackPrompt,
  buildStrictLdPartyFallbackPrompt,
} from "@/lib/chatImageStrictSafetyFallbackPrompt";
import {
  buildChatLdIllustrationPrompt,
  buildLdDuoGenerationPlan,
} from "@/lib/chatLdIllustrationGeneration";
import { renderChatImageStyleFidelityContract } from "@/lib/chatImageVisualIdentity";
import { syntheticLdDuoPlan } from "@/lib/chatImageVisualIdentity.fixtures";

const STYLE_MARKER = /STYLE FIDELITY — rendering technique must follow the supplied character identity reference images/;
const GENERIC_DEFAULT_GUARD = /not a generic stock illustration or default model look/;
const TEMPLATE_STYLE_GUARD = /Use subject identity references \(reference image 2 and onward\) as the authoritative art-style source/;

const DUO_SUBJECTS = [
  {
    key: "character",
    name: "태현",
    gender: "male" as const,
    role: "character",
    referenceImageUrl: "/c.webp",
    referenceIndex: 1,
    savedAppearance: "",
    appearanceMode: "image_only" as const,
    sourceKind: "main_character" as const,
  },
  {
    key: "persona",
    name: "유저",
    gender: "female" as const,
    role: "persona",
    referenceImageUrl: "/p.webp",
    referenceIndex: 2,
    savedAppearance: "",
    appearanceMode: "image_only" as const,
    sourceKind: "persona" as const,
  },
];

function comicPlan() {
  const source = buildSceneSourceMessages([
    { role: "assistant", content: "태현과 유저가 카페에서 대화한다." },
  ]);
  const plan = buildDeterministicScenePlan(source);
  return buildChatComicGenerationPlan({
    characterName: "태현",
    characterGender: "male",
    personaName: "유저",
    personaGender: "female",
    characterImageUrl: "/c.webp",
    characterSavedAppearance: "",
    characterAppearanceMode: "image_only",
    personaImageUrl: "/p.webp",
    personaSavedAppearance: "",
    personaAppearanceMode: "image_only",
    mood: "comic",
    plan,
    fullSourceDirectText: "태현과 유저가 카페에서 대화한다.",
  });
}

describe("chatImageStyleFidelity — canonical owner", () => {
  it("STYLE-OWNER-1 illustration primary includes style fidelity contract", () => {
    const { prompt } = syntheticLdDuoPlan();
    assert.match(prompt, STYLE_MARKER);
    assert.match(prompt, GENERIC_DEFAULT_GUARD);
    assert.doesNotMatch(prompt, /Match the drawing style, line quality/);
  });

  it("STYLE-OWNER-2 comic primary includes template-aware style fidelity contract", () => {
    const { prompt } = comicPlan();
    assert.match(prompt, STYLE_MARKER);
    assert.match(prompt, TEMPLATE_STYLE_GUARD);
    assert.doesNotMatch(prompt, /polished full-color rendering/);
  });

  it("STYLE-OWNER-3 LD strict fallback uses same style fidelity owner via visual identity", () => {
    const prompt = buildStrictLdDuoFallbackPrompt({
      characterName: "태현",
      characterGender: "male",
      personaName: "유저",
      personaGender: "female",
      subjects: DUO_SUBJECTS,
      sceneSourceText: "카페에서 대화한다.",
      adultGrounded: true,
    });
    assert.match(prompt, STYLE_MARKER);
    assert.doesNotMatch(prompt, /Match reference identity and art style/i);
  });

  it("STYLE-OWNER-4 comic strict fallback includes style fidelity contract", () => {
    const source = buildSceneSourceMessages([
      { role: "assistant", content: "태현과 유저가 카페에서 대화한다." },
    ]);
    const plan = buildDeterministicScenePlan(source);
    const prompt = buildStrictComicFallbackPrompt({
      panelCount: 4,
      characterName: "태현",
      characterGender: "male",
      personaName: "유저",
      personaGender: "female",
      subjects: DUO_SUBJECTS,
      compositionMode: "full_provider_rendered",
      plan,
    });
    assert.match(prompt, STYLE_MARKER);
    assert.match(prompt, TEMPLATE_STYLE_GUARD);
  });

  it("STYLE-OWNER-5 TR party strict fallback includes style fidelity contract", () => {
    const prompt = buildStrictLdPartyFallbackPrompt({
      cast: [
        {
          name: "태현",
          gender: "male",
          role: "player 1",
          referenceIndex: 1,
        },
        {
          name: "유저",
          gender: "female",
          role: "player 2",
          referenceIndex: 2,
        },
      ],
      subjects: DUO_SUBJECTS,
      sceneSourceText: "던전에서 전투한다.",
      adultGrounded: false,
    });
    assert.match(prompt, STYLE_MARKER);
  });

  it("STYLE-OWNER-6 TR party primary prompt includes style fidelity contract", () => {
    const prompt = buildChatLdIllustrationPrompt({
      characterName: "태현",
      characterGender: "male",
      personaName: "유저",
      personaGender: "female",
      currentTurn: "fallback",
      cast: [
        {
          name: "태현",
          gender: "male",
          role: "player 1",
          referenceIndex: 1,
        },
        {
          name: "유저",
          gender: "female",
          role: "player 2",
          referenceIndex: 2,
        },
      ],
      fullSource: "던전에서 전투한다.",
    });
    assert.match(prompt, STYLE_MARKER);
    assert.doesNotMatch(prompt, /Match the drawing style, line quality/);
  });

  it("STYLE-OWNER-7 route parity — LD duo and comic share style owner export", () => {
    const ldPrompt = buildLdDuoGenerationPlan({
      characterName: "태현",
      characterGender: "male",
      personaName: "유저",
      personaGender: "female",
      characterImageUrl: "/c.webp",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaImageUrl: "/p.webp",
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
      currentTurn: "카페",
    }).prompt;
    const comicPrompt = comicPlan().prompt;
    const canonical = renderChatImageStyleFidelityContract({
      hasTemplate: false,
      subjectCount: 2,
    });
    assert.ok(ldPrompt.includes(canonical.split("\n")[0] ?? ""));
    assert.match(comicPrompt, /reference image 2 and onward/);
  });
});
