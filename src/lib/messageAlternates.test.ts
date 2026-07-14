import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { latestVariantIndexByGenerationSequence, type MessageVariant } from "./messageAlternates";

function variant(generationSequence: number): MessageVariant {
  return {
    content: `generation_${generationSequence}`,
    model: "test",
    usage: null,
    created_at: "",
    generationSequence,
  };
}

describe("message variant generation ordering", () => {
  it("selects generation 10 as newer than generation 9 using numeric sequence", () => {
    assert.equal(latestVariantIndexByGenerationSequence([variant(9), variant(10)]), 1);
  });

  it("does not use lexicographic generation id ordering", () => {
    const variants = [variant(10), variant(9)];
    assert.equal(latestVariantIndexByGenerationSequence(variants), 0);
  });
});
