import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCastCandidatePool,
  draftCastIntentFromCandidatePool,
  parseCastIntentManifest,
  resolveCastCompositionGoal,
  resolveChatImageSceneBuilderReadiness,
  selectedCastIntentSubjects,
} from "@/lib/chatImageCast";
import {
  groundCastIntent,
  parseChatImageCastManifest,
  type GroundCastContext,
} from "@/lib/chatImageCastManifest";
import { buildChatComicGenerationPlan } from "@/lib/chatComicGeneration";
import { buildLdSceneGenerationPlan } from "@/lib/chatLdIllustrationGeneration";
import {
  buildDeterministicScenePlan,
  buildScenePlanPrompt,
  buildSceneSourceMessages,
  formatApprovedScenePlanForComic,
  formatApprovedScenePlanForIllustration,
  resolveScenePresentationVisibility,
  type ScenePlan,
} from "@/lib/chatImageScenePlan";

const SIM_TITLE = "이미지 테스트";
const PERSONA = "나";
const MEMBER_A = "이현";
const MEMBER_B = "태형";
const MEMBER_C = "강우";
const MEMBER_D = "민준";

const PERSONA_URL = "/synthetic/persona-self.webp";
const MEMBER_A_URL = "/synthetic/member-a.webp";
const MEMBER_B_URL = "/synthetic/member-b.webp";
const MEMBER_C_URL = "/synthetic/member-c.webp";

const SIM_GROUND_CTX: GroundCastContext = {
  persona: {
    name: PERSONA,
    gender: "female",
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
    { url: MEMBER_C_URL, tag: MEMBER_C },
  ],
};

const USER_PERSONA_TEXT = "나는 문 앞에서 세 사람을 바라본다.";

const REAL_CHAT_MESSAGES = buildSceneSourceMessages([
  {
    id: 1,
    role: "user",
    content: USER_PERSONA_TEXT,
  },
  {
    id: 2,
    role: "assistant",
    content: "이현이 태형과 강우를 향해 손을 들었다.",
  },
]);

const CHARACTER_DIALOGUE_MESSAGES = buildSceneSourceMessages([
  { id: 1, role: "user", content: '"여기서 기다릴게."' },
  { id: 2, role: "assistant", content: "*미소 지으며 고개를 끄덕인다.*" },
]);

function deepClonePlan(plan: ScenePlan): ScenePlan {
  return JSON.parse(JSON.stringify(plan));
}

function visibleDirectiveLines(formatted: string): string {
  const offCameraStart = formatted.search(/OFF-CAMERA CONTEXT ONLY|Off-camera context only/i);
  const visiblePart = offCameraStart >= 0 ? formatted.slice(0, offCameraStart) : formatted;
  return visiblePart;
}

function simulationDraft() {
  return draftCastIntentFromCandidatePool({
    contentKind: "simulation",
    personaName: PERSONA,
    mainCharacterName: SIM_TITLE,
    configuredCharacterSetNames: [MEMBER_A, MEMBER_B, MEMBER_C, MEMBER_D],
    events: REAL_CHAT_MESSAGES.map((message) => ({
      text: message.text,
      sourceRole: message.role,
    })),
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
              : subject.name === MEMBER_C
                ? MEMBER_C_URL
                : undefined,
      };
    }),
  };
}

function wireParseSimulation(
  includedNames: string[],
  personaIncluded = false
) {
  const intent = withSelection(simulationDraft(), includedNames, personaIncluded);
  const raw = JSON.parse(JSON.stringify(intent));
  return parseChatImageCastManifest(raw, "simulation");
}

function groundWireSimulation(
  includedNames: string[],
  personaIncluded = false,
  scenePlan = buildDeterministicScenePlan(REAL_CHAT_MESSAGES, 2)
) {
  const parsed = wireParseSimulation(includedNames, personaIncluded);
  assert.ok(parsed);
  const grounded = groundCastIntent(parsed!, SIM_GROUND_CTX, scenePlan, "simulation");
  return grounded;
}

function ldPlanFromGrounded(
  manifest: NonNullable<ReturnType<typeof groundWireSimulation>["manifest"]>,
  scenePlan = buildDeterministicScenePlan(REAL_CHAT_MESSAGES, 2)
) {
  return buildLdSceneGenerationPlan({
    characterName: SIM_TITLE,
    characterGender: "other",
    personaName: PERSONA,
    personaGender: "female",
    characterImageUrl: "",
    characterSavedAppearance: "",
    characterAppearanceMode: "image_only",
    personaImageUrl: "",
    personaSavedAppearance: "",
    personaAppearanceMode: "image_only",
    approvedScenePlan: scenePlan,
    castManifest: manifest,
    contentKind: "simulation",
  });
}

function comicPlanFromGrounded(
  manifest: NonNullable<ReturnType<typeof groundWireSimulation>["manifest"]>,
  scenePlan = buildDeterministicScenePlan(REAL_CHAT_MESSAGES, 2)
) {
  return buildChatComicGenerationPlan({
    characterName: SIM_TITLE,
    characterGender: "other",
    personaName: PERSONA,
    personaGender: "female",
    characterImageUrl: "",
    characterSavedAppearance: "",
    characterAppearanceMode: "image_only",
    personaImageUrl: "",
    personaSavedAppearance: "",
    personaAppearanceMode: "image_only",
    plan: scenePlan,
    castManifest: manifest,
    contentKind: "simulation",
  });
}

describe("simulation cast wire parser", () => {
  it("A: preserves persona included=false through serialized wire parse", () => {
    const parsed = wireParseSimulation([MEMBER_A, MEMBER_B, MEMBER_C], false);
    assert.ok(parsed);
    const persona = parsed!.subjects.find((subject) => subject.role === "persona");
    assert.equal(persona?.included, false);
    assert.equal(selectedCastIntentSubjects(parsed!).length, 3);
    assert.equal(
      parsed!.subjects.some((subject) => subject.role === "main_character"),
      false
    );
  });

  it("F: character wire parse keeps persona/main mandatory", () => {
    const intent = draftCastIntentFromCandidatePool({
      contentKind: "character",
      personaName: "User",
      mainCharacterName: "Hero",
    });
    intent.subjects = intent.subjects.map((subject) => ({
      ...subject,
      included: false,
    }));
    const raw = JSON.parse(JSON.stringify(intent));
    const parsed = parseChatImageCastManifest(raw, "character");
    assert.ok(parsed);
    const persona = parsed!.subjects.find((subject) => subject.role === "persona");
    const main = parsed!.subjects.find((subject) => subject.role === "main_character");
    assert.equal(persona?.included, true);
    assert.equal(main?.included, true);
  });
});

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
});

describe("simulation real chat source grounding", () => {
  it("B: user+assistant source with persona=false grounds exactly 3 NPCs and no persona binding", () => {
    const grounded = groundWireSimulation([MEMBER_A, MEMBER_B, MEMBER_C], false);
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);
    const included = grounded.manifest.subjects.filter((subject) => subject.included);
    assert.equal(included.length, 3);
    assert.equal(
      grounded.manifest.eventSubjectBindings.filter((binding) => binding.subjectKey === "persona")
        .length,
      0
    );
    assert.equal(
      grounded.manifest.eventSubjectBindings.some((binding) =>
        binding.subjectKey.includes(SIM_TITLE)
      ),
      false
    );
  });

  it("E: persona=true keeps persona binding and selected count=3", () => {
    const grounded = groundWireSimulation([MEMBER_A, MEMBER_B], true);
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);
    assert.equal(
      grounded.manifest.subjects.filter((subject) => subject.included).length,
      3
    );
    assert.ok(
      grounded.manifest.eventSubjectBindings.some((binding) => binding.subjectKey === "persona")
    );
  });
});

describe("simulation LD/comic prompts with persona excluded", () => {
  it("C/D: 3 NPC only — no visible persona, no title identity, no persona bubble/action", () => {
    const grounded = groundWireSimulation([MEMBER_A, MEMBER_B, MEMBER_C], false);
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);
    const scenePlan = buildDeterministicScenePlan(REAL_CHAT_MESSAGES, 2);
    const ld = ldPlanFromGrounded(grounded.manifest, scenePlan);
    const comic = comicPlanFromGrounded(grounded.manifest, scenePlan);

    assert.match(ld.prompt, /Exactly 3 recurring identities/);
    assert.doesNotMatch(ld.prompt, new RegExp(SIM_TITLE));
    assert.doesNotMatch(ld.prompt, /Persona action:/i);
    assert.match(ld.prompt, /Off-camera context only/);
    assert.doesNotMatch(comic.prompt, /Exactly two recurring human characters/);
    assert.match(comic.prompt, /Exactly 3 recurring human identities/);
    assert.doesNotMatch(comic.prompt, /Persona action:/i);
    assert.doesNotMatch(comic.prompt, /persona: “/i);
    assert.doesNotMatch(comic.prompt, new RegExp(SIM_TITLE));
    assert.deepEqual(ld.referenceUrls.sort(), [MEMBER_A_URL, MEMBER_B_URL, MEMBER_C_URL].sort());
    assert.equal(scenePlan.events.length >= 2, true);
  });
});

describe("simulation scene planner prompt", () => {
  it("uses simulation title metadata, not Chat character name", () => {
    const prompt = buildScenePlanPrompt({
      contentKind: "simulation",
      characterName: SIM_TITLE,
      personaName: PERSONA,
      messages: REAL_CHAT_MESSAGES,
    });
    assert.doesNotMatch(prompt, new RegExp(`Chat character name: ${SIM_TITLE}`));
    assert.match(prompt, new RegExp(`Simulation title \\(NOT A PERSON\\): ${SIM_TITLE}`));
  });
});

describe("simulation readiness", () => {
  it("G: simulation does not require container image globally", () => {
    const result = resolveChatImageSceneBuilderReadiness({
      contentKind: "simulation",
      characterImageUrl: "",
      hasPersona: true,
      personaImageUrl: "",
    });
    assert.equal(result.ready, true);
    assert.deepEqual(result.missing, []);
  });

  it("H: offscreen persona image is not a global gate when persona excluded", () => {
    const result = resolveChatImageSceneBuilderReadiness({
      contentKind: "simulation",
      characterImageUrl: "",
      hasPersona: true,
      personaImageUrl: "",
    });
    assert.equal(result.missing.includes("페르소나 대표 이미지"), false);
    assert.equal(result.missing.includes("캐릭터 대표 이미지"), false);
  });

  it("character mode keeps image prerequisites", () => {
    const result = resolveChatImageSceneBuilderReadiness({
      contentKind: "character",
      characterImageUrl: "",
      hasPersona: true,
      personaImageUrl: "",
    });
    assert.equal(result.ready, false);
    assert.ok(result.missing.includes("캐릭터 대표 이미지"));
    assert.ok(result.missing.includes("페르소나 대표 이미지"));
  });
});

describe("headcount composition owner", () => {
  it("derives solo/duo/trio/ensemble from selected count only", () => {
    const base = simulationDraft();
    assert.equal(resolveCastCompositionGoal(withSelection(base, [MEMBER_A])), "solo");
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

describe("simulation presentation projection regressions", () => {
  it("J: persona-only panel — comic must not leak excluded persona situation/background", () => {
    const scenePlan = buildDeterministicScenePlan(REAL_CHAT_MESSAGES, 2);
    const grounded = groundWireSimulation([MEMBER_A, MEMBER_B, MEMBER_C], false, scenePlan);
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);
    const visibility = resolveScenePresentationVisibility({
      contentKind: "simulation",
      castManifest: grounded.manifest,
    });
    assert.equal(visibility.personaVisible, false);
    assert.ok(scenePlan.sceneBackground.includes(USER_PERSONA_TEXT));

    const comic = formatApprovedScenePlanForComic(scenePlan, visibility);
    const visible = visibleDirectiveLines(comic);
    assert.doesNotMatch(visible, new RegExp(`Situation: ${USER_PERSONA_TEXT}`));
    assert.doesNotMatch(visible, new RegExp(`Background:.*${USER_PERSONA_TEXT}`));
    assert.doesNotMatch(visible, /Persona action:/i);
    assert.doesNotMatch(visible, /persona: “/i);
    assert.match(comic, /OFF-CAMERA CONTEXT ONLY/);
    assert.match(comic, new RegExp(USER_PERSONA_TEXT));
    assert.match(comic, /VISIBLE CAST IS AUTHORITATIVE/);

    const ld = ldPlanFromGrounded(grounded.manifest, scenePlan);
    assert.match(ld.prompt, /Exactly 3 recurring identities/);
    const ldVisible = visibleDirectiveLines(ld.prompt.split("APPROVED SCENE PLAN")[1] ?? "");
    assert.doesNotMatch(ldVisible, new RegExp(`Background:.*${USER_PERSONA_TEXT}`));
  });

  it("K: projected background removes user text from visible directives but keeps off-camera block", () => {
    const scenePlan = buildDeterministicScenePlan(REAL_CHAT_MESSAGES, 2);
    assert.ok(scenePlan.sceneBackground.includes(USER_PERSONA_TEXT));
    const visibility = resolveScenePresentationVisibility({
      contentKind: "simulation",
      castManifest: { subjects: [{ role: "persona", included: false }] },
    });
    const illustration = formatApprovedScenePlanForIllustration(scenePlan, visibility);
    const comic = formatApprovedScenePlanForComic(scenePlan, visibility);
    const illustrationVisible = visibleDirectiveLines(illustration);
    const comicVisible = visibleDirectiveLines(comic);
    assert.doesNotMatch(illustrationVisible, new RegExp(`Background:.*${USER_PERSONA_TEXT}`));
    assert.doesNotMatch(comicVisible, new RegExp(`Shared background:.*${USER_PERSONA_TEXT}`));
    assert.match(illustration, new RegExp(USER_PERSONA_TEXT));
    assert.match(comic, new RegExp(USER_PERSONA_TEXT));
  });

  it("L: character mode keeps persona dialogue in Key dialogue", () => {
    const scenePlan = buildDeterministicScenePlan(CHARACTER_DIALOGUE_MESSAGES, 2);
    const illustration = formatApprovedScenePlanForIllustration(scenePlan);
    assert.match(illustration, /Key dialogue/);
    assert.match(illustration, /여기서 기다릴게/);
    assert.match(illustration, /persona:/);
    assert.doesNotMatch(illustration, /VISIBLE CAST IS AUTHORITATIVE/);

    const ld = buildLdSceneGenerationPlan({
      characterName: "Hero",
      characterGender: "male",
      personaName: "User",
      personaGender: "female",
      characterImageUrl: "/synthetic/hero.webp",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaImageUrl: "/synthetic/user.webp",
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
      approvedScenePlan: scenePlan,
      contentKind: "character",
    });
    assert.match(ld.prompt, /여기서 기다릴게/);
  });

  it("M: simulation persona included keeps persona dialogue and does not over-project background", () => {
    const scenePlan = buildDeterministicScenePlan(REAL_CHAT_MESSAGES, 2);
    const grounded = groundWireSimulation([MEMBER_A, MEMBER_B], true, scenePlan);
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);
    const visibility = resolveScenePresentationVisibility({
      contentKind: "simulation",
      castManifest: grounded.manifest,
    });
    assert.equal(visibility.personaVisible, true);
    const illustration = formatApprovedScenePlanForIllustration(scenePlan, visibility);
    const comic = formatApprovedScenePlanForComic(scenePlan, visibility);
    assert.doesNotMatch(illustration, /VISIBLE CAST IS AUTHORITATIVE/);
    assert.doesNotMatch(comic, /OFF-CAMERA CONTEXT ONLY/);
    assert.match(illustration, new RegExp(USER_PERSONA_TEXT));
    assert.match(comic, new RegExp(USER_PERSONA_TEXT));

    const ld = ldPlanFromGrounded(grounded.manifest, scenePlan);
    assert.match(ld.prompt, /Exactly 3 recurring identities/);
  });

  it("N: formatting does not mutate canonical ScenePlan events", () => {
    const scenePlan = buildDeterministicScenePlan(REAL_CHAT_MESSAGES, 2);
    const before = deepClonePlan(scenePlan);
    const visibility = resolveScenePresentationVisibility({
      contentKind: "simulation",
      castManifest: { subjects: [{ role: "persona", included: false }] },
    });
    formatApprovedScenePlanForIllustration(scenePlan, visibility);
    formatApprovedScenePlanForComic(scenePlan, visibility);
    assert.deepEqual(scenePlan.events, before.events);
    assert.deepEqual(
      scenePlan.panels.map((panel) => panel.sourceEventIds),
      before.panels.map((panel) => panel.sourceEventIds)
    );
    assert.deepEqual(scenePlan.sceneBackground, before.sceneBackground);
  });
});

describe("simulation UI labels", () => {
  it("I: secondary importance label is 일반 for simulation picker options", async () => {
    const source = await import("@/components/ChatImageCastPicker.tsx");
    assert.equal(typeof source.default, "function");
    const file = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/components/ChatImageCastPicker.tsx", "utf8")
    );
    assert.match(file, /SIMULATION_IMPORTANCE[\s\S]*secondary.*일반/);
    assert.doesNotMatch(file, /SIMULATION_IMPORTANCE[\s\S]*secondary.*조연/);
  });
});
