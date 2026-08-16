import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import {
  applyWordCountOwnerSwap,
  assertWordCountAssembledDiff,
  VANILLA_LENGTH_PHRASE,
  WORD_COUNT_LENGTH_PHRASE,
  WORD_COUNT_OWNER_SENTENCE,
} from "./gemini37FlashWordCountOwnerE";

describe("Gemini 3.7 Flash experiment E — word-count owner swap", () => {
  it("keeps production USER_TAIL on 3,200자", () => {
    assert.match(USER_TAIL_LENGTH_OWNER_SENTENCE, /3,200자 이상/);
    assert.doesNotMatch(USER_TAIL_LENGTH_OWNER_SENTENCE, /1,100~1,500단어/);
  });

  it("swaps only the length phrase", () => {
    const userA = `나는 렌이라고…\n\n${USER_TAIL_LENGTH_OWNER_SENTENCE}`;
    const userB = applyWordCountOwnerSwap(userA);
    assert.equal(
      userB,
      `나는 렌이라고…\n\n${WORD_COUNT_OWNER_SENTENCE}`
    );
    assert.equal(
      userA.replaceAll(VANILLA_LENGTH_PHRASE, WORD_COUNT_LENGTH_PHRASE),
      userB
    );
  });

  it("assembled A/B diff is the phrase only", () => {
    const system = "SYSTEM RULES — no length owner";
    const historyA = [
      { role: "assistant", content: "인사." },
      {
        role: "user",
        content: `나는 렌이라고… 본 기억이 안 나는데… 나 알아?\n\n${USER_TAIL_LENGTH_OWNER_SENTENCE}`,
      },
    ];
    const historyB = [
      historyA[0]!,
      { role: "user", content: applyWordCountOwnerSwap(historyA[1]!.content) },
    ];
    const audit = assertWordCountAssembledDiff({
      systemA: system,
      systemB: system,
      historyA,
      historyB,
    });
    assert.equal(audit.systemDiff, 0);
    assert.equal(audit.historyPrefixDiff, 0);
    assert.equal(audit.ownerPositionDiff, 0);
    assert.equal(audit.ownerCountA, 1);
    assert.equal(audit.ownerCountB, 1);
    assert.equal(audit.currentUserDiffOnlyPhrase, true);
  });
});
