import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AI_LEARNING_LIMIT,
  CHARACTER_SETTING_SOURCE_LIMIT,
  CHARACTER_SETTING_WRAPPER_RESERVE,
  SPEECH_CONTEXTUAL_LIMIT,
  SPEECH_EXAMPLES_LIMIT,
  SPEECH_FORBIDDEN_LIMIT,
} from "@/lib/characterFormLimits";
import {
  buildCompiledCreatorDescriptionForSave,
  parseCharacterFormBody,
  type SessionUser,
} from "@/lib/characterFormSave";
import { characterSettingInputForRow, type CharacterSettingRow } from "@/lib/characterChunks";
import {
  buildCombinedCharacterSettingSource,
  CHARACTER_SETTING_SOURCE_CHAR_CAP,
  characterSettingSourceOverflowChars,
  joinedCharacterSettingSourceLength,
  parseCharacterSetting,
} from "@/utils/characterParser";

const ADULT: SessionUser = { id: 1, nickname: "cap", is_adult: 1 };

function sentences(prefix: string, chars: number): string {
  const lines: string[] = [];
  let length = 0;
  for (let index = 0; length < chars; index += 1) {
    const line = `${prefix}${index} 북부 요새의 보급로는 겨울마다 끊기고 병사들은 같은 순서로 기록을 대조한다.`;
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n").slice(0, chars);
}

type Fill = { personality: number; traits: number; world: number };

type Registers = "single" | "eight";

function registersFor(kind: Registers) {
  if (kind === "single") {
    return [
      {
        label: "공식",
        condition: "심문 중".repeat(20),
        style: "존댓말".repeat(20),
        examples: `"기록하겠습니다."\n`.repeat(15),
      },
    ];
  }
  return Array.from({ length: 8 }, (_, index) => ({
    label: "가".repeat(4),
    condition: "나".repeat(15),
    style: "다".repeat(15),
    examples: Array.from({ length: 6 }, () => `"라"`).join("\n"),
    priority: index === 0 ? 100 : 100,
  }));
}

function maxFilledBody(fill: Fill, registers: Registers = "single") {
  const personality = sentences("성격", fill.personality);
  const traits = sentences("특징", fill.traits);
  const world = sentences("세계", fill.world);
  const systemPrompt = `${sentences("설정", AI_LEARNING_LIMIT - fill.personality - fill.traits - fill.world - 12)}\nMARK_TAIL`;
  const examples = Array.from({ length: 40 }, (_, index) => `캐릭터: "요점만 말해 ${index}."`)
    .join("\n")
    .slice(0, SPEECH_EXAMPLES_LIMIT);
  const forbidden = sentences("금지", SPEECH_FORBIDDEN_LIMIT);
  const contextual = registersFor(registers);
  const contextualChars = contextual.reduce(
    (sum, register) => sum + register.label.length + register.condition.length + register.style.length + register.examples.length,
    0
  );
  assert.ok(contextualChars <= SPEECH_CONTEXTUAL_LIMIT, `contextual ${contextualChars}`);
  return {
    content_kind: "character",
    name: "볼프강 폰 발켄하임",
    tagline: "한줄",
    description: "공개 소개",
    greeting: "인사.",
    system_prompt: systemPrompt,
    world,
    speech_personality: personality,
    speech_traits: traits,
    speech_examples: examples,
    speech_forbidden: forbidden,
    speech_contextual_registers: contextual,
    genres: ["로맨스"],
    gender: "male",
    nsfw: false,
    participant_min_age: 28,
    assets: [{ url: "/uploads/test.png", tag: "neutral", representativeRank: 1 }],
  };
}

function rowFromAcceptedBody(body: ReturnType<typeof maxFilledBody>): CharacterSettingRow {
  const parsed = parseCharacterFormBody(body, ADULT);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
  if (!parsed.ok) throw new Error(parsed.error);
  const data = parsed.data;
  const compiled = buildCompiledCreatorDescriptionForSave(data);
  return {
    id: 1,
    name: data.name,
    gender: data.gender,
    system_prompt: data.systemPrompt,
    world: data.world,
    example_dialog: data.exampleDialog,
    creator_compiled_description_json: compiled.compiledDescriptionJson,
  };
}

describe("RP setting source cap follows the canonical save limits", () => {
  it("derives the injection cap from the save budget, speech field limits and the wrapper reserve", () => {
    assert.equal(
      CHARACTER_SETTING_SOURCE_LIMIT,
      AI_LEARNING_LIMIT +
        SPEECH_EXAMPLES_LIMIT +
        SPEECH_FORBIDDEN_LIMIT +
        SPEECH_CONTEXTUAL_LIMIT +
        CHARACTER_SETTING_WRAPPER_RESERVE
    );
    assert.equal(CHARACTER_SETTING_SOURCE_CHAR_CAP, CHARACTER_SETTING_SOURCE_LIMIT);
    assert.ok(CHARACTER_SETTING_SOURCE_CHAR_CAP > AI_LEARNING_LIMIT, "a bare 12,000 cap would still cut valid saves");
  });

  const fills: Array<[string, Fill, Registers]> = [
    ["thin speech, large world", { personality: 5, traits: 5, world: 3000 }, "single"],
    ["eight contextual registers", { personality: 5, traits: 5, world: 3000 }, "eight"],
    ["balanced", { personality: 300, traits: 600, world: 2400 }, "single"],
    ["thick speech", { personality: 1500, traits: 1500, world: 1500 }, "single"],
    ["no world", { personality: 5, traits: 5, world: 0 }, "single"],
  ];

  for (const [label, fill, registers] of fills) {
    it(`never truncates a save-accepted character (${label})`, () => {
      const row = rowFromAcceptedBody(maxFilledBody(fill, registers));
      const input = characterSettingInputForRow(row);
      const joined = joinedCharacterSettingSourceLength(input);
      assert.ok(joined > 10_000, `fixture must exceed the legacy 10,000 cap, got ${joined}`);
      assert.equal(characterSettingSourceOverflowChars(input), 0, `joined ${joined} cap ${CHARACTER_SETTING_SOURCE_CHAR_CAP}`);
      const combined = buildCombinedCharacterSettingSource(input);
      assert.ok(combined.includes("MARK_TAIL"), "system_prompt tail must survive");
      assert.ok(combined.includes("요점만 말해 0."), "speech examples must survive");
      assert.ok(combined.includes("dialogue_avoid"), "forbidden-speech block must survive");
      assert.ok(combined.trimEnd().endsWith(input.exampleDialog!.trimEnd()), "speech block must be complete");
      const chunkText = parseCharacterSetting(input)
        .map((chunk) => chunk.content)
        .join("\n");
      assert.ok(chunkText.includes("MARK_TAIL") && chunkText.includes("dialogue_avoid"));
    });
  }

  it("keeps the wrapper reserve above the measured worst case with real headroom", () => {
    let worst = 0;
    for (const [, fill, registers] of fills) {
      const joined = joinedCharacterSettingSourceLength(characterSettingInputForRow(rowFromAcceptedBody(maxFilledBody(fill, registers))));
      worst = Math.max(worst, joined);
    }
    assert.ok(CHARACTER_SETTING_SOURCE_CHAR_CAP - worst >= 100, `headroom ${CHARACTER_SETTING_SOURCE_CHAR_CAP - worst}`);
  });
});
