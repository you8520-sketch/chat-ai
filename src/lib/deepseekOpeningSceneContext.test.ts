import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import {
  DEEPSEEK_OPENING_SCENE_CONTEXT_HEADER,
  buildDeepSeekOpeningSceneContextBlock,
  peelCreatorOpeningGreetingFromHistory,
  shouldRemapDeepSeekOpeningGreeting,
} from "@/lib/deepseekOpeningSceneContext";
import { messagesToTurns, rawRecentTurnsToHistory } from "@/lib/hybridMemory";

const GREETING_FIXTURE = [
  "*낡은 안전가옥 거실. 탁자 위에 식은 커피가 있다.*",
  "",
  "레온은 이미 방 안으로 들어와 문을 닫았다. 그는 낡은 손전등을 렌에게 건넸다.",
  "",
  '"여기서 기다려. 내가 밖의 동선을 확인하고 올 테니."',
].join("\n");

describe("deepseekOpeningSceneContext", () => {
  it("builds continuity context that keeps already-occurred meaning", () => {
    const block = buildDeepSeekOpeningSceneContextBlock(GREETING_FIXTURE);
    assert.match(block, new RegExp(DEEPSEEK_OPENING_SCENE_CONTEXT_HEADER.replace(/[[\]]/g, "\\$&")));
    assert.match(block, /이미 발생한 과거 맥락/);
    assert.match(block, /길이나 문장 수를 다음 답변 길이의 예시로 모방하지 않는다/);
    assert.match(block, /손전등을 렌에게 건넸다/);
    assert.match(block, /여기서 기다려/);
  });

  it("peels only synthetic opening pair; keeps real playable turns", () => {
    const history = rawRecentTurnsToHistory(
      messagesToTurns([
        { role: "assistant", content: GREETING_FIXTURE, model: "greeting" },
        { role: "user", content: "응." },
        { role: "assistant", content: "짧은 답.", model: "deepseek/deepseek-v4-pro" },
      ])
    );
    assert.equal(history[0]?.content, OPENING_TURN_USER);
    const peeled = peelCreatorOpeningGreetingFromHistory(history);
    assert.equal(peeled.peeledSyntheticOpeningTurn, true);
    assert.ok(peeled.openingGreeting?.includes("손전등을 렌에게 건넸다"));
    assert.equal(peeled.history.length, 2);
    assert.equal(peeled.history[0]?.role, "user");
    assert.equal(peeled.history[0]?.content, "응.");
    assert.equal(peeled.history[1]?.content, "짧은 답.");
  });

  it("does not peel ordinary short assistants without opening marker", () => {
    const history = [
      { role: "user" as const, content: "렌이 식탁에 앉았다." },
      { role: "assistant" as const, content: "짧은 시드 답변." },
    ];
    const peeled = peelCreatorOpeningGreetingFromHistory(history);
    assert.equal(peeled.openingGreeting, null);
    assert.equal(peeled.history.length, 2);
  });

  it("remap gate requires DeepSeek + thin + greeting", () => {
    assert.equal(
      shouldRemapDeepSeekOpeningGreeting({
        deepSeekXmlMode: true,
        shortHistory: true,
        openingGreeting: GREETING_FIXTURE,
      }),
      true
    );
    assert.equal(
      shouldRemapDeepSeekOpeningGreeting({
        deepSeekXmlMode: false,
        shortHistory: true,
        openingGreeting: GREETING_FIXTURE,
      }),
      false
    );
    assert.equal(
      shouldRemapDeepSeekOpeningGreeting({
        deepSeekXmlMode: true,
        shortHistory: false,
        openingGreeting: GREETING_FIXTURE,
      }),
      false
    );
  });
});
