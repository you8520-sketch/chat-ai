import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasExplicitSpeakerAttributionBeforeQuote,
  isEligibleSpeechDialogue,
  isQuotedTermOrLabelNotSpeech,
} from "./chatImageSceneBrief";

describe("dialogue classification matrix Q1-Q7", () => {
  it("Q1: quoted term in narration is not speech", () => {
    const message = '라이크는 "살상 무기"라 불리는 검을 뽑았다.';
    const start = message.indexOf('"살상 무기"');
    const end = start + '"살상 무기"'.length;
    assert.equal(
      isQuotedTermOrLabelNotSpeech({ messageText: message, quoteStart: start, quoteEnd: end }),
      true
    );
    assert.equal(isEligibleSpeechDialogue("살상 무기", { messageText: message, quoteStart: start, quoteEnd: end }), false);
  });

  it("Q2-Q4: attributed or standalone quoted speech remains speech", () => {
    const q2 = '라이크: "살상 무기."';
    const q2Start = q2.indexOf('"살상 무기."');
    assert.equal(hasExplicitSpeakerAttributionBeforeQuote(q2, q2Start), true);
    assert.equal(isEligibleSpeechDialogue("살상 무기.", { messageText: q2, quoteStart: q2Start, quoteEnd: q2Start + 9 }), true);

    assert.equal(isEligibleSpeechDialogue("임무 완료."), true);
    assert.equal(isEligibleSpeechDialogue("작전 종료."), true);
    assert.equal(isEligibleSpeechDialogue("경고."), true);
  });

  it("Q5: sign label quote is not speech", () => {
    const message = '"접근 금지"라고 적힌 표지판';
    const start = message.indexOf('"접근 금지"');
    const end = start + '"접근 금지"'.length;
    assert.equal(
      isQuotedTermOrLabelNotSpeech({ messageText: message, quoteStart: start, quoteEnd: end }),
      true
    );
  });
});
