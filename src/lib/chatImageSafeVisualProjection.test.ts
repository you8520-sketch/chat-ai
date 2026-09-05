import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileChatComicPanelSpec } from "@/lib/chatComicPanelSpec";
import { duoVisualSubjectsForCast } from "@/lib/chatComicPanelSpec.fixtures";
import { buildChatComicImagePrompt } from "@/lib/chatComicGeneration";
import {
  buildChatLdIllustrationPrompt,
  buildLdSceneGenerationPlan,
  buildTrpgIllustrationSituation,
} from "@/lib/chatLdIllustrationGeneration";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  scenePlanHasRawChatLeak,
} from "@/lib/chatImageScenePlan";
import {
  buildIllustrationSafeDepiction,
  classifyRawVisualRisk,
  collectApprovedComicTextForSafeImageGeneration,
  containsRawRiskySourceLeak,
  formatApprovedScenePlanForSafeImageGeneration,
  projectSceneBlockForSafeImageGeneration,
  projectSceneTextForSafeImageGeneration,
} from "@/lib/chatImageSafeVisualProjection";

const PERSONA = "렌";
const CHARACTER = "태형";

function comicPromptForPlan(
  plan: ReturnType<typeof buildDeterministicScenePlan>,
  adultGrounded = false
) {
  return buildChatComicImagePrompt({
    characterName: CHARACTER,
    characterGender: "male",
    personaName: PERSONA,
    personaGender: "female",
    plan,
    adultGrounded,
    subjects: duoVisualSubjectsForCast({ personaName: PERSONA, characterName: CHARACTER }),
  });
}

function ldPromptForPlan(
  plan: ReturnType<typeof buildDeterministicScenePlan>,
  adultGrounded = false
) {
  const { formatted } = formatApprovedScenePlanForSafeImageGeneration(plan, undefined, {
    adultGrounded,
  });
  return buildChatLdIllustrationPrompt({
    characterName: CHARACTER,
    characterGender: "male",
    personaName: PERSONA,
    personaGender: "female",
    currentTurn: "",
    approvedScene: formatted,
    adultGrounded,
  });
}

describe("chatImageSafeVisualProjection", () => {
  it("P1 ordinary conversation is not rewritten unnecessarily", () => {
    const result = projectSceneTextForSafeImageGeneration("카페에서 둘이 조용히 대화한다.");
    assert.equal(result.applied, false);
    assert.match(result.text, /대화/);
  });

  it("P2 kiss / embrace stays non-explicit intimacy", () => {
    const result = projectSceneTextForSafeImageGeneration("둘이 서로를 껴안고 뺨에 키스한다.");
    assert.equal(result.applied, false);
    assert.match(result.text, /키스/);
    assert.equal(containsRawRiskySourceLeak(result.text), false);
  });

  it("P3 shirtless adult male is not forced into business meeting scene", () => {
    const result = projectSceneTextForSafeImageGeneration("태형이 셔츠를 벗고 상체를 드러낸다.");
    assert.equal(result.applied, false);
    assert.doesNotMatch(result.text, /meeting scene/i);
    assert.match(result.text, /셔츠/);
  });

  it("P4 explicit adult activity becomes non-explicit intimacy when adult grounded", () => {
    const explicit = "둘이 침대에서 겹치며 성관계를 한다.";
    const result = projectSceneTextForSafeImageGeneration(explicit, { adultGrounded: true });
    assert.equal(result.applied, true);
    assert.equal(result.reasonCategories.includes("adult_explicit"), true);
    assert.doesNotMatch(result.text, /성관계/);
    assert.match(result.text, /non-explicit/i);
  });

  it("P5 explicit bedroom scene becomes covered non-explicit adaptation when adult grounded", () => {
    const result = projectSceneTextForSafeImageGeneration(
      "침대 위에서 그는 그녀 위에서 허리를 흔들었다.",
      { adultGrounded: true }
    );
    assert.equal(result.applied, true);
    assert.match(result.text, /covered|bedroom|non-explicit/i);
  });

  it("P6 graphic injury becomes non-graphic aftermath", () => {
    const result = projectSceneTextForSafeImageGeneration("피가 온몸에 흘러내리며 칼에 찔렸다.");
    assert.equal(result.applied, true);
    assert.equal(result.reasonCategories.includes("graphic_violence"), true);
    assert.doesNotMatch(result.text, /피가/);
  });

  it("P7 self-harm wording is softened without depicting the act", () => {
    const result = projectSceneTextForSafeImageGeneration("손목을 긋고 싶은 마음이 든다.");
    assert.equal(result.reasonCategories.includes("self_harm"), true);
    assert.doesNotMatch(result.text, /긋/);
  });

  it("P10 comic safe text collection preserves panel dialogue ownership", () => {
    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([
        { id: 1, role: "user", content: '"안녕?"' },
        { id: 2, role: "assistant", content: '"그래."' },
      ]),
      2
    );
    const { texts } = collectApprovedComicTextForSafeImageGeneration(plan);
    assert.equal(texts.length, 2);
  });

  it("P12 explicit source text does not leak into LD approved scene prompt", () => {
    const messages = buildSceneSourceMessages([
      {
        id: 1,
        role: "assistant",
        content: "둘이 침대에서 겹치며 성관계를 한다.",
      },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const { formatted, applied } = formatApprovedScenePlanForSafeImageGeneration(plan, undefined, {
      adultGrounded: true,
    });
    assert.equal(applied, true);
    assert.equal(containsRawRiskySourceLeak(formatted), false);
    assert.doesNotMatch(formatted, /성관계/);
    assert.match(formatted, /Close adult intimacy/i);
  });

  it("ILLUSTRATION_SAFE_DEPICTION allows non-explicit adult intimacy when adult grounded", () => {
    assert.match(buildIllustrationSafeDepiction({ adultGrounded: true }), /non-explicit/i);
    assert.doesNotMatch(
      buildIllustrationSafeDepiction({ adultGrounded: true }),
      /wholesome conversation \/ meeting scene only/i
    );
  });

  it("comic full-provider prompt carries adult-grounded approved dialogue as readable text", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"..."' },
      {
        id: 2,
        role: "assistant",
        content: '"둘이 침대에서 겹치며 성관계를 한다."',
      },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const prompt = comicPromptForPlan(plan, true);
    // Full provider-rendered comic: approved adult dialogue is rendered by GPT
    // as readable Korean text (provider moderation + Tier-2 fallback are the
    // backstop). Raw scene prose block must still be absent.
    assert.ok(prompt.includes("성관계를 한다"), "approved dialogue reaches the full-provider prompt");
    assert.equal(scenePlanHasRawChatLeak(prompt), false);
    assert.match(prompt, /RENDER THE COMPLETE MANHWA PAGE WITH READABLE KOREAN TEXT/);
  });

  it("LD prompt uses safe projection for raw turn prose", () => {
    const prompt = buildChatLdIllustrationPrompt({
      characterName: CHARACTER,
      characterGender: "male",
      personaName: PERSONA,
      personaGender: "female",
      currentTurn: "둘이 침대에서 겹치며 성관계를 한다.",
      adultGrounded: true,
    });
    assert.doesNotMatch(prompt, /성관계/);
    assert.match(prompt, /non-explicit|Close adult intimacy/i);
  });

  it("P13 self-harm comic final-prompt leak = 0", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"..."' },
      { id: 2, role: "assistant", content: '"손목을 긋고 싶다."' },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const prompt = comicPromptForPlan(plan);
    assert.equal(containsRawRiskySourceLeak(prompt), false);
    assert.doesNotMatch(prompt, /손목(?:을|을)?\s*긋/);
    assert.doesNotMatch(prompt, /Speech bubble.*긋/);
  });

  it("P14 graphic violence comic final-prompt leak = 0", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"..."' },
      { id: 2, role: "assistant", content: '"피를 흘리며 쓰러졌다."' },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const prompt = comicPromptForPlan(plan);
    assert.equal(containsRawRiskySourceLeak(prompt), false);
    assert.doesNotMatch(prompt, /피(?:가|를)?\s*흘/);
  });

  it("P15 self-harm LD final-prompt leak = 0", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: "손목을 긋고 싶은 마음이 든다." },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const prompt = ldPromptForPlan(plan);
    assert.equal(containsRawRiskySourceLeak(prompt), false);
    assert.doesNotMatch(prompt, /손목(?:을|을)?\s*긋/);
  });

  it("P16 graphic violence TRPG final-prompt leak = 0", () => {
    const situation = buildTrpgIllustrationSituation({
      location: "던전",
      narration: "피를 흘리며 쓰러진 전사가 바닥에 누워 있다.",
    });
    const prompt = buildChatLdIllustrationPrompt({
      characterName: CHARACTER,
      characterGender: "male",
      personaName: PERSONA,
      personaGender: "female",
      currentTurn: "",
      cast: [{ name: "전사", role: "player", gender: "male" }],
      situation,
    });
    assert.equal(containsRawRiskySourceLeak(prompt), false);
    assert.doesNotMatch(prompt, /피(?:가|를)?\s*흘/);
  });

  it("P17 FP1 bed reading scene is not rewritten", () => {
    const result = projectSceneTextForSafeImageGeneration("침대 위에서 책을 읽는다.");
    assert.equal(result.applied, false);
    assert.match(result.text, /책/);
  });

  it("P18 FP2 ice cream licking is not adult explicit", () => {
    const categories = classifyRawVisualRisk("아이스크림을 핥아 먹는다.");
    assert.equal(categories.includes("adult_explicit"), false);
  });

  it("P19 FP3 straw drinking is not adult explicit", () => {
    const categories = classifyRawVisualRisk("빨대를 빨아 음료를 마신다.");
    assert.equal(categories.includes("adult_explicit"), false);
  });

  it("P20 FP4 roller coaster thrill is not adult explicit", () => {
    const categories = classifyRawVisualRisk("롤러코스터의 쾌감에 웃었다.");
    assert.equal(categories.includes("adult_explicit"), false);
  });

  it("P21 FP5 night bridge view is not adult explicit", () => {
    const categories = classifyRawVisualRisk("밤에 다리 위에서 바다를 바라본다.");
    assert.equal(categories.includes("adult_explicit"), false);
  });

  it("P22 FP6 room shelf view is not adult explicit", () => {
    const categories = classifyRawVisualRisk("방 안에서 위쪽 선반을 바라본다.");
    assert.equal(categories.includes("adult_explicit"), false);
  });

  it("P23 adult grounded explicit source uses non-explicit adult intimacy", () => {
    const result = projectSceneTextForSafeImageGeneration("둘이 침대에서 겹치며 성관계를 한다.", {
      adultGrounded: true,
    });
    assert.match(result.text, /Close adult intimacy/i);
  });

  it("P24 unknown age explicit source uses neutral non-sexual projection", () => {
    const result = projectSceneTextForSafeImageGeneration("둘이 침대에서 겹치며 성관계를 한다.");
    assert.match(result.text, /non-sexual composition/i);
    assert.doesNotMatch(result.text, /Close adult intimacy/i);
  });

  it("P25 risky dialogue is omitted from image bubble not rewritten", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: '"둘이 침대에서 겹치며 성관계를 한다."' },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const prompt = comicPromptForPlan(plan, true);
    assert.doesNotMatch(prompt, /Speech bubble.*Close adult intimacy/i);
    assert.doesNotMatch(prompt, /“Close adult intimacy/i);
  });

  it("P26 ordinary dialogue unchanged in comic whitelist", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"오늘 날씨 좋다."' },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const { texts } = collectApprovedComicTextForSafeImageGeneration(plan);
    assert.match(texts.join(" "), /날씨/);
  });

  it("P27 canonical ScenePlan is not mutated by projection formatters", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: "둘이 침대에서 겹치며 성관계를 한다." },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const before = JSON.stringify(plan);
    formatApprovedScenePlanForSafeImageGeneration(plan, undefined, { adultGrounded: true });
    collectApprovedComicTextForSafeImageGeneration(plan);
    assert.equal(JSON.stringify(plan), before);
  });

  it("P28 comic panel count parity for 2/3/4", () => {
    for (const count of [2, 3, 4] as const) {
      const plan = buildDeterministicScenePlan(
        buildSceneSourceMessages([
          { id: 1, role: "user", content: '"안녕?"' },
          { id: 2, role: "assistant", content: '"그래."' },
        ]),
        count
      );
      assert.equal(plan.panels.length, count);
      const prompt = comicPromptForPlan(plan);
      assert.match(prompt, new RegExp(`exactly ${count} wide horizontal panels`));
    }
  });

  it("P29 speaker/bubble ownership parity after safe projection", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"안녕?"' },
      { id: 2, role: "assistant", content: '"그래."' },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const spec = compileChatComicPanelSpec({
      plan,
      personaName: PERSONA,
      characterName: CHARACTER,
      subjects: duoVisualSubjectsForCast({ personaName: PERSONA, characterName: CHARACTER }),
      projection: {
        projectSceneText: (text) => projectSceneTextForSafeImageGeneration(text).text,
        omitDialogueText: (text) => classifyRawVisualRisk(text).length > 0,
      },
    });
    assert.equal(spec.panels.length, 2);
    assert.ok(spec.panels.some((panel) => panel.speechBubbles.length > 0));
  });

  it("P30 personaVisible=false parity keeps persona out of comic whitelist", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"비밀."' },
      { id: 2, role: "assistant", content: '"알겠어."' },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const { texts } = collectApprovedComicTextForSafeImageGeneration(plan, {
      personaVisible: false,
    });
    assert.doesNotMatch(texts.join(" "), /비밀/);
    assert.match(texts.join(" "), /알겠어/);
  });

  it("RISK-1 classifies self-harm on raw text before sanitizer erases evidence", () => {
    const categories = classifyRawVisualRisk("손목을 긋고 싶다.");
    assert.equal(categories.includes("self_harm"), true);
    const dialogue = projectSceneTextForSafeImageGeneration("손목을 긋고 싶다.", {
      isDialogue: true,
    });
    assert.equal(dialogue.omitFromImage, true);
    assert.equal(dialogue.reasonCategories.includes("self_harm"), true);
  });

  it("RISK-2 classifies graphic violence on raw text before sanitizer", () => {
    const categories = classifyRawVisualRisk("피를 흘리며 쓰러졌다.");
    assert.equal(categories.includes("graphic_violence"), true);
  });

  it("M1 TRPG mixed graphic block preserves safe surrounding context", () => {
    const narration = [
      "세 사람이 괴물을 피해 출구로 달린다.",
      "태형이 철문을 닫는다.",
      "강이현의 팔에서 피가 흘렀다.",
      "터널 끝에서 청록색 안개가 밀려온다.",
    ].join("\n");
    const situation = buildTrpgIllustrationSituation({
      location: "폐허가 된 지하철역",
      narration,
    });
    const prompt = buildChatLdIllustrationPrompt({
      characterName: CHARACTER,
      characterGender: "male",
      personaName: PERSONA,
      personaGender: "female",
      currentTurn: "",
      cast: [{ name: "태형", role: "player", gender: "male" }],
      situation,
    });
    assert.match(prompt, /지하철역|출구|달린/);
    assert.match(prompt, /철문|닫/);
    assert.match(prompt, /청록색|안개/);
    assert.doesNotMatch(prompt, /피가\s*흘/);
    assert.match(prompt, /aftermath|concern|fatigue|Emotional/i);
  });

  it("M2 mixed block preserves safe lines around explicit adult fragment when adultGrounded", () => {
    const block = [
      "창밖에는 비가 내린다.",
      "둘이 침대에서 성관계를 한다.",
      "새벽빛이 커튼 사이로 들어온다.",
    ].join("\n");
    const projected = projectSceneBlockForSafeImageGeneration(block, { adultGrounded: true });
    assert.match(projected.text, /비/);
    assert.match(projected.text, /새벽|커튼/);
    assert.doesNotMatch(projected.text, /성관계/);
    assert.match(projected.text, /intimacy|non-explicit/i);
  });

  it("M3 mixed block preserves safe setting with neutral substitute when not adultGrounded", () => {
    const block = [
      "창밖에는 비가 내린다.",
      "둘이 침대에서 성관계를 한다.",
      "새벽빛이 커튼 사이로 들어온다.",
    ].join("\n");
    const projected = projectSceneBlockForSafeImageGeneration(block, { adultGrounded: false });
    assert.match(projected.text, /비/);
    assert.match(projected.text, /새벽|커튼/);
    assert.doesNotMatch(projected.text, /성관계/);
    assert.match(projected.text, /non-sexual/i);
    assert.doesNotMatch(projected.text, /Close adult intimacy/i);
  });

  it("M4 all-risk single sentence may become one substitute", () => {
    const projected = projectSceneBlockForSafeImageGeneration("둘이 침대에서 성관계를 한다.");
    assert.equal(projected.applied, true);
    assert.doesNotMatch(projected.text, /성관계/);
  });

  it("M5 all-safe multi-line block remains parity", () => {
    const block = "카페에서 대화한다.\n창밖에 비가 내린다.";
    const projected = projectSceneBlockForSafeImageGeneration(block);
    assert.equal(projected.applied, false);
    assert.match(projected.text, /카페/);
    assert.match(projected.text, /비/);
  });

  it("P31 LD final prompt with adultGrounded=false excludes adult-specific allowance", () => {
    const prompt = buildChatLdIllustrationPrompt({
      characterName: CHARACTER,
      characterGender: "male",
      personaName: PERSONA,
      personaGender: "female",
      currentTurn: "둘이 침대에서 성관계를 한다.",
      adultGrounded: false,
    });
    assert.doesNotMatch(prompt, /natural adult intimacy/i);
    assert.doesNotMatch(prompt, /shirtless adult male torso/i);
    assert.doesNotMatch(prompt, /Close adult intimacy/i);
    assert.match(prompt, /non-explicit/i);
    assert.doesNotMatch(prompt, /성관계/);
    assert.match(prompt, /non-sexual/i);
  });

  it("P32 LD final prompt with adultGrounded=true may include adult non-explicit allowance", () => {
    const prompt = buildChatLdIllustrationPrompt({
      characterName: CHARACTER,
      characterGender: "male",
      personaName: PERSONA,
      personaGender: "female",
      currentTurn: "둘이 침대에서 성관계를 한다.",
      adultGrounded: true,
    });
    assert.match(prompt, /non-explicit adult intimacy|shirtless adult male torso/i);
    assert.doesNotMatch(prompt, /성관계/);
  });

  it("P33 comic final prompt adultGrounded=false has no adult-specific allowance", () => {
    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([{ id: 1, role: "user", content: '"안녕?"' }]),
      2
    );
    const prompt = buildChatComicImagePrompt({
      characterName: CHARACTER,
      characterGender: "male",
      personaName: PERSONA,
      personaGender: "female",
      plan,
      adultGrounded: false,
      subjects: duoVisualSubjectsForCast({ personaName: PERSONA, characterName: CHARACTER }),
    });
    assert.doesNotMatch(prompt, /natural adult intimacy/i);
    assert.doesNotMatch(prompt, /shirtless adult male torso/i);
    assert.match(prompt, /non-explicit/i);
  });

  it("P34 comic final prompt adultGrounded=true may include adult allowance", () => {
    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([{ id: 1, role: "user", content: '"안녕?"' }]),
      2
    );
    const prompt = buildChatComicImagePrompt({
      characterName: CHARACTER,
      characterGender: "male",
      personaName: PERSONA,
      personaGender: "female",
      plan,
      adultGrounded: true,
      subjects: duoVisualSubjectsForCast({ personaName: PERSONA, characterName: CHARACTER }),
    });
    assert.match(prompt, /non-explicit adult intimacy|shirtless adult male torso/i);
  });

  it("P35 TRPG party path adultGrounded=false uses base safety policy", () => {
    const prompt = buildChatLdIllustrationPrompt({
      characterName: CHARACTER,
      characterGender: "male",
      personaName: PERSONA,
      personaGender: "female",
      currentTurn: "던전 복도",
      adultGrounded: false,
      cast: [{ name: "태형", role: "player", gender: "male" }],
      situation: "LOCATION: 폐허\nGM SCENE:\n복도를 조심스럽게 걷는다.",
    });
    assert.doesNotMatch(prompt, /natural adult intimacy/i);
    assert.match(prompt, /non-explicit/i);
  });

  it("P36 TRPG party path adultGrounded=true may include adult allowance", () => {
    const prompt = buildChatLdIllustrationPrompt({
      characterName: CHARACTER,
      characterGender: "male",
      personaName: PERSONA,
      personaGender: "female",
      currentTurn: "던전 복도",
      adultGrounded: true,
      cast: [{ name: "태형", role: "player", gender: "male" }],
      situation: "LOCATION: 폐허\nGM SCENE:\n복도를 조심스럽게 걷는다.",
    });
    assert.match(prompt, /non-explicit adult intimacy|shirtless adult male torso/i);
  });
});

describe("chatImageSafeVisualProjection LD scene plan", () => {
  it("buildLdSceneGenerationPlan keeps approved scene without raw risky leak", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: "손목을 긋고 싶은 마음이 든다." },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const built = buildLdSceneGenerationPlan({
      characterName: CHARACTER,
      characterGender: "male",
      personaName: PERSONA,
      personaGender: "female",
      characterImageUrl: "/c.webp",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaImageUrl: "/p.webp",
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
      approvedScenePlan: plan,
    });
    assert.equal(containsRawRiskySourceLeak(built.prompt), false);
  });
});
