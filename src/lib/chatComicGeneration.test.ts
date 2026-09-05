import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_COMIC_FOUR_PANEL_OUTPUT_SIZE,
  CHAT_COMIC_IMAGE_OUTPUT_SIZE,
  CHAT_COMIC_MAX_INPUT_CHARS,
  CHAT_COMIC_TEMPLATE_PREVIEW_URL,
  assembleComicFinalImage,
  auditProviderPromptFullComic,
  auditProviderPromptDialogueLeak,
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

  it("charges 180P regardless of panel count", () => {
    assert.equal(resolveChatComicPrice(2, {} as NodeJS.ProcessEnv), 180);
    assert.equal(resolveChatComicPrice(3, {} as NodeJS.ProcessEnv), 180);
    assert.equal(resolveChatComicPrice(4, {} as NodeJS.ProcessEnv), 180);
    assert.equal(
      resolveChatComicPrice(3, { CHAT_COMIC_GENERATION_POINTS: "229.1" } as NodeJS.ProcessEnv),
      180
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
    assert.match(prompt, /COMIC PANEL SPEC — FULL PROVIDER-RENDERED MANHWA PAGE/);
    assert.match(prompt, /\[Panel 1/);
    assert.match(prompt, /Hero focus:/);
    assert.match(prompt, /RENDER THE COMPLETE MANHWA PAGE WITH READABLE KOREAN TEXT/);
    assert.match(prompt, /Continuity rules:/);
    assert.doesNotMatch(prompt, /VISUAL LAYER ONLY/);
    assert.doesNotMatch(prompt, /server overlay/i);
    assert.match(prompt, /Speech bubble \(/);
    assert.match(prompt, /IDENTITY OWNERSHIP IS STRICT/);
    assert.doesNotMatch(prompt, /STRICT CLOSED TEXT WHITELIST/);
    assert.match(prompt, /GENDER LOCK/);
    assert.match(prompt, /LAYOUT AND FINISH ONLY/);
    assert.doesNotMatch(prompt, /Original prose context/);
    assert.doesNotMatch(prompt, /SOURCE PROSE/);
    assert.doesNotMatch(prompt, /Preserve each person's hair color, eye color/);
    assert.equal(scenePlanHasRawChatLeak(prompt), false);
    const audit = auditProviderPromptFullComic({ prompt, plan: SAMPLE_PLAN });
    assert.equal(audit.readableContractPresent, true);
    assert.equal(audit.rawChatLeak, false);
    assert.equal(audit.missingDialogueCount, 0, "all approved dialogue present");
    assert.ok(audit.presentDialogueCount >= 1);
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
    assert.match(prompt, /RENDER THE COMPLETE MANHWA PAGE WITH READABLE KOREAN TEXT/);
    assert.doesNotMatch(prompt, /Speech bubble \(/);
    assert.doesNotMatch(prompt, /STRICT CLOSED TEXT WHITELIST/);
    const audit = auditProviderPromptFullComic({ prompt, plan: silent });
    assert.equal(audit.expectedDialogueCount, 0);
    assert.equal(audit.missingDialogueCount, 0);
  });

  it("gives the provider comic-director ownership in blank-balloon mode without dialogue text", () => {
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan: SAMPLE_PLAN,
      compositionMode: "blank_balloon_hybrid",
    });
    assert.match(prompt, /GPT IS COMIC DIRECTOR/);
    assert.match(prompt, /blank speech balloons/i);
    assert.match(prompt, /tails must naturally point/i);
    assert.match(prompt, /Render no readable letters/i);
    assert.doesNotMatch(prompt, /Speech bubble \(/);
    assert.doesNotMatch(prompt, /같이 갈래/);
    assert.doesNotMatch(prompt, /반가워/);
  });

  it("NORMAL-1 default primary prompt is byte-identical to explicit full_provider_rendered", () => {
    const base = {
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan: SAMPLE_PLAN,
    };
    const byDefault = buildChatComicImagePrompt(base);
    const explicit = buildChatComicImagePrompt({ ...base, compositionMode: "full_provider_rendered" });
    assert.equal(byDefault, explicit);
    assert.match(byDefault, /RENDER THE COMPLETE MANHWA PAGE WITH READABLE KOREAN TEXT/);
    assert.doesNotMatch(byDefault, /VISUAL LAYER ONLY/);
    assert.doesNotMatch(byDefault, /blank speech balloons/i);
    assert.doesNotMatch(byDefault, /server overlay/i);
  });

  it("DIALOGUE-1 safe dialogue keeps a balloon directive with zero readable provider text", () => {
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan: SAMPLE_PLAN,
      compositionMode: "blank_balloon_hybrid",
    });
    assert.match(prompt, /Dialogue slot 1:/);
    assert.doesNotMatch(prompt, /같이 갈래/);
    assert.doesNotMatch(prompt, /그래\./);
    assert.doesNotMatch(prompt, /Speech bubble \(/);
    assert.equal(auditProviderPromptDialogueLeak({ prompt, plan: SAMPLE_PLAN }).leakedTexts.length, 0);
  });

  function riskyHybridPlan() {
    return {
      sceneBackground: "침실",
      events: [],
      heroEventIds: [],
      heroScene: "침실 대화",
      recommendedPanelCount: 2 as const,
      panels: [
        {
          index: 1,
          sourceEventIds: [],
          situation: "대화",
          dialogue: [{ speaker: "character" as const, text: "오늘은 쉬자.", provenance: "user_edit" as const }],
        },
        {
          index: 2,
          sourceEventIds: [],
          situation: "대화",
          dialogue: [
            { speaker: "character" as const, text: "성관계를 하고 싶어.", provenance: "user_edit" as const },
            { speaker: "persona" as const, text: "조용히 안아줘.", provenance: "user_edit" as const },
          ],
        },
      ],
    };
  }

  it("DIALOGUE-2 adult-grounded dialogue keeps balloon directive, zero raw provider text", () => {
    const plan = riskyHybridPlan();
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan,
      compositionMode: "blank_balloon_hybrid",
    });
    assert.match(prompt, /Dialogue slot 1:/);
    assert.doesNotMatch(prompt, /성관계/);
    assert.doesNotMatch(prompt, /하고 싶어/);
    assert.doesNotMatch(prompt, /안아줘/);
    const audit = auditProviderPromptDialogueLeak({ prompt, plan });
    assert.equal(audit.leakedTexts.length, 0);
    assert.equal(audit.canonicalDialogueOccurrenceCount, 0);
    assert.equal(audit.userEditOccurrenceCount, 0);
  });

  it("DIALOGUE-3 safe + provider-omitted lines both keep structural balloon directives", () => {
    const plan = riskyHybridPlan();
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan,
      compositionMode: "blank_balloon_hybrid",
    });
    const blocks = prompt.split("[Panel ");
    const panel2Block = blocks[2] ?? "";
    const slots = panel2Block.match(/Dialogue slot \d+/g) ?? [];
    assert.equal(slots.length, 2, "both dialogue rows keep a balloon directive");
    assert.doesNotMatch(panel2Block, /성관계/);
  });

  it("DIALOGUE-4 provider prompt audit reports zero raw risky dialogue leak", () => {
    const plan = riskyHybridPlan();
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan,
      compositionMode: "blank_balloon_hybrid",
    });
    const audit = auditProviderPromptDialogueLeak({ prompt, plan });
    assert.equal(audit.speechBubbleDirectiveCount, 0);
    assert.equal(audit.canonicalDialogueOccurrenceCount, 0);
    assert.equal(audit.userEditOccurrenceCount, 0);
    assert.deepEqual(audit.leakedTexts, []);
    assert.doesNotMatch(prompt, /성관계|손목|자해/);
  });

  it("FULL-1 provider prompt includes the readable Korean narration contract when needed", () => {
    const narrationPlan = buildDeterministicScenePlan(
      buildSceneSourceMessages([
        { id: 1, role: "user", content: "*밤이 깊어졌다*\n\"조용히 있자.\"" },
        { id: 2, role: "assistant", content: "*렌이 창밖을 바라본다*" },
      ]),
      2
    );
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan: narrationPlan,
    });
    assert.match(prompt, /RENDER THE COMPLETE MANHWA PAGE WITH READABLE KOREAN TEXT/);
    assert.match(prompt, /Narration box \(readable Korean, when this beat needs context\)/);
  });

  it("FULL-2 provider prompt includes the readable Korean SFX contract when appropriate", () => {
    const plan = hybridPlanWithSfx();
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan,
    });
    assert.match(prompt, /SFX text \(readable Korean, when appropriate\)/);
    assert.ok(prompt.includes("쾅"), "SFX cue text is rendered in the full-provider prompt");
  });

  it("FULL-3 final comic save path never applies a server text layer", () => {
    const providerBuffer = Buffer.from("provider-comic-webp-bytes");
    const assembled = assembleComicFinalImage({ providerBuffer });
    assert.equal(assembled.buffer, providerBuffer);
    assert.equal(assembled.serverTextLayerApplied, false);
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

function hybridPlanWithSfx() {
  return {
    sceneBackground: "",
    events: [],
    heroEventIds: [],
    heroScene: "",
    recommendedPanelCount: 2 as const,
    panels: [
      {
        index: 1,
        sourceEventIds: [],
        situation: "문이 쾅 닫힌다",
        dialogue: [] as Array<{ speaker: "character"; text: string; provenance: "user_edit" }>,
      },
      {
        index: 2,
        sourceEventIds: [],
        situation: "",
        dialogue: [],
      },
    ],
  };
}
