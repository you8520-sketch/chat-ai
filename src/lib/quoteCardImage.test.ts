import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildQuoteCardFooterLeft } from "@/lib/quoteCardImage";

describe("buildQuoteCardFooterLeft", () => {
  it("joins character and creator with middle dot", () => {
    assert.equal(
      buildQuoteCardFooterLeft({ bodyText: "", characterName: "하비", creatorName: "Ray" }),
      "하비 · Ray"
    );
  });

  it("uses character only when creator missing", () => {
    assert.equal(
      buildQuoteCardFooterLeft({ bodyText: "", characterName: "하비", creatorName: "" }),
      "하비"
    );
  });
});
