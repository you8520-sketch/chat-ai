import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseUserMessageParts,
  promptTextForUserPart,
  splitPlainUserChunk,
} from "./userMessageParse";
import { formatUserMessageForPrompt } from "./userActionThoughtRules";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
} from "./chatModels";
import { buildContext } from "@/services/contextBuilder";

const EXACT_FIXTURE = "신입 ...맞아.나 본적있어?(갸웃)나는 렌이라고 부르면 돼.";

function kindsAndPromptText(input: string) {
  return parseUserMessageParts(input).map((p) => ({
    kind: p.kind,
    prompt: promptTextForUserPart(p),
  }));
}

describe("userMessageParse", () => {
  it("splitPlainUserChunk preserves trailing chars after leading whitespace", () => {
    const parts = splitPlainUserChunk(" 이걸로 만족해");
    assert.equal(parts.map((p) => p.text).join(""), "이걸로 만족해");
  });

  it("parseUserMessageParts preserves dialogue after asterisk action block", () => {
    const text =
      "그렇게 가이딩 받고싶어???  *한숨쉬고 다시한번 꼭 안아주며 가이딩해준다* 이걸로 만족해";
    const joined = parseUserMessageParts(text)
      .map((p) => p.text)
      .join("");
    assert.ok(joined.includes("*한숨쉬고 다시한번 꼭 안아주며 가이딩해준다*"));
    assert.ok(joined.endsWith("만족해"), `expected tail preserved, got: ${joined}`);
    assert.ok(!joined.endsWith("만족"), `should not drop final syllable, got: ${joined}`);
  });

  it("exact fixture: parenthetical action then trailing dialogue (RAW_PARENTHESES_LEAK)", () => {
    const parts = kindsAndPromptText(EXACT_FIXTURE);
    assert.deepEqual(parts, [
      { kind: "dialogue", prompt: "신입 ...맞아.나 본적있어?" },
      { kind: "action", prompt: "갸웃" },
      { kind: "dialogue", prompt: "나는 렌이라고 부르면 돼." },
    ]);

    const formatted = formatUserMessageForPrompt(EXACT_FIXTURE, false);
    assert.equal(
      formatted,
      [
        "[유저 대사]",
        "신입 ...맞아.나 본적있어?",
        "",
        "[유저 지문/행동 — 캐릭터가 관찰 가능]",
        "갸웃",
        "",
        "[유저 대사]",
        "나는 렌이라고 부르면 돼.",
      ].join("\n")
    );
    assert.equal(formatted.includes("(갸웃)"), false);
  });

  it("keeps short connective-ending narration as action", () => {
    const actionCases = [
      "(갸웃)",
      "(고개를 끄덕인다)",
      "*고개를 끄덕인다*",
      "고개를 끄덕였다.",
      "손을 잡고 걸었다.",
      "그를 바라보며 웃었다.",
      "천천히 한 발 다가갔다.",
      "손을 잡고",
      "고개를 끄덕이며",
    ];
    for (const input of actionCases) {
      const parts = parseUserMessageParts(input);
      assert.ok(
        parts.every((p) => p.kind === "action"),
        `expected action for ${JSON.stringify(input)}, got ${JSON.stringify(parts)}`
      );
    }
  });

  it("keeps quotative mid-sentence speech as dialogue", () => {
    const dialogueCases = [
      "나는 렌이라고 부르면 돼.",
      "내가 간다고 했잖아.",
      "왜냐고?",
      "같이 가자고 한 거야.",
      "그 사람이 아니라고 했어.",
      "나는 괜찮다고 생각해.",
      "응, 그렇게 하면 돼.",
    ];
    for (const input of dialogueCases) {
      const parts = parseUserMessageParts(input);
      assert.ok(
        parts.length >= 1 && parts.every((p) => p.kind === "dialogue"),
        `expected dialogue for ${JSON.stringify(input)}, got ${JSON.stringify(parts)}`
      );
    }
  });

  it("splits parenthetical boundary into action/thought + following clause", () => {
    assert.deepEqual(kindsAndPromptText("(갸웃)나는 렌이라고 부르면 돼."), [
      { kind: "action", prompt: "갸웃" },
      { kind: "dialogue", prompt: "나는 렌이라고 부르면 돼." },
    ]);
    assert.deepEqual(kindsAndPromptText("(끄덕)응."), [
      { kind: "action", prompt: "끄덕" },
      { kind: "dialogue", prompt: "응." },
    ]);
    assert.deepEqual(kindsAndPromptText("(미소)반가워."), [
      { kind: "action", prompt: "미소" },
      { kind: "dialogue", prompt: "반가워." },
    ]);
    assert.deepEqual(kindsAndPromptText("(왜 이러지?)괜찮아."), [
      { kind: "thought", prompt: "왜 이러지?" },
      { kind: "dialogue", prompt: "괜찮아." },
    ]);
    const nodThenApproach = kindsAndPromptText("(고개를 끄덕인다)그에게 다가갔다.");
    assert.equal(nodThenApproach.length, 2);
    assert.deepEqual(nodThenApproach[0], { kind: "action", prompt: "고개를 끄덕인다" });
    // Adjacent plain narration may stay action; "다가갔다" without a listed
    // narrative closing may remain dialogue — either split is acceptable.
    assert.ok(
      nodThenApproach[1].kind === "action" || nodThenApproach[1].kind === "dialogue"
    );
    assert.equal(nodThenApproach[1].prompt, "그에게 다가갔다.");
  });

  it("strips explicit wrappers from action/thought prompt text", () => {
    for (const input of ["(갸웃)", "[끄덕]", "*미소*"]) {
      const parts = parseUserMessageParts(input);
      assert.equal(parts.length, 1);
      assert.equal(parts[0].kind, "action");
      const prompt = promptTextForUserPart(parts[0]);
      assert.equal(/\(|\)|\[|\]|\*/.test(prompt), false, `wrapper leaked: ${prompt}`);
    }
  });
});

describe("userMessageParse cross-model outbound (no API)", () => {
  const models = [
    ["Opus 5", CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL],
    ["Gemini 3.1 Pro", CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL],
    ["DeepSeek V4 Pro", CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL],
    ["Terra", CHEAPER_INFERENCE_GPT_56_TERRA_MODEL],
  ] as const;

  for (const [label, modelId] of models) {
    it(`${label}: current user turn has stripped action + trailing dialogue, no literal (갸웃)`, () => {
      const built = buildContext({
        charName: "라이크",
        contentKind: "character",
        chunks: [],
        userNickname: "렌",
        personaDisplayName: "렌",
        userPersona: "이름/호칭: 렌\n성별: 남성",
        userPersonaGender: "male",
        shortTermHistory: [],
        currentUserMessage: EXACT_FIXTURE,
        nsfw: false,
        provider: "openrouter",
        modelId,
        narrativePov: { mode: "third_person", povCharacterName: "라이크" },
      });
      const current = built.history[built.history.length - 1]?.content ?? "";
      assert.equal(current.includes("(갸웃)"), false, `${label} leaked literal parentheses`);
      assert.match(current, /\[유저 지문\/행동 — 캐릭터가 관찰 가능\]\n갸웃/);
      assert.match(current, /\[유저 대사\]\n나는 렌이라고 부르면 돼\./);
    });
  }
});
