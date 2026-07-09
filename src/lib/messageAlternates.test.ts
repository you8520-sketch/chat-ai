import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { editedMessageVariant, resolveActiveVariantContent } from "@/lib/messageAlternates";

describe("messageAlternates edit behavior", () => {
  it("uses edited assistant text as the only active display variant", () => {
    const variant = editedMessageVariant({
      content: "edited assistant text",
      model: "test-model",
      usage: null,
    });

    const content = resolveActiveVariantContent({
      content: "edited assistant text",
      variants: [variant],
      activeVariant: 0,
    });

    assert.equal(content, "edited assistant text");
  });
});
