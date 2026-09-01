import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_COMIC_FOUR_PANEL_OUTPUT_SIZE,
  CHAT_COMIC_IMAGE_OUTPUT_SIZE,
  CHAT_COMIC_MAX_INPUT_CHARS,
  CHAT_COMIC_TEMPLATE_PREVIEW_URL,
  buildChatComicImagePrompt,
  resolveChatComicOutputSize,
  resolveChatComicPrice,
  sanitizeChatComicOptions,
} from "./chatComicGeneration";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  scenePlanHasRawChatLeak,
} from "./chatImageScenePlan";
import { buildLdDuoGenerationPlan } from "./chatLdIllustrationGeneration";
import { renderChatImageVisualIdentity } from "./chatImageVisualIdentity";
import {
  SCENE_BUILDER_SHARED_DUO,
  SYNTHETIC_CHARACTER_A_APPEARANCE,
  syntheticComicPlan,
} from "./chatImageVisualIdentity.fixtures";

const SAMPLE_PLAN = buildDeterministicScenePlan(
  buildSceneSourceMessages([
    { id: 1, role: "user", content: '*후드 귀를 만진다*\n"같이 갈래?"' },
    {
      id: 2,
      role: "assistant",
      content: '렌이 후드를 만지자 태형이 고개를 돌렸다. "그래."',
    },
  ]),
  3
);

describe("chatComicGeneration", () => {
  it("keeps long source guard and default mood", () => {
    assert.equal(CHAT_COMIC_MAX_INPUT_CHARS, 4_000);
    assert.deepEqual(sanitizeChatComicOptions({ mood: "wrong" }), {
      mood: "comic",
    });
  });

  it("uses 2/3 standard size and promoted 4-panel size", () => {
    assert.equal(CHAT_COMIC_IMAGE_OUTPUT_SIZE, "1008x1408");
    assert.equal(CHAT_COMIC_FOUR_PANEL_OUTPUT_SIZE, "864x1824");
    assert.equal(resolveChatComicOutputSize(2), "1008x1408");
    assert.equal(resolveChatComicOutputSize(3), "1008x1408");
    assert.equal(resolveChatComicOutputSize(4), "864x1824");
  });

  it("charges 230P regardless of panel count", () => {
    assert.equal(resolveChatComicPrice(2, {} as NodeJS.ProcessEnv), 230);
    assert.equal(resolveChatComicPrice(3, {} as NodeJS.ProcessEnv), 230);
    assert.equal(resolveChatComicPrice(4, {} as NodeJS.ProcessEnv), 230);
    assert.equal(
      resolveChatComicPrice(3, { CHAT_COMIC_GENERATION_POINTS: "229.1" } as NodeJS.ProcessEnv),
      230
    );
  });

  it("builds the image prompt from an approved Scene Plan and canonical identity", () => {
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      mood: "lovely",
      plan: SAMPLE_PLAN,
    });
    assert.match(prompt, /COMIC PANEL SPEC/);
    assert.match(prompt, /\[Panel 1/);
    assert.match(prompt, /Hero focus:/);
    assert.match(prompt, /Speech bubble/);
    assert.match(prompt, /Continuity rules:/);
    assert.match(prompt, /STRICT CLOSED TEXT WHITELIST/);
    assert.match(prompt, /IDENTITY OWNERSHIP IS STRICT/);
    assert.match(prompt, /Silent panels with no speech are valid/);
    assert.match(prompt, /GENDER LOCK/);
    assert.match(prompt, /LAYOUT AND FINISH ONLY/);
    assert.doesNotMatch(prompt, /Original prose context/);
    assert.doesNotMatch(prompt, /SOURCE PROSE/);
    assert.doesNotMatch(prompt, /Preserve each person's hair color, eye color/);
    assert.equal(scenePlanHasRawChatLeak(prompt), false);
  });

  it("allows a silent approved plan with no invented dialogue", () => {
    const silent = buildDeterministicScenePlan(
      buildSceneSourceMessages([
        { id: 1, role: "user", content: "*문을 연다*" },
        { id: 2, role: "assistant", content: "태형이 조용히 따라 나선다." },
      ]),
      2
    );
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan: silent,
    });
    assert.match(prompt, /NO TEXT IS ALLOWED|No speech bubble/);
    assert.doesNotMatch(prompt, /최소 1개의 대사/);
  });

  it("uses the same canonical visual identity pipeline as LD duo", () => {
    const ld = buildLdDuoGenerationPlan({
      ...SCENE_BUILDER_SHARED_DUO,
      currentTurn: "unused",
      approvedScene: "Hero scene: shared identity pair.",
    });
    const comics = [2, 3, 4] as const;
    const comicPlans = comics.map((count) => syntheticComicPlan(count));

    const identityKey = (subject: (typeof ld.subjects)[number]) => ({
      key: subject.key,
      name: subject.name,
      appearanceMode: subject.appearanceMode,
      savedAppearance: subject.savedAppearance,
      referenceImageUrl: subject.referenceImageUrl,
    });
    const ldIdentity = ld.subjects.map(identityKey);

    for (const comic of comicPlans) {
      assert.deepEqual(comic.subjects.map(identityKey), ldIdentity);

      const characterHits = comic.referenceUrls.filter(
        (url) => url === SCENE_BUILDER_SHARED_DUO.characterImageUrl
      );
      const personaHits = comic.referenceUrls.filter(
        (url) => url === SCENE_BUILDER_SHARED_DUO.personaImageUrl
      );
      assert.equal(characterHits.length, 1, "COMIC_CHARACTER_REFERENCE_INCLUDED_EXACTLY_ONCE");
      assert.equal(personaHits.length, 1, "COMIC_PERSONA_REFERENCE_INCLUDED_EXACTLY_ONCE");
      assert.equal(comic.referenceUrls[0], CHAT_COMIC_TEMPLATE_PREVIEW_URL);
      assert.deepEqual(comic.referenceUrls.slice(1), ld.referenceUrls);

      const character = comic.subjects.find((subject) => subject.key === "character");
      const persona = comic.subjects.find((subject) => subject.key === "persona");
      assert.equal(character?.referenceIndex, 2);
      assert.equal(persona?.referenceIndex, 3);
      assert.equal(character?.savedAppearance, SYNTHETIC_CHARACTER_A_APPEARANCE);
      assert.equal(
        persona?.savedAppearance,
        SCENE_BUILDER_SHARED_DUO.personaSavedAppearance
      );

      const identity = renderChatImageVisualIdentity({
        subjects: comic.subjects,
        hasTemplate: true,
      });
      assert.equal(
        comic.prompt.includes(identity),
        true,
        "COMIC_USES_RENDER_CHAT_IMAGE_VISUAL_IDENTITY"
      );
      assert.equal(
        [...comic.prompt.matchAll(/SUBJECT IDENTITY MANIFEST/g)].length,
        1
      );
      assert.equal(
        [...comic.prompt.matchAll(/IDENTITY OWNERSHIP IS STRICT/g)].length,
        1
      );
      assert.doesNotMatch(comic.prompt, /Preserve each person's hair color/);
      assert.doesNotMatch(comic.prompt, /hair color, eye color, and outfit/);

      const blockA = subjectBlock(comic.prompt, "A");
      const blockB = subjectBlock(comic.prompt, "B");
      assert.match(blockA, /CharacterA/);
      assert.match(blockA, /Iris color: red/);
      assert.match(blockA, /Pupil color: black/);
      assert.match(blockA, /white shirt/);
      assert.match(blockA, /black harness/);
      assert.doesNotMatch(blockA, /Iris color: black/);
      assert.doesNotMatch(blockA, /Pupil color: red/);
      assert.doesNotMatch(blockA, /Pupil shape: vertical slit/);
      assert.doesNotMatch(blockA, /UserPersona/);

      assert.match(blockB, /UserPersona/);
      assert.match(blockB, /Iris color: black/);
      assert.match(blockB, /Pupil color: red/);
      assert.match(blockB, /Pupil shape: vertical slit/);
      assert.match(blockB, /짧은 검은머리/);
      assert.match(blockB, /가죽재질 전투 하네스/);
      assert.doesNotMatch(blockB, /Iris color: red/);
      assert.doesNotMatch(blockB, /Pupil color: black/);
      assert.doesNotMatch(blockB, /white shirt, black harness/);
      assert.doesNotMatch(blockB, /CharacterA/);
    }

    const [two, three, four] = comicPlans;
    assert.ok(two && three && four);
    assert.deepEqual(two.subjects, three.subjects);
    assert.deepEqual(three.subjects, four.subjects);
    assert.deepEqual(two.referenceUrls, four.referenceUrls);
    assert.match(two.prompt, /exactly 2 wide horizontal panels/);
    assert.match(three.prompt, /exactly 3 wide horizontal panels/);
    assert.match(four.prompt, /exactly 4 wide horizontal panels/);
  });
});

function subjectBlock(prompt: string, letter: string): string {
  const start = prompt.indexOf(`[SUBJECT ${letter}`);
  assert.ok(start >= 0, `missing SUBJECT ${letter}`);
  const next = prompt.indexOf("[SUBJECT ", start + 1);
  const contract = prompt.indexOf("IDENTITY OWNERSHIP IS STRICT", start);
  const end = Math.min(
    next === -1 ? prompt.length : next,
    contract === -1 ? prompt.length : contract
  );
  return prompt.slice(start, end);
}
