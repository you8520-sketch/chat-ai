import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collapseEllipsisSpam,
  normalizeAiNovelProseLayout,
  normalizePauseMarksInText,
  replaceEllipsisWithPauseDash,
  stripEllipsisFromDialogueBody,
} from "@/lib/novelParagraphs";

describe("collapseEllipsisSpam", () => {
  it("collapses repeated ellipsis-only lines to ...", () => {
    assert.equal(collapseEllipsisSpam("…….\n…….\n……."), "...");
  });

  it("converts ...... to ... in dialogue", () => {
    assert.equal(
      collapseEllipsisSpam('"솔직히 말하면...... 별로 안 나아졌어요."'),
      '"솔직히 말하면 ... 별로 안 나아졌어요."'
    );
  });

  it("converts unicode ellipsis to ... in dialogue", () => {
    assert.equal(
      collapseEllipsisSpam('"렌 님…… 안아줘요."'),
      '"렌 님 ... 안아줘요."'
    );
    assert.equal(collapseEllipsisSpam('"미안해...."'), '"미안해 ..."');
  });

  it("keeps separate pause marks in narration", () => {
    assert.equal(
      collapseEllipsisSpam("나는…… 그게…… 조금 당황스러워서."),
      "나는 ... 그게 ... 조금 당황스러워서."
    );
  });
});

describe("normalizePauseMarksInText", () => {
  it("forbids ...... and keeps ...", () => {
    assert.equal(normalizePauseMarksInText("......"), "...");
    assert.equal(normalizePauseMarksInText("솔직히...... 별로"), "솔직히 ... 별로");
    assert.equal(stripEllipsisFromDialogueBody("솔직히…… 별로"), "솔직히 ... 별로");
  });

  it("allows consecutive ... or ──", () => {
    assert.equal(normalizePauseMarksInText("미안... ... 그게"), "미안 ... ... 그게");
    assert.equal(normalizePauseMarksInText("미안 ── ── 그게"), "미안 ── ── 그게");
    assert.equal(normalizePauseMarksInText("미안 ── ... 그게"), "미안 ── ... 그게");
  });

  it("replaceEllipsisWithPauseDash delegates to normalizePauseMarksInText", () => {
    assert.equal(replaceEllipsisWithPauseDash("......"), "...");
  });
});

describe("normalizeAiNovelProseLayout ellipsis", () => {
  it("normalizes dialogue ellipsis without forcing ──", () => {
    const input = '"솔직히 말하면...... 별로."\n\n"렌 님…… 안아줘요."';
    const out = normalizeAiNovelProseLayout(input);
    assert.doesNotMatch(out, /……|\.\.\.\.\.\./);
    assert.match(out, /솔직히 말하면 \.\.\. 별로/);
    assert.match(out, /렌 님 \.\.\. 안아줘요/);
  });

  it("keeps pause on consecutive dialogue paragraphs", () => {
    const input = [
      '"첫 번째 ... 대사."',
      '"두 번째 ── 대사."',
      "지문 문단입니다. 충분히 길게 쓴 서술이 이어집니다. 행동과 감정이 묶여 있습니다.",
      '"세 번째 ... 대사."',
    ].join("\n\n");
    const out = normalizeAiNovelProseLayout(input);
    assert.match(out, /첫 번째 \.\.\. 대사/);
    assert.match(out, /두 번째 ── 대사/);
    assert.match(out, /세 번째 \.\.\. 대사/);
  });
});
