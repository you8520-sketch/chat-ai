import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveActiveVariantContent } from "@/lib/messageAlternates";

describe("resolveActiveVariantContent", () => {
  it("returns active variant body when variants exist", () => {
    const content = resolveActiveVariantContent({
      content: "row-fallback",
      variants: [
        { content: "v0 prose", model: "m", usage: null, created_at: "" },
        { content: "v1 prose with html", model: "m", usage: null, created_at: "" },
      ],
      activeVariant: 1,
    });
    assert.equal(content, "v1 prose with html");
  });

  it("falls back to row content when variant missing", () => {
    assert.equal(
      resolveActiveVariantContent({ content: "row only", variants: [], activeVariant: 0 }),
      "row only"
    );
  });
});
