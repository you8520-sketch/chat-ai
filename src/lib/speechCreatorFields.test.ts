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

  it("SPEECH CONSISTENCY scopes examples to demonstrated speech features only", () => {
    const composed = speechCreatorFields.composeExampleDialog({
      speech_personality: "",
      speech_traits: "수다스럽고 감정이 풍부하다",
      speech_examples: '"응."',
      speech_forbidden: "",
      speech_contextual_registers: [],
    });
    assert.match(composed, /\[SPEECH CONSISTENCY\]/);
    assert.match(composed, /demonstrated speech features/);
    assert.match(composed, /Do not infer unrelated personality/);
    assert.match(composed, /how much they naturally speak/);
    assert.doesNotMatch(composed, /examples always win/);
    assert.match(composed, /\[예시 대사\]\n응\./);
  });

  it("excludes examples/contextual/forbidden from AI learning char count", () => {
    const count = speechCreatorFields.speechCreatorCharCount({
      speech_personality: "기본",
      speech_traits: "특징",
      speech_examples: "a".repeat(400),
      speech_forbidden: "b".repeat(400),
      speech_contextual_registers: [
        {
          label: "공적",
          condition: "상관 앞",
          style: "존댓말",
          examples: "네.",
        },
      ],
    });
    assert.equal(count, "기본".length + "특징".length);
  });

  it("rejects speech detail fields over 500 chars", () => {
    assert.match(
      speechCreatorFields.validateSpeechCreatorInput({
        speech_personality: "",
        speech_traits: "",
        speech_examples: "x".repeat(501),
        speech_forbidden: "",
        speech_contextual_registers: [],
      }) ?? "",
      /대사 예시/
    );
    assert.match(
      speechCreatorFields.validateSpeechCreatorInput({
        speech_personality: "",
        speech_traits: "",
        speech_examples: "",
        speech_forbidden: "y".repeat(501),
        speech_contextual_registers: [],
      }) ?? "",
      /금지 말투/
    );
    assert.match(
      speechCreatorFields.validateSpeechCreatorInput({
        speech_personality: "",
        speech_traits: "",
        speech_examples: "",
        speech_forbidden: "",
        speech_contextual_registers: [
          {
            label: "a".repeat(100),
            condition: "b".repeat(160),
            style: "c".repeat(240),
            examples: "d".repeat(100),
          },
        ],
      }) ?? "",
      /상황별 말투/
    );
  });
});
