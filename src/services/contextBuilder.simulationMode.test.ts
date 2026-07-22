import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContext } from "./contextBuilder";

describe("contextBuilder simulation owner", () => {
  it("injects one ensemble owner in interactive simulation chat", () => {
    const built = buildContext({
      charName: "회색 생태권",
      contentKind: "simulation",
      chunks: [],
      systemPrompt: "[SIMULATION CAST — CREATOR CANON]\n[서윤]\n- 경비 책임자",
      world: "폐쇄 격리구역",
      userNickname: "렌",
      shortTermHistory: [],
      currentUserMessage: "문을 살핀다.",
      nsfw: false,
      provider: "openrouter",
    });
    assert.equal((built.systemPrompt.match(/\[SIMULATION MODE — ENSEMBLE CAST\]/g) ?? []).length, 1);
    assert.match(built.systemPrompt, /유저 페르소나는 \[AI_CAST\]가 아니다/);
  });

  it("does not change ordinary character chat", () => {
    const built = buildContext({
      charName: "서윤",
      contentKind: "character",
      chunks: [],
      userNickname: "렌",
      shortTermHistory: [],
      currentUserMessage: "안녕.",
      nsfw: false,
      provider: "openrouter",
    });
    assert.doesNotMatch(built.systemPrompt, /\[SIMULATION MODE — ENSEMBLE CAST\]/);
  });
});
