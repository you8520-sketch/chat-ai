import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCoupleStampGenerationPlan } from "./chatCoupleStampGeneration";
import {
  coupleStampHeightToRelativeScale,
  renderChatImageCompositionBlock,
} from "./chatImageComposition";

describe("chatImageComposition", () => {
  it("maps couple-stamp height ids to canonical relative scale", () => {
    assert.equal(coupleStampHeightToRelativeScale("persona_taller"), "user_taller");
    assert.equal(coupleStampHeightToRelativeScale("character_taller"), "partner_taller");
    assert.equal(coupleStampHeightToRelativeScale("same"), "same_height");
    assert.equal(coupleStampHeightToRelativeScale("invalid"), "same_height");
  });

  it("renders user_taller as stature plus close-up frame-share translation", () => {
    const block = renderChatImageCompositionBlock({
      scale: "user_taller",
      characterName: "CharacterA",
      personaName: "CharacterB",
    });
    assert.match(block, /COMPOSITION — relative scale/);
    assert.match(block, /CharacterB must read visibly taller than CharacterA/);
    assert.match(block, /Do NOT equalize sizes/i);
    assert.match(block, /higher eye-line \/ shoulder relationship/);
    assert.match(block, /ALL four badges/i);
    assert.match(block, /tight cheek close-up/);
    assert.match(block, /frame share \/ presence/);
    assert.doesNotMatch(block, /larger head\/body silhouette/i);
  });

  it("renders same_height without dominance language", () => {
    const block = renderChatImageCompositionBlock({
      scale: "same_height",
      characterName: "A",
      personaName: "B",
    });
    assert.match(block, /same relative visual stature/i);
    assert.doesNotMatch(block, /visibly taller/i);
  });

  it("keeps persona_taller on all four couple-stamp badges including close-up", () => {
    const plan = buildCoupleStampGenerationPlan({
      characterName: "CharacterA",
      characterGender: "male",
      personaName: "CharacterB",
      personaGender: "female",
      characterImageUrl: "/synthetic/character-a-primary.webp",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaImageUrl: "/synthetic/character-b-primary.webp",
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
      options: { height: "persona_taller" },
    });
    assert.match(plan.prompt, /CharacterB must read visibly taller than CharacterA/);
    assert.match(plan.prompt, /Do NOT equalize sizes/i);
    assert.match(plan.prompt, /ALL four badges including the tight cheek close-up/);
    assert.match(plan.prompt, /do not override COMPOSITION relative scale/i);
    assert.doesNotMatch(plan.prompt, /Height \/ face position in every badge/);
  });
});
