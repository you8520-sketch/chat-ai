import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldShowVariantPicker } from "./chatVariantPickerPolicy";

describe("FREEZE-UI variant picker policy", () => {
  it("historical canonical assistant → no interactive picker", () => {
    const messages = [
      { role: "assistant" },
      { role: "user" },
      { role: "assistant" },
      { role: "user" },
    ];
    assert.equal(
      shouldShowVariantPicker({
        showToolbar: true,
        role: "assistant",
        variantCount: 3,
        messageIndex: 0,
        messages,
      }),
      false
    );
  });

  it("current canonical frontier → picker shown when multi-variant", () => {
    const messages = [
      { role: "assistant" },
      { role: "user" },
      { role: "assistant" },
    ];
    assert.equal(
      shouldShowVariantPicker({
        showToolbar: true,
        role: "assistant",
        variantCount: 2,
        messageIndex: 2,
        messages,
      }),
      true
    );
  });

  it("canon-adopted OOC assistant → picker hidden", () => {
    const messages = [{ role: "assistant" }];
    assert.equal(
      shouldShowVariantPicker({
        showToolbar: true,
        role: "assistant",
        variantCount: 2,
        canonAdopted: true,
        messageIndex: 0,
        messages,
      }),
      false
    );
  });
});
