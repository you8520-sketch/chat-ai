import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_LD_ILLUSTRATION_OUTPUT_SIZE,
  CHAT_LD_ILLUSTRATION_QUALITY,
  buildChatLdIllustrationPrompt,
  buildLdDuoGenerationPlan,
  buildTrpgIllustrationSituation,
  formatOpenAiImageUserError,
  resolveChatLdIllustrationPrice,
  sanitizeChatTurnForIllustrationPrompt,
  uniqueIllustrationAliases,
  withIllustrationReferenceIndices,
} from "./chatLdIllustrationGeneration";

describe("chatLdIllustrationGeneration", () => {
  it("uses a medium-quality 800x1200 vertical output", () => {
    assert.equal(CHAT_LD_ILLUSTRATION_OUTPUT_SIZE, "800x1200");
    assert.equal(CHAT_LD_ILLUSTRATION_QUALITY, "medium");
  });

  it("charges 200P by default even when a four-person party cast is used", () => {
    assert.equal(resolveChatLdIllustrationPrice({} as NodeJS.ProcessEnv), 200);
  });

  it("uses the selected-turn scene brief and forbids comic text or identity mixing", () => {
    const prompt = buildChatLdIllustrationPrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      currentTurn: "Setting: 식당\nActions: 렌이 태형에게 깻잎을 먹여준다.",
    });
    assert.match(prompt, /렌이 태형에게 깻잎을 먹여준다/);
    assert.match(prompt, /SELECTED TURN SCENE BRIEF/);
    assert.match(prompt, /Image 1 belongs ONLY to 태형/);
    assert.match(prompt, /Image 2 belongs ONLY to 렌/);
    assert.match(prompt, /IDENTITY OWNERSHIP IS STRICT/);
    assert.match(prompt, /Do not add extra people/);
    assert.match(prompt, /Do not render speech bubbles/);
    assert.match(prompt, /vertical 2:3/);
    assert.match(prompt, /GENDER LOCK/);
    assert.match(prompt, /confirmed MALE/);
    assert.match(prompt, /wholesome conversation/);
    assert.match(prompt, /Show exactly these two people/);
  });

  it("requires every TRPG party member to appear when a cast is provided", () => {
    const prompt = buildChatLdIllustrationPrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      currentTurn: "네 사람이 폐허 입구에 선다.",
      situation: buildTrpgIllustrationSituation({
        location: "폐허 입구",
        actions: [
          { name: "렌", body: "문을 밀어 연다." },
          { name: "태형", body: "검을 뽑는다." },
        ],
        narration: "네 사람이 폐허 입구에 선다.",
      }),
      cast: [
        {
          name: "렌",
          gender: "male",
          role: "player",
          referenceIndex: 1,
          aliases: ["권태현", "태현"],
        },
        { name: "태형", gender: "male", role: "companion character", referenceIndex: 2 },
        { name: "유나", gender: "female", role: "companion character", referenceIndex: 3 },
        {
          name: "민호",
          gender: "male",
          role: "player",
          referenceIndex: null,
          appearanceNote: "짧은 흑발, 안경",
        },
      ],
    });
    assert.match(prompt, /Show ALL 4 listed people/);
    assert.match(prompt, /Count the people: 4/);
    assert.match(prompt, /Show exactly these 4 people/);
    assert.doesNotMatch(prompt, /Show exactly these two people/);
    assert.match(prompt, /1\. 렌 \(player\)\. Gender: confirmed male/);
    assert.match(prompt, /Also known as: 권태현, 태현/);
    assert.doesNotMatch(prompt, /identity photo/);
    assert.match(prompt, /IDENTITY OWNERSHIP IS STRICT/);
    assert.equal([...prompt.matchAll(/Image 1 belongs ONLY to 렌/g)].length, 1);
    const cast = prompt.slice(
      prompt.indexOf("CAST ("),
      prompt.indexOf("SUBJECT IDENTITY MANIFEST")
    );
    assert.doesNotMatch(cast, /belongs ONLY/);
    assert.doesNotMatch(cast, /No photo for/);
    assert.match(prompt, /Image 1 belongs ONLY to 렌/);
    assert.match(prompt, /2\. 태형 \(companion character\)\. Gender: confirmed male/);
    assert.match(prompt, /3\. 유나 \(companion character\)\. Gender: confirmed female/);
    assert.match(prompt, /4\. 민호 \(player\)/);
    assert.match(prompt, /No photo for 민호/);
    assert.match(prompt, /짧은 흑발, 안경/);
    assert.match(prompt, /confirmed FEMALE/);
    assert.match(prompt, /LOCATION: 폐허 입구/);
    assert.match(prompt, /THIS ROUND'S ACTIONS/);
    assert.match(prompt, /- 렌: 문을 밀어 연다/);
    assert.match(prompt, /- 태형: 검을 뽑는다/);
    assert.match(prompt, /GM SCENE:/);
    assert.match(prompt, /every listed face is clearly visible/);
    assert.match(prompt, /네 사람이 폐허 입구에 선다/);
  });

  it("softens self-harm-adjacent metaphors before sending the turn", () => {
    const cleaned = sanitizeChatTurnForIllustrationPrompt(
      '유저: 심장이 멎는 줄 알았고 죽을 것 같았어. 손목을 잡았다. <<<STATUS_VALUES\nfoo\n>>>'
    );
    assert.doesNotMatch(cleaned, /STATUS_VALUES/);
    assert.doesNotMatch(cleaned, /손목/);
    assert.doesNotMatch(cleaned, /죽을 것 같/);
    assert.doesNotMatch(cleaned, /심장이 멎/);
    assert.match(cleaned, /손/);
    const sceneInjury = sanitizeChatTurnForIllustrationPrompt("피투성이 상처");
    assert.doesNotMatch(sceneInjury, /피투성이/);
    assert.match(sceneInjury, /땀투성이/);
  });

  it("preserves healed identity scars and does not ban them as active injury", () => {
    const plan = buildLdDuoGenerationPlan({
      characterName: "CharacterA",
      characterGender: "male",
      personaName: "CharacterB",
      personaGender: "female",
      characterImageUrl: "/synthetic/character-a-primary.webp",
      characterSavedAppearance: "large healed scar on the back of the neck",
      characterAppearanceMode: "image_plus_saved",
      personaImageUrl: "/synthetic/character-b-primary.webp",
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
      currentTurn: "피투성이 상처가 난 것 같았다.",
    });
    assert.match(plan.prompt, /large healed scar on the back of the neck/);
    assert.match(plan.prompt, /healed, non-graphic scar/);
    assert.doesNotMatch(plan.prompt, /Do not depict injury, blood, wounds, scars/);
    assert.doesNotMatch(plan.prompt, /피투성이/);
    assert.match(plan.prompt, /땀투성이/);
    assert.equal(
      [...plan.prompt.matchAll(/Image 1 belongs ONLY to CharacterA/g)].length,
      1
    );
  });

  it("maps OpenAI self-harm safety rejections to a Korean retry hint", () => {
    const msg = formatOpenAiImageUserError(
      "Your request was rejected by the safety system. safety_violations=[self-harm]."
    );
    assert.match(msg, /안전 필터/);
    assert.match(msg, /순화/);
  });

  it("numbers only members who have a photo, in party order", () => {
    const indexed = withIllustrationReferenceIndices([
      { name: "렌", imageUrl: "/uploads/ren.webp" },
      { name: "태형", imageUrl: null },
      { name: "유나", imageUrl: "/uploads/yuna.webp" },
      { name: "민호", imageUrl: "  " },
    ]);
    assert.equal(indexed[0]?.referenceIndex, 1);
    assert.equal(indexed[1]?.referenceIndex, null);
    assert.equal(indexed[2]?.referenceIndex, 2);
    assert.equal(indexed[3]?.referenceIndex, null);
  });

  it("keeps extra names and Hangul given-name shorts, without repeating the primary", () => {
    const aliases = uniqueIllustrationAliases("권태현", "권태현", "렌", "태현");
    assert.deepEqual(aliases, ["태현", "렌"]);
  });
});
