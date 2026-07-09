import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

let speechCreatorFields: typeof import("@/lib/speechCreatorFields");

before(async () => {
  const speechCreatorFieldsModule = await import("@/lib/speechCreatorFields");
  speechCreatorFields =
    speechCreatorFieldsModule.default ?? speechCreatorFieldsModule;
});

describe("speechCreatorFields", () => {
  it("restores basic speech notes saved in generation metadata", () => {
    const saved = speechCreatorFields.composeExampleDialog({
      speech_personality: "평소에는 낮고 무뚝뚝한 반말이다.",
      speech_traits: "",
      speech_examples: "",
      speech_forbidden: "",
      speech_contextual_registers: [],
    });

    const parsed = speechCreatorFields.speechCreatorFromLegacyExampleDialog(saved);

    assert.match(parsed.speech_personality, /평소에는 낮고 무뚝뚝한 반말/);
    assert.equal(parsed.speech_examples, "");
  });
});
