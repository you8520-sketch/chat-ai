import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { composeExampleDialog, type SpeechCreatorInput } from "@/lib/speechCreatorFields";
import { buildContext } from "@/services/contextBuilder";
import { parseCharacterSetting } from "@/utils/characterParser";

function creator(overrides: Partial<SpeechCreatorInput>): SpeechCreatorInput {
  return {
    speech_personality: "",
    speech_traits: "",
    speech_examples: "",
    speech_forbidden: "",
    speech_contextual_registers: [],
    ...overrides,
  };
}

/** save (composeExampleDialog → stored example_dialog) → final system prompt that reaches the model. */
function finalWire(input: SpeechCreatorInput): { saved: string; wire: string } {
  const saved = composeExampleDialog(input);
  const chunks = parseCharacterSetting({
    characterId: "wire",
    characterName: "지휘관",
    gender: "male",
    systemPrompt: "기본 정보\n이름: 지휘관",
    world: "",
    exampleDialog: saved,
  });
  const built = buildContext({
    charName: "지휘관",
    chunks,
    userNickname: "기록관",
    systemPrompt: "기본 정보\n이름: 지휘관",
    world: "",
    exampleDialog: saved,
    shortTermHistory: [],
    currentUserMessage: "상황을 알려 줘.",
    nsfw: false,
    gender: "male",
    provider: "openrouter",
    modelId: "deepseek/deepseek-v4-pro",
    userId: 1,
    completedTurns: 0,
  });
  return { saved, wire: built.systemPrompt };
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const SINGLE_SCOPE_CASES: { name: string; field: "speech_traits" | "speech_personality"; text: string }[] = [
  { name: "부하에게만 반말", field: "speech_traits", text: "부하에게만 반말을 쓴다." },
  { name: "공식 심문에서만 존댓말", field: "speech_traits", text: "공식 심문에서는 존댓말을 사용한다." },
  { name: "부하에게만 반말 (성격 필드)", field: "speech_personality", text: "부하에게만 반말을 쓴다." },
  {
    name: "기본 존댓말 + 특정 상대에게 반말",
    field: "speech_traits",
    text: "기본은 존댓말을 쓴다. 특정 상대인 부하에게는 반말을 쓴다.",
  },
  {
    name: "반말 금지와 상황별 허용 혼합",
    field: "speech_traits",
    text: "공식 심문에서는 반말 금지. 부하에게는 반말을 쓴다.",
  },
  { name: "항상 존댓말", field: "speech_traits", text: "항상 존댓말만 쓴다." },
  { name: "항상 반말", field: "speech_traits", text: "항상 반말만 쓴다." },
];

describe("speech register — saved example_dialog → final wire", () => {
  for (const { name, field, text } of SINGLE_SCOPE_CASES) {
    it(`${name}: original condition and wording reach the wire once, with no inferred global default`, () => {
      const { saved, wire } = finalWire(creator({ [field]: text }));
      assert.equal(occurrences(saved, text), 1, "saved example_dialog keeps the creator sentence once");
      assert.equal(occurrences(wire, text), 1, "final wire keeps the creator sentence once");
      assert.doesNotMatch(saved, /default_register/);
      assert.doesNotMatch(wire, /default_register/);
    });
  }

  it("context:style + plain sentence + bullet + curly/straight examples + explicit forbidden are all preserved", () => {
    for (const quote of [
      ['"', '"'],
      ["“", "”"],
    ] as const) {
      const example = `${quote[0]}기록하겠습니다.${quote[1]}`;
      const { saved, wire } = finalWire(
        creator({
          speech_traits: [
            "공적: 존댓말을 쓴다.",
            "화가 나면 말수가 줄고 상대의 직함을 정확히 부른다.",
            "- 부하에게는 군더더기 없이 짧게 말한다.",
            `예시: ${example}`,
          ].join("\n"),
          speech_examples: example,
          speech_forbidden: "반말·하대·친구 말투, 장광설",
        })
      );
      for (const piece of [
        "공적 → 존댓말을 쓴다.",
        "화가 나면 말수가 줄고 상대의 직함을 정확히 부른다.",
        "부하에게는 군더더기 없이 짧게 말한다.",
        "기록하겠습니다.",
        "반말·하대·친구 말투, 장광설",
      ]) {
        assert.ok(saved.includes(piece), `saved keeps: ${piece}`);
        assert.ok(wire.includes(piece), `wire keeps: ${piece}`);
      }
      assert.doesNotMatch(wire, /default_register/);
      assert.equal(occurrences(wire, "화가 나면 말수가 줄고 상대의 직함을 정확히 부른다."), 1);
    }
  });
});
