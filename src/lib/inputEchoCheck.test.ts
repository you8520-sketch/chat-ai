import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMsg } from "@/lib/ai";
import {
  checkPhraseOverlap,
  extractKeyPhrases,
  isAutoContinueDirectiveMessage,
  logInputEchoCheck,
  logInputEchoCheckForTurn,
  normalizeForEchoCheck,
} from "@/lib/inputEchoCheck";
import {
  buildServerUnderLengthRecoveryUserMessage,
  needsServerUnderLengthRecovery,
  resolveServerUnderLengthRecoveryFloor,
} from "@/lib/responseLength";

describe("inputEchoCheck", () => {
  it("normalizeForEchoCheck strips punctuation for overlap", () => {
    assert.equal(normalizeForEchoCheck("바지는 왜...??"), normalizeForEchoCheck("바지는 왜."));
  });

  it("detects echo despite punctuation mismatch (Turn 1 pattern)", () => {
    const user = "*약간 당황* 바지는 왜...?? *망연히*";
    const out =
      "에쉬의 손가락이 멈췄다. 바지는 왜. 렌의 물음이 귓속으로 스며들었다.";
    assert.equal(checkPhraseOverlap(user, out), true);
  });

  it("extractKeyPhrases pulls quoted user speech", () => {
    const phrases = extractKeyPhrases("좋아. 기분은 이상한데 나쁘진 않아.");
    assert.ok(phrases.some((p) => p.includes("기분은 이상한데")));
  });

  it("detects direct quote echo in opening", () => {
    const user = "좋아. 기분은 이상한데 나쁘진 않아.";
    const out = "백하율의 귓가에 렌의 말이 닿았다. 좋아. 기분은 이상한데 나쁘진 않아.";
    assert.equal(checkPhraseOverlap(user, out), true);
  });

  it("detects indirect echo pattern", () => {
    const user = "조금만 해";
    const out = "그 말이 귓속에서 맴돌았다. 백하율은 숨을 고르며";
    assert.equal(checkPhraseOverlap(user, out), true);
  });

  it("detects [B] action replay at opening (Turn 3 pattern)", () => {
    const user =
      "*조심스럽게 만져본다* 뜨겁다.... 엄청 커.... *그리고 천천히 입술을 가져다 대본다... 혀끝을 살짝 내밀어 스치듯 살짝 핥아본다*";
    const out =
      "에쉬의 숨이 멎었다.\n\n렌의 혀끝이 성기를 스쳤다. 젖은 감촉이 귀두 끝을 훑었다.";
    assert.equal(checkPhraseOverlap(user, out), true);
  });

  it("detects echo with spacing variants in speech", () => {
    const user = "히잉.... 나 도 해보고싶은데....";
    const out = "에쉬의 입술이 떨어졌다. 나도 해보고 싶은데. 렌의 목소리가";
    assert.equal(checkPhraseOverlap(user, out), true);
  });

  it("extractKeyPhrases includes *action* blocks", () => {
    const phrases = extractKeyPhrases("*조심스럽게 만져본다* hello");
    assert.ok(phrases.some((p) => p.includes("만져본다")));
  });

  it("isAutoContinueDirectiveMessage matches system wrapper", () => {
    assert.equal(
      isAutoContinueDirectiveMessage("[SYSTEM DIRECTIVE: CONTINUE THE NARRATIVE]\n- foo"),
      true
    );
    assert.equal(isAutoContinueDirectiveMessage("자동진행"), true);
    assert.equal(isAutoContinueDirectiveMessage("바지는 왜...??"), false);
  });

  it("logInputEchoCheckForTurn skips auto-continue turns", () => {
    const history: ChatMsg[] = [
      { role: "user", content: "hello rp" },
      { role: "assistant", content: "response" },
      {
        role: "user",
        content: "[SYSTEM DIRECTIVE: CONTINUE THE NARRATIVE]\n- continue",
      },
    ];
    const logs: unknown[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      if (args[0] === "[input-echo-check]") logs.push(args[1]);
    };
    try {
      logInputEchoCheckForTurn(history, "에쉬는 숨을 고르며");
    } finally {
      console.log = orig;
    }
    assert.equal(logs.length, 1);
    const row = logs[0] as Record<string, unknown>;
    assert.equal(row.skipped, "auto_continue");
    assert.equal(row.echoed_in_output, null);
  });

  it("logInputEchoCheck emits diagnostic object", () => {
    const logs: unknown[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      if (args[0] === "[input-echo-check]") logs.push(args[1]);
    };
    try {
      logInputEchoCheck("테스트 입력", "에쉬는 숨을 고르며");
    } finally {
      console.log = orig;
    }
    assert.equal(logs.length, 1);
    const row = logs[0] as Record<string, unknown>;
    assert.equal(row.echoed_in_output, false);
    assert.ok(Array.isArray(row.user_input_words));
  });
});

describe("server under-length recovery gate", () => {
  it("85% floor uses unified aim 3200 → 2720", () => {
    assert.equal(resolveServerUnderLengthRecoveryFloor(2400), 2720);
    assert.equal(resolveServerUnderLengthRecoveryFloor(3200), 2720);
  });

  it("needs recovery for clean stop below 85%", () => {
    assert.equal(needsServerUnderLengthRecovery("가".repeat(1600), "stop", 2400), true);
    assert.equal(needsServerUnderLengthRecovery("가".repeat(2800), "stop", 2400), false);
  });

  it("does not trigger on MAX_TOKENS", () => {
    assert.equal(needsServerUnderLengthRecovery("가".repeat(1000), "MAX_TOKENS", 2400), false);
  });

  it("recovery user message matches spec", () => {
    const msg = buildServerUnderLengthRecoveryUserMessage();
    assert.match(msg, /85%/);
    assert.match(msg, /unfinished scene phases/i);
    assert.match(msg, /deepen the current scene/i);
    assert.doesNotMatch(msg, /Scene Blueprint/);
  });
});
