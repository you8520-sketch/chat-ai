import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCastCandidatePool,
  draftCastIntentFromCandidatePool,
  resolveCastCompositionGoal,
} from "@/lib/chatImageCast";
import {
  groundCastIntent,
  type GroundCastContext,
} from "@/lib/chatImageCastManifest";
import { buildChatComicGenerationPlan } from "@/lib/chatComicGeneration";
import { buildLdSceneGenerationPlan } from "@/lib/chatLdIllustrationGeneration";
import { buildScenePlanPrompt } from "@/lib/chatImageScenePlan";
import { buildDeterministicScenePlan, buildSceneSourceMessages } from "@/lib/chatImageScenePlan";

const SIM_TITLE = "이미지 테스트";
const PERSONA = "렌";
const MEMBER_A = "이현";
const MEMBER_B = "태형";
const MEMBER_C = "강우";
const MEMBER_D = "민준";

const PERSONA_URL = "/synthetic/persona-ren.webp";
const MEMBER_A_URL = "/synthetic/member-a.webp";
const MEMBER_B_URL = "/synthetic/member-b.webp";

const SIM_GROUND_CTX: GroundCastContext = {
  persona: {
    name: PERSONA,
    gender: "male",
    referenceImageUrl: PERSONA_URL,
    savedAppearance: "short black hair",
    appearanceMode: "image_plus_saved",
  },
  mainCharacter: {
    name: SIM_TITLE,
    gender: "other",
    referenceImageUrl: "/synthetic/sim-container.webp",
    savedAppearance: "container only",
    appearanceMode: "image_only",
  },
  selectableAssets: [
    { url: MEMBER_A_URL, tag: MEMBER_A },
    { url: MEMBER_B_URL, tag: MEMBER_B },
  ],
};

function simulationDraft() {
  return draftCastIntentFromCandidatePool({
    contentKind: "simulation",
    personaName: PERSONA,
    mainCharacterName: SIM_TITLE,
    configuredCharacterSetNames: [MEMBER_A, MEMBER_B, MEMBER_C, MEMBER_D],
    events: [{ text: `${MEMBER_A}가 말했다`, sourceRole: "assistant" }],
  });
}

function withSelection(
  draft: ReturnType<typeof draftCastIntentFromCandidatePool>,
  includedNames: string[],
  personaIncluded = false
) {
  return {
    ...draft,
    subjects: draft.subjects.map((subject) => {
      if (subject.role === "persona") {
        return { ...subject, included: personaIncluded };
      }
      return {
        ...subject,
        included: includedNames.includes(subject.name),
        requestedReferenceAssetUrl:
          subject.name === MEMBER_A
            ? MEMBER_A_URL
            : subject.name === MEMBER_B
              ? MEMBER_B_URL
              : undefined,
      };
    }),
  };
}

function groundSimulation(includedNames: string[], personaIncluded = false) {
  const draft = withSelection(simulationDraft(), includedNames, personaIncluded);
  const grounded = groundCastIntent(draft, SIM_GROUND_CTX, undefined, "simulation");
  assert.equal(grounded.ok, true, grounded.ok ? "" : grounded.reason);
  return grounded.manifest;
}

describe("simulation cast client draft", () => {
  it("excludes simulation title from candidate pool", () => {
    const pool = buildCastCandidatePool({
      contentKind: "simulation",
      personaName: PERSONA,
      mainCharacterName: SIM_TITLE,
      configuredCharacterSetNames: [MEMBER_A, MEMBER_B, MEMBER_C, MEMBER_D],
    });
    const names = pool.map((item) => item.name);
    assert.deepEqual(names, [MEMBER_A, MEMBER_B, MEMBER_C, MEMBER_D]);
    assert.equal(names.includes(SIM_TITLE), false);
  });

  it("draft has persona + members without main_character", () => {
    const draft = simulationDraft();
    assert.equal(
      draft.subjects.some((subject) => subject.role === "main_character"),
      false
    );
    assert.equal(
      draft.subjects.some((subject) => subject.name === SIM_TITLE),
      false
    );
    assert.equal(draft.subjects.some((subject) => subject.role === "persona"), true);
  });
});

describe("simulation cast server validation", () => {
  for (const count of [1, 2, 3, 4] as const) {
    it(`S${count}: accepts ${count} selected simulation members`, () => {
      const names = [MEMBER_A, MEMBER_B, MEMBER_C, MEMBER_D].slice(0, count);
      const manifest = groundSimulation(names);
      assert.equal(manifest.subjects.filter((subject) => subject.included).length, count);
    });
  }

  it("S5: rejects 5 selected", () => {
    const draft = withSelection(simulationDraft(), [MEMBER_A, MEMBER_B, MEMBER_C, MEMBER_D, PERSONA], true);
    const grounded = groundCastIntent(draft, SIM_GROUND_CTX, undefined, "simulation");
    assert.equal(grounded.ok, false);
    if (!grounded.ok) assert.match(grounded.reason, /최대 4명/);
  });

  it("S6: rejects 0 selected", () => {
    const draft = withSelection(simulationDraft(), [], false);
    const grounded = groundCastIntent(draft, SIM_GROUND_CTX, undefined, "simulation");
    assert.equal(grounded.ok, false);
    if (!grounded.ok) assert.match(grounded.reason, /최소 1명/);
  });

  it("S7: rejects main_character in simulation payload", () => {
    const draft = simulationDraft();
    draft.subjects.push({
      key: "main_character",
      role: "main_character",
      name: SIM_TITLE,
      included: true,
      importance: "primary",
      visibility: "required_visible",
    });
    const grounded = groundCastIntent(draft, SIM_GROUND_CTX, undefined, "simulation");
    assert.equal(grounded.ok, false);
  });

  it("S8: character chat still requires main", () => {
    const draft = draftCastIntentFromCandidatePool({
      contentKind: "character",
      personaName: "User",
      mainCharacterName: "Hero",
      configuredCharacterSetNames: [],
    });
    draft.subjects = draft.subjects.filter((subject) => subject.role !== "main_character");
    const grounded = groundCastIntent(draft, SIM_GROUND_CTX, undefined, "character");
    assert.equal(grounded.ok, false);
  });
});

describe("simulation LD/comic prompts", () => {
  it("1 selected: title never appears as identity; exactly 1 person", () => {
    const manifest = groundSimulation([MEMBER_A]);
    const plan = buildLdSceneGenerationPlan({
      characterName: SIM_TITLE,
      characterGender: "other",
      personaName: PERSONA,
      personaGender: "male",
      characterImageUrl: "/synthetic/sim-container.webp",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaImageUrl: PERSONA_URL,
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
      castManifest: manifest,
      contentKind: "simulation",
    });
    assert.doesNotMatch(plan.prompt, new RegExp(SIM_TITLE));
    assert.match(plan.prompt, /Exactly 1 recurring identity/);
    assert.doesNotMatch(plan.prompt, /two people/i);
    assert.equal(plan.referenceUrls.includes("/synthetic/sim-container.webp"), false);
    assert.deepEqual(plan.referenceUrls, [MEMBER_A_URL]);
  });

  it("2 selected: exactly 2, no duo title fallback", () => {
    const manifest = groundSimulation([MEMBER_A, MEMBER_B]);
    const plan = buildLdSceneGenerationPlan({
      characterName: SIM_TITLE,
      characterGender: "other",
      personaName: PERSONA,
      personaGender: "male",
      characterImageUrl: "/synthetic/sim-container.webp",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaImageUrl: PERSONA_URL,
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
      castManifest: manifest,
      contentKind: "simulation",
    });
    assert.doesNotMatch(plan.prompt, new RegExp(SIM_TITLE));
    assert.match(plan.prompt, /Exactly 2 recurring identities/);
    assert.match(plan.prompt, /Show exactly these 2 people/);
  });

  it("comic 1 selected avoids Exactly two recurring human characters", () => {
    const manifest = groundSimulation([MEMBER_A]);
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: `${MEMBER_A}가 웃었다.` },
    ]);
    const scenePlan = buildDeterministicScenePlan(messages, 2);
    const comic = buildChatComicGenerationPlan({
      characterName: SIM_TITLE,
      characterGender: "other",
      personaName: PERSONA,
      personaGender: "male",
      characterImageUrl: "/synthetic/sim-container.webp",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaImageUrl: PERSONA_URL,
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
      plan: scenePlan,
      castManifest: manifest,
      contentKind: "simulation",
    });
    assert.doesNotMatch(comic.prompt, /Exactly two recurring human characters/);
    assert.match(comic.prompt, /Exactly 1 recurring human identity/);
  });
});

describe("simulation scene planner prompt", () => {
  it("uses simulation title metadata, not Chat character name", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: `${MEMBER_A}가 인사했다.` },
    ]);
    const prompt = buildScenePlanPrompt({
      contentKind: "simulation",
      characterName: SIM_TITLE,
      personaName: PERSONA,
      messages,
    });
    assert.doesNotMatch(prompt, new RegExp(`Chat character name: ${SIM_TITLE}`));
    assert.match(prompt, new RegExp(`Simulation title \\(NOT A PERSON\\): ${SIM_TITLE}`));
  });
});

describe("headcount composition owner", () => {
  it("derives solo/duo/trio/ensemble from selected count only", () => {
    const base = simulationDraft();
    assert.equal(
      resolveCastCompositionGoal(withSelection(base, [MEMBER_A])),
      "solo"
    );
    assert.equal(
      resolveCastCompositionGoal(withSelection(base, [MEMBER_A, MEMBER_B])),
      "duo_focus"
    );
    assert.equal(
      resolveCastCompositionGoal(withSelection(base, [MEMBER_A, MEMBER_B, MEMBER_C])),
      "trio_group"
    );
    assert.equal(
      resolveCastCompositionGoal(
        withSelection(base, [MEMBER_A, MEMBER_B, MEMBER_C, MEMBER_D])
      ),
      "ensemble_scene"
    );
  });
});
