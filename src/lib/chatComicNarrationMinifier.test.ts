import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMIC_NARRATION_MAX_CHARS,
  COMIC_NARRATION_STYLE,
  COMIC_PAGE_MAX_NARRATIONS,
  minifyComicNarration,
  renderComicNarrationProviderContract,
  resolveComicNarrationSlots,
} from "./chatComicNarrationMinifier";

describe("chatComicNarrationMinifier", () => {
  it("NARR-1 long novel-style prose fixture minifies to one short sentence ≤ 40 chars", () => {
    const longProse =
      "렌은 오랫동안 창밖으로 흐르는 비를 바라보며 그날의 일을 곱씹었다. 심장이 덜컹 내려앉는 기분이었고, 방 안의 공기는 차갑고 무거웠다. 그리고 천천히 숨을 내쉬며 결심을 굳혔다.";
    const minified = minifyComicNarration(longProse);
    assert.ok(minified.length > 0);
    assert.ok(minified.length <= COMIC_NARRATION_MAX_CHARS, `length ${minified.length} <= 40`);
    // One sentence only — no second sentence-end boundary followed by content.
    assert.doesNotMatch(minified, /[.!?…。！？]\s+\S/u);
  });

  it("NARR-2 hard cap applies even when the first sentence is very long", () => {
    const veryLongFirst =
      "어느 가을 저녁, 도시의 불빛이 창문 너머로 은은하게 번져 오는 가운데 두 사람은 오랜 시간 동안 서로의 마음을 확인하지 못한 채 침묵 속에서 서로를 바라보았다. 그리고 드디어 말문을 열었다.";
    const minified = minifyComicNarration(veryLongFirst);
    assert.ok(minified.length <= COMIC_NARRATION_MAX_CHARS);
    assert.ok(minified.length > 30, "hard cap kicked in (was ~90 chars, now near the 40 cap)");
  });

  it("NARR-3 short plain key event stays as-is and strips dialogue markers", () => {
    assert.equal(minifyComicNarration("밤이 깊어졌다."), "밤이 깊어졌다");
    assert.equal(minifyComicNarration("“조용히 있자.”"), "조용히 있자");
  });

  it("NARR-4 page narration slots capped at 2 across four silent panels", () => {
    const slots = resolveComicNarrationSlots({
      panels: [1, 2, 3, 4].map((index) => ({
        index,
        narrationBoxNeeded: true,
        dialogueCount: 0,
        situation: `시각 ${index}: 두 사람이 침묵 속에서 서로를 바라보며 긴 시간 동안 어떤 말도 나누지 못하고 있다.`,
      })),
    });
    assert.equal(slots.length, COMIC_PAGE_MAX_NARRATIONS);
    assert.deepEqual(
      slots.map((slot) => slot.panelIndex),
      [1, 2]
    );
    for (const slot of slots) {
      assert.ok(slot.text.length <= COMIC_NARRATION_MAX_CHARS);
    }
  });

  it("NARR-5 dialogue-carrying panels omit narration", () => {
    const slots = resolveComicNarrationSlots({
      panels: [
        { index: 1, narrationBoxNeeded: true, dialogueCount: 2, situation: "밤이 깊어졌다." },
        { index: 2, narrationBoxNeeded: true, dialogueCount: 0, situation: "그는 창밖을 바라본다." },
      ],
    });
    assert.deepEqual(
      slots.map((slot) => slot.panelIndex),
      [2],
      "panel with dialogue must not receive narration"
    );
  });

  it("NARR-6 narration style is minimal_timeline_summary and the contract is provider-visible", () => {
    assert.equal(COMIC_NARRATION_STYLE, "minimal_timeline_summary");
    const contract = renderComicNarrationProviderContract();
    assert.match(contract, /Use narration sparingly/i);
    assert.match(contract, /minimal timeline summary/i);
    assert.match(contract, /Do not paste long prose paragraphs/i);
  });
});