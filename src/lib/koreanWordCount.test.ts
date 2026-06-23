import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countKoreanWords } from "@/lib/koreanWordCount";

describe("countKoreanWords", () => {
  it("counts space-delimited Hangul eojeol", () => {
    assert.equal(countKoreanWords("그는 천천히 말했다."), 3);
  });

  it("splits on punctuation between Hangul runs", () => {
    assert.equal(countKoreanWords("안녕, 반가워!"), 2);
  });

  it("ignores HTML and counts visible Hangul only", () => {
    const text = `<div>그녀는</div> 조용히 숨을 내쉬었다.`;
    assert.equal(countKoreanWords(text), 4);
  });

  it("returns 0 for empty or non-Korean", () => {
    assert.equal(countKoreanWords(""), 0);
    assert.equal(countKoreanWords("hello world"), 0);
  });
});
