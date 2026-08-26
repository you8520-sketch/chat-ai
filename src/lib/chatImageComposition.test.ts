import assert from "node:assert/strict";
import { describe, it } from "node:test";

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

  it("renders user_taller with stronger frame-share semantics for couple stamps", () => {
    const block = renderChatImageCompositionBlock({
      scale: "user_taller",
      product: "couple_stamp",
      characterName: "CharacterA",
      personaName: "CharacterB",
    });
    assert.match(block, /COMPOSITION — relative scale/);
    assert.match(block, /CharacterB must read visibly LARGER than CharacterA/);
    assert.match(block, /ALL four badges/i);
    assert.match(block, /user persona must occupy more of the circle/i);
    assert.doesNotMatch(block, /equalize sizes/i);
  });

  it("renders same_height without dominance language", () => {
    const block = renderChatImageCompositionBlock({
      scale: "same_height",
      product: "couple_stamp",
      characterName: "A",
      personaName: "B",
    });
    assert.match(block, /same relative scale/i);
    assert.doesNotMatch(block, /visibly LARGER/i);
  });

  it("uses full-body semantics for LD duo", () => {
    const block = renderChatImageCompositionBlock({
      scale: "user_taller",
      product: "ld_duo",
      characterName: "A",
      personaName: "B",
    });
    assert.match(block, /Full-body or mid-shot/i);
    assert.match(block, /visibly taller/i);
  });
});
