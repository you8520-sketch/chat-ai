import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyNovelParagraph,
  formatNovelProseForDisplay,
  groupExtremeFragmentedNarrationForDisplay,
  groupNovelParagraphs,
  resolveNovelDisplayParagraphs,
} from "@/lib/novelParagraphs";

const EXTREME_FRAGMENTED = `레온은 문틈 앞에서 멈춰 서며 낮게 숨을 골랐다.

그가 손을 들자 오래된 경첩이 느린 소리를 내며 밀려났다.

이어 어두운 복도 안쪽에서 차가운 바람이 흘러나와 코트 끝을 흔들었다.

다시 그의 시선이 바닥의 긴 긁힌 자국을 따라 천천히 옮겨 갔다.

그리고 문 너머에서 물방울이 떨어지는 작은 소리가 귓가를 스쳤다.

하지만 레온은 물러서지 않고 한 걸음 더 안으로 들어갔다.`;

function maxConsecutiveSingleSentenceNarration(paragraphs: string[]): number {
  let max = 0;
  let current = 0;
  for (const paragraph of paragraphs) {
    const single =
      classifyNovelParagraph(paragraph) === "narration" &&
      (paragraph.match(/[.!?](?=\s|$)/g) ?? []).length <= 1;
    current = single ? current + 1 : 0;
    max = Math.max(max, current);
  }
  return max;
}

describe("extreme fragmentation display fallback", () => {
  it("groups a local short-narration run without a whole-document gate", () => {
    const rawGrouped = groupNovelParagraphs(EXTREME_FRAGMENTED);
    const displayed = formatNovelProseForDisplay(EXTREME_FRAGMENTED);

    assert.equal(rawGrouped.length, 6, "raw/group path remains sentence-fragmented");
    assert.ok(displayed.length < rawGrouped.length);
    assert.ok(maxConsecutiveSingleSentenceNarration(displayed) < 5);
    assert.ok(displayed.every((paragraph) => paragraph.length <= 360));
    assert.equal(
      displayed.join("").replace(/\s/g, ""),
      rawGrouped.join("").replace(/\s/g, ""),
      "grouping changes whitespace boundaries only"
    );
  });

  it("groups four short narration fragments locally (no 5+ document gate)", () => {
    const four = EXTREME_FRAGMENTED.split(/\n{2,}/).slice(0, 4).join("\n\n");
    const displayed = resolveNovelDisplayParagraphs(four);
    assert.ok(displayed.length < groupNovelParagraphs(four).length);

    const normal = Array.from(
      { length: 5 },
      (_, i) => `자연스러운 문단 ${i + 1}이다. 이미 두 번째 문장이 함께 있다.`
    );
    assert.deepEqual(groupExtremeFragmentedNarrationForDisplay(normal), normal);
  });

  it("keeps dialogue, HTML, status widgets, code, and lists outside grouping", () => {
    const protectedParagraphs = [
      "첫 번째 지문이다.",
      "둘째 지문이다.",
      "셋째 지문이다.",
      "넷째 지문이다.",
      "다섯째 지문이다.",
      '"누구야?"',
      "<section>상태</section>",
      "[STATUS]\nHP 80",
      "```ts\nconst x = 1;\n```",
      "- 목록 항목",
    ];
    const displayed = groupExtremeFragmentedNarrationForDisplay(protectedParagraphs);

    assert.equal(displayed.filter((p) => classifyNovelParagraph(p) === "dialogue").length, 1);
    for (const protectedParagraph of protectedParagraphs.slice(6)) {
      assert.ok(displayed.includes(protectedParagraph));
    }
  });

  it("keeps at most two consecutive short emphasis paragraphs and folds later ones forward", () => {
    const paragraphs = [
      "그리고 그것이 시작되었다.",
      "그 사실은 죽음이었다.",
      "그것의 정체였다.",
      "이어 벽 너머의 기척이 조금씩 가까워졌다.",
      "다시 차가운 공기가 발목 주위를 감싸기 시작했다.",
      "그리고 어둠 속에서 눈동자 두 개가 천천히 떠올랐다.",
    ];
    const displayed = groupExtremeFragmentedNarrationForDisplay(paragraphs);

    assert.equal(displayed[0], paragraphs[0]);
    assert.equal(displayed[1], paragraphs[1]);
    assert.ok(displayed.some((paragraph) => paragraph.includes(paragraphs[2]!) && paragraph.includes(paragraphs[3]!)));
  });

  it("stops merging at time/space transitions and an explicitly changed actor", () => {
    const paragraphs = [
      "레온은 다친 손을 조심스럽게 들어 올렸다.",
      "그가 손끝을 펼자 얇은 빛이 가볍게 흘러나왔다.",
      "그 시각 문밖에서 무거운 발소리가 멈춰 섬을 울렸다.",
      "렌은 손을 문고리 위에 올리고 잠시 숨을 멈췄다.",
      "그녀가 조심스럽게 문을 밀자 차가운 바람이 안으로 밀려들었다.",
      "이어 두 사람의 그림자가 복도 안쪽으로 길게 늘어졌다.",
    ];
    const displayed = groupExtremeFragmentedNarrationForDisplay(paragraphs);

    assert.ok(!displayed.some((paragraph) => paragraph.includes(paragraphs[1]!) && paragraph.includes(paragraphs[2]!)));
    assert.ok(!displayed.some((paragraph) => paragraph.includes(paragraphs[2]!) && paragraph.includes(paragraphs[3]!)));
  });

  it("uses identical grouping for the last streaming frame and final display without mutating raw", () => {
    const raw = EXTREME_FRAGMENTED;
    const firstFour = raw.split(/\n{2,}/).slice(0, 4).join("\n\n");
    const previous = resolveNovelDisplayParagraphs(firstFour, { streaming: true });
    const streaming = resolveNovelDisplayParagraphs(raw, {
      streaming: true,
      previousStreamingParagraphs: previous,
    });
    const final = resolveNovelDisplayParagraphs(raw);

    assert.deepEqual(streaming, final);
    assert.equal(raw, EXTREME_FRAGMENTED);
    assert.equal(groupNovelParagraphs(raw).length, 6);
  });

  it("prefix-stable: closed run before dialogue does not rematerialize when more text arrives", () => {
    const prefix = `그의 목소리가 낮아졌다.

의심하는 건 아니었다.

그냥 순수한 호기심이었다.

"솔직히 말해봐."`;
    const full = `${prefix}

태형이 한 걸음 물러났다.

복도 끝에서 호출음이 울렸다.

그는 고개를 돌렸다.`;

    const prefixDisplay = formatNovelProseForDisplay(prefix);
    const fullDisplay = formatNovelProseForDisplay(full);
    assert.deepEqual(fullDisplay.slice(0, prefixDisplay.length), prefixDisplay);
  });
});
