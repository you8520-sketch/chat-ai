import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripRepeatedTrailingQuoteMarks } from "@/lib/trailingQuoteSanitizer";

describe("stripRepeatedTrailingQuoteMarks", () => {
  it("removes repeated stray quote marks at the output tail", () => {
    assert.equal(
      stripRepeatedTrailingQuoteMarks('그의 눈에 비친 것은 오직 당신 하나뿐이었다. """"""'),
      "그의 눈에 비친 것은 오직 당신 하나뿐이었다."
    );
  });

  it("keeps a normal single closing quote", () => {
    assert.equal(stripRepeatedTrailingQuoteMarks('"정신 차려."'), '"정신 차려."');
  });
});
