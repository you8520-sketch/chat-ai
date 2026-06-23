import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupNovelParagraphs, MIN_NARRATION_CHARS_PER_PARAGRAPH, MAX_NARRATION_CHARS_PER_PARAGRAPH } from "@/lib/novelParagraphs";

describe("groupNovelParagraphs merge", () => {
  it("merges blank-line-separated short narration into one paragraph", () => {
    const input = `그는 다가왔다.

손을 뻗었다.

시선을 맞췄다.`;
    assert.deepEqual(groupNovelParagraphs(input), [
      "그는 다가왔다. 손을 뻗었다. 시선을 맞췄다.",
    ]);
  });

  it("keeps dialogue separate from narration paragraphs", () => {
    const input = `백하율은 렌이 내민 손을 마주 잡으며 천천히 손가락을 깍지 꼈다. 일부러 느리게, 한 마디 한 마디가 미끄러지듯 맞물리게. 입가에는 능글맞은 미소가 걸려 있었지만, 금빛 눈동자는 진지하게 렌의 얼굴을 응시했다. "아직…… 조금 아파요."`;
    const grouped = groupNovelParagraphs(input);
    assert.equal(grouped.length, 2);
    assert.doesNotMatch(grouped[0]!, /"아직/);
    assert.match(grouped[1]!, /"아직/);
  });

  it("splits embedded dialogue from end of narration block", () => {
    const input = `그녀는 천천히 다가왔고, 손끝이 떨리는 것을 숨기려 애썼다. 눈빛만은 굳건했지만, 입술은 이미 말을 삼키고 있었다. "미안해."`;
    const grouped = groupNovelParagraphs(input);
    assert.ok(grouped.length >= 2);
    assert.doesNotMatch(grouped[0]!, /"미안해/);
  });
  it("splits oversized narration at sentence boundaries", () => {
    const sentence =
      "그는 천천히 다가와 손을 뻗었고, 눈빛만은 흔들리지 않았으며, 숨결마저 조심스럽게 맞추었다.";
    const input = Array.from({ length: 12 }, () => sentence).join(" ");
    assert.ok(input.length > MAX_NARRATION_CHARS_PER_PARAGRAPH);
    const grouped = groupNovelParagraphs(input);
    assert.ok(grouped.length >= 2);
    for (const para of grouped) {
      assert.ok(para.length <= MAX_NARRATION_CHARS_PER_PARAGRAPH + 20);
    }
  });
});

describe("MIN_NARRATION_CHARS_PER_PARAGRAPH", () => {
  it("is 50", () => {
    assert.equal(MIN_NARRATION_CHARS_PER_PARAGRAPH, 50);
  });
});

describe("MAX_NARRATION_CHARS_PER_PARAGRAPH", () => {
  it("is 480", () => {
    assert.equal(MAX_NARRATION_CHARS_PER_PARAGRAPH, 480);
  });
});
