import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileChatComicPanelSpec } from "@/lib/chatComicPanelSpec";
import { duoVisualSubjectsForCast } from "@/lib/chatComicPanelSpec.fixtures";
import { buildChatComicImagePrompt } from "@/lib/chatComicGeneration";
import { buildChatLdIllustrationPrompt } from "@/lib/chatLdIllustrationGeneration";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
} from "@/lib/chatImageScenePlan";
import {
  ILLUSTRATION_SAFE_DEPICTION,
  collectApprovedComicTextForSafeImageGeneration,
  formatApprovedScenePlanForSafeImageGeneration,
  isExplicitSourceTextForImageLeak,
  projectSceneTextForSafeImageGeneration,
} from "@/lib/chatImageSafeVisualProjection";

const PERSONA = "렌";
const CHARACTER = "태형";

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
    assert.equal(isExplicitSourceTextForImageLeak(result.text), false);
  });

  it("P3 shirtless adult male is not forced into business meeting scene", () => {
    const result = projectSceneTextForSafeImageGeneration("태형이 셔츠를 벗고 상체를 드러낸다.");
    assert.equal(result.applied, false);
    assert.doesNotMatch(result.text, /meeting scene/i);
    assert.match(result.text, /셔츠/);
  });

  it("P4 explicit adult activity becomes non-explicit intimacy projection", () => {
    const explicit = "둘이 침대에서 겹치며 성관계를 한다.";
    const result = projectSceneTextForSafeImageGeneration(explicit);
    assert.equal(result.applied, true);
    assert.equal(result.reasonCategories.includes("adult_explicit"), true);
    assert.doesNotMatch(result.text, /성관계/);
    assert.match(result.text, /non-explicit/i);
  });

  it("P5 explicit bedroom scene becomes covered non-explicit adaptation", () => {
    const result = projectSceneTextForSafeImageGeneration(
      "침대 위에서 그는 그녀 위에서 허리를 흔들었다."
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
    assert.doesNotMatch(result.text, /긋/);
    assert.match(result.text, /손/);
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
    const { formatted, applied } = formatApprovedScenePlanForSafeImageGeneration(plan);
    assert.equal(applied, true);
    assert.equal(isExplicitSourceTextForImageLeak(formatted), false);
    assert.doesNotMatch(formatted, /성관계/);
  });

  it("ILLUSTRATION_SAFE_DEPICTION allows non-explicit adult intimacy", () => {
    assert.match(ILLUSTRATION_SAFE_DEPICTION, /non-explicit/i);
    assert.doesNotMatch(ILLUSTRATION_SAFE_DEPICTION, /wholesome conversation \/ meeting scene only/i);
  });

  it("comic final prompt excludes explicit source after safe projection", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"..."' },
      {
        id: 2,
        role: "assistant",
        content: '"둘이 침대에서 겹치며 성관계를 한다."',
      },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const prompt = buildChatComicImagePrompt({
      characterName: CHARACTER,
      characterGender: "male",
      personaName: PERSONA,
      personaGender: "female",
      plan,
      subjects: duoVisualSubjectsForCast({ personaName: PERSONA, characterName: CHARACTER }),
    });
    assert.equal(isExplicitSourceTextForImageLeak(prompt), false);
    assert.doesNotMatch(prompt, /성관계/);
  });

  it("LD prompt uses safe projection for raw turn prose", () => {
    const prompt = buildChatLdIllustrationPrompt({
      characterName: CHARACTER,
      characterGender: "male",
      personaName: PERSONA,
      personaGender: "female",
      currentTurn: "둘이 침대에서 겹치며 성관계를 한다.",
    });
    assert.doesNotMatch(prompt, /성관계/);
    assert.match(prompt, /non-explicit|Close adult intimacy/i);
  });
});
