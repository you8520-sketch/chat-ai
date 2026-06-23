import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampThoughtContent,
  EMPTY_MEMORY_META,
  formatMemoryMetaForPrompt,
  isLikelySituationSummary,
  normalizeThoughtEntry,
  THOUGHT_CONTENT_HARD_MAX_CHARS,
  THOUGHT_CONTENT_MAX_CHARS,
} from "@/lib/chatMemory";

const names = { charName: "서연", userName: "민수" };

describe("formatMemoryMetaForPrompt", () => {
  it("uses soft priority framing without mandatory 반드시", () => {
    const result = formatMemoryMetaForPrompt({
      ...EMPTY_MEMORY_META,
      honorifics: ["백하율→렌: 가이드님"],
      thoughts: ["백하율: 렌이 내 손을 잡는다고 진짜로 나아질까?"],
    });
    assert.ok(result);
    assert.match(result!, /\[Memory — 참고, 우선순위 2순위 하위\]/);
    assert.match(result!, /^관계:\n호칭:/m);
    assert.doesNotMatch(result!, /반드시 반영/);
  });
});

describe("clampThoughtContent", () => {
  it("truncates long text at word or punctuation boundary", () => {
    const long =
      "왜 이렇게까지 떨리는 건지 모르겠어 정말 이상하고 도저히 참을 수가 없어";
    const result = clampThoughtContent(long);
    assert.ok(result.length <= THOUGHT_CONTENT_HARD_MAX_CHARS);
    assert.ok(result.length < long.length);
    assert.ok(result.startsWith("왜 이렇게까지"));
  });

  it("extends past 40 chars to complete the sentence", () => {
    const long =
      "렌의 손목에서 전해지는 규칙적인 맥박이 백하율의 난폭해진 심장을 천천히 가라앉혀";
    const result = clampThoughtContent(long);
    assert.ok(result.length > THOUGHT_CONTENT_MAX_CHARS);
    assert.ok(result.length <= THOUGHT_CONTENT_HARD_MAX_CHARS);
    assert.match(result, /가라앉혀$/);
    assert.doesNotMatch(result, /(?:을|를|은|는)$/);
  });

  it("keeps text under hard max when no clean cut exists", () => {
    const text = "평소처럼 장난스러운 미소를 덧붙여 농담이라고 빼버릴 수도";
    const result = clampThoughtContent(text);
    assert.equal(result, text);
    assert.ok(result.length <= THOUGHT_CONTENT_HARD_MAX_CHARS);
  });

  it("collapses whitespace and trims", () => {
    assert.equal(clampThoughtContent("  왜   이렇게   떨리지  "), "왜 이렇게 떨리지");
  });
});

describe("isLikelySituationSummary", () => {
  it("rejects summary-like strings", () => {
    assert.equal(isLikelySituationSummary("그는 경계하며 대답했다"), true);
    assert.equal(isLikelySituationSummary("캐릭터가 놀랐다 · 유저에게 질문함"), true);
    assert.equal(isLikelySituationSummary("서연, 민수에게 말을 건넸다"), true);
    assert.equal(isLikelySituationSummary("유저가 말한 대로 행동했다"), true);
  });

  it("accepts short inner monologue", () => {
    assert.equal(isLikelySituationSummary("왜 이렇게 떨리지"), false);
    assert.equal(isLikelySituationSummary("숨기면 안 되는데"), false);
  });
});

describe("normalizeThoughtEntry", () => {
  it("drops summary-like thoughts", () => {
    assert.equal(normalizeThoughtEntry("서연: 그는 경계하며 대답했다", names), "");
    assert.equal(normalizeThoughtEntry("서연: 캐릭터가 놀랐다 · 유저에게 질문함", names), "");
  });

  it("clamps good inner thoughts and keeps name prefix", () => {
    const long = `서연: ${"왜 이렇게까지 떨리는 건지 ".repeat(3)}`;
    const result = normalizeThoughtEntry(long, names);
    assert.ok(result.startsWith("서연: "));
    const content = result.slice("서연: ".length);
    assert.ok(content.length <= THOUGHT_CONTENT_HARD_MAX_CHARS);
    assert.equal(isLikelySituationSummary(content), false);
  });

  it("keeps short valid inner thoughts", () => {
    assert.equal(normalizeThoughtEntry("서연: 왜 이렇게 떨리지", names), "서연: 왜 이렇게 떨리지");
  });
});
