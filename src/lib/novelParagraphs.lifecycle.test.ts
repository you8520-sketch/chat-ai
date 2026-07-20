/**
 * Paragraph lifecycle regression fixtures (A–G).
 * Display policy only — does not mutate canonical/DB raw.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getCanonicalProseBody,
  getDisplayAlignedCanonicalProseBody,
  normalizeEditedProseForSave,
  resolveAssistantEditInitialValue,
} from "@/lib/canonicalProse";
import {
  classifyNovelParagraph,
  formatNovelProseForDisplay,
  groupNovelParagraphs,
  resolveNovelDisplayParagraphs,
  splitCommittedAndOpenTipDisplay,
  stabilizeStreamingNovelParagraphs,
} from "@/lib/novelParagraphs";

/** A — 3 short narrations + dialogue + trailing narrations */
const FIXTURE_A_THREE_PLUS_DIALOGUE = `그의 목소리가 낮아졌다.

의심하는 건 아니었다.

그냥 순수한 호기심이었다.

"솔직히 말해봐."

태형이 한 걸음 물러났다.

복도 끝에서 호출음이 울렸다.

그는 고개를 돌렸다.`;

/** B — 2–4 short narration run (must still group) */
const FIXTURE_B_THREE_SHORT = `레온의 목소리는 무거웠다.

그는 천천히 고개를 들었다.

의심하는 건 아니었다.`;

/** C — natural multi-sentence paragraphs */
const FIXTURE_C_NORMAL = `태형이 다가섰다. 두 사람의 거리가 가까워졌다. 그가 고개를 숙이자 검은 피어싱이 빛났다.

"솔직히 말해봐."

그의 목소리가 낮아졌다. 의심하는 건 아니었다. 그냥 순수한 호기심이었다.`;

/** Older extreme RP fixture */
const FIXTURE_LEGACY_FRAGMENTED = `태형이 다가섰다.

두 사람의 거리가 가까워졌다.

그가 고개를 숙였다.

검은 피어싱이 빛났다.

"솔직히 말해봐."

그의 목소리가 낮아졌다.

의심하는 건 아니었다.

그냥 순수한 호기심.`;

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

function feedChunks(raw: string, cuts: number[]): string[] {
  const frames: string[] = [];
  let acc = "";
  let prev = 0;
  for (const cut of [...cuts].filter((c) => c > 0 && c < raw.length).sort((a, b) => a - b)) {
    acc += raw.slice(prev, cut);
    frames.push(acc);
    prev = cut;
  }
  if (prev < raw.length) frames.push(raw);
  return frames;
}

function streamAll(raw: string, cuts: number[]): string[] {
  let previous: string[] = [];
  for (const frame of feedChunks(raw, cuts)) {
    previous = resolveNovelDisplayParagraphs(frame, {
      streaming: true,
      previousStreamingParagraphs: previous,
    });
  }
  return previous;
}

describe("paragraph lifecycle fixtures A–G", () => {
  it("A: 3 narration fragments + dialogue group locally; dialogue stays standalone", () => {
    const rawGrouped = groupNovelParagraphs(FIXTURE_A_THREE_PLUS_DIALOGUE);
    const displayed = formatNovelProseForDisplay(FIXTURE_A_THREE_PLUS_DIALOGUE);

    assert.ok(rawGrouped.length >= 7);
    assert.ok(displayed.length < rawGrouped.length);
    assert.ok(maxConsecutiveSingleSentenceNarration(displayed) < 4);
    assert.ok(displayed.some((p) => classifyNovelParagraph(p) === "dialogue"));
    assert.ok(
      displayed.some(
        (p) =>
          p.includes("목소리가 낮아졌다") &&
          p.includes("의심하는 건 아니었다") &&
          p.includes("순수한 호기심")
      )
    );
    const dialogueIdx = displayed.findIndex((p) => /^["“]/.test(p.trim()));
    assert.ok(dialogueIdx > 0);
    assert.match(displayed[dialogueIdx]!, /^["“]/);
  });

  it("B: 2–4 short narration run still groups without a 5+ gate", () => {
    const rawGrouped = groupNovelParagraphs(FIXTURE_B_THREE_SHORT);
    const displayed = formatNovelProseForDisplay(FIXTURE_B_THREE_SHORT);
    assert.equal(rawGrouped.length, 3);
    assert.ok(displayed.length < 3);
    assert.ok(displayed[0]!.includes("목소리는 무거웠다"));
    assert.ok(displayed[0]!.includes("고개를 들었다") || displayed.length === 1);
  });

  it("C: normal multi-sentence paragraphs are not force-merged or re-split", () => {
    const rawGrouped = groupNovelParagraphs(FIXTURE_C_NORMAL);
    const displayed = formatNovelProseForDisplay(FIXTURE_C_NORMAL);
    assert.deepEqual(displayed, rawGrouped);
    assert.equal(displayed.length, 3);
    assert.equal(classifyNovelParagraph(displayed[1]!), "dialogue");
  });

  it("D: prefix stability — format(P) is a prefix of format(P+Q)", () => {
    const p = `그의 목소리가 낮아졌다.

의심하는 건 아니었다.

그냥 순수한 호기심이었다.

"솔직히 말해봐."`;
    const q = `

태형이 한 걸음 물러났다.

복도 끝에서 호출음이 울렸다.`;
    const prefixDisplay = formatNovelProseForDisplay(p);
    const fullDisplay = formatNovelProseForDisplay(p + q);
    assert.deepEqual(fullDisplay.slice(0, prefixDisplay.length), prefixDisplay);

    const { committed } = splitCommittedAndOpenTipDisplay(p + q);
    assert.deepEqual(committed.slice(0, prefixDisplay.length), prefixDisplay);
  });

  it("E: chunk-boundary matrix yields identical final display", () => {
    const raw = FIXTURE_A_THREE_PLUS_DIALOGUE;
    const final = formatNovelProseForDisplay(raw);
    const cutSets: number[][] = [
      [3, 12, 40, 80, 120, 200],
      [...raw.matchAll(/\./g)].map((m) => (m.index ?? 0) + 1),
      [...raw.matchAll(/\n/g)].map((m) => (m.index ?? 0) + 1),
      [...raw.matchAll(/\n\n/g)].map((m) => (m.index ?? 0) + 1),
      [...raw.matchAll(/\n\n/g)].map((m) => (m.index ?? 0) + 2),
      [raw.indexOf('"'), raw.indexOf('"') + 1, raw.indexOf("\n\n태형")],
    ];

    for (const cuts of cutSets) {
      const streamed = streamAll(raw, cuts);
      assert.deepEqual(streamed, final, `cuts=${cuts.filter((c) => c > 0 && c < raw.length).join(",")}`);
      assert.deepEqual(resolveNovelDisplayParagraphs(raw), final);
    }
  });

  it("F: no retroactive jump — committed prefix immutable across chunks", () => {
    const raw = FIXTURE_A_THREE_PLUS_DIALOGUE;
    const cuts = [...raw.matchAll(/\n\n/g)].map((m) => (m.index ?? 0) + 2);
    let previous: string[] = [];
    const snapshots: string[][] = [];
    for (const frame of feedChunks(raw, cuts)) {
      previous = resolveNovelDisplayParagraphs(frame, {
        streaming: true,
        previousStreamingParagraphs: previous,
      });
      snapshots.push(previous.slice());
    }

    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1]!;
      const cur = snapshots[i]!;
      if (prev.length <= 1) continue;
      const frozen = prev.slice(0, -1);
      assert.deepEqual(
        cur.slice(0, frozen.length),
        frozen,
        `committed prefix changed at snapshot ${i}`
      );
    }

    assert.deepEqual(previous, formatNovelProseForDisplay(raw));
  });

  it("G: Edit keeps canonical raw newlines while display may merge", () => {
    const dbRaw = "AAA\nBBB\n\nCCC";
    assert.equal(resolveAssistantEditInitialValue({ content: dbRaw }), dbRaw);

    const fragmented = FIXTURE_LEGACY_FRAGMENTED;
    const editValue = resolveAssistantEditInitialValue({ content: fragmented });
    const displayJoined = getDisplayAlignedCanonicalProseBody(fragmented);
    assert.equal(editValue, getCanonicalProseBody(fragmented));
    assert.equal(editValue, fragmented);
    assert.ok(editValue.split(/\n{2,}/).length > displayJoined.split(/\n{2,}/).length);
    assert.equal(normalizeEditedProseForSave(editValue), fragmented);
  });

  it("legacy fragmented RP softens and keeps dialogue standalone", () => {
    const displayed = formatNovelProseForDisplay(FIXTURE_LEGACY_FRAGMENTED);
    assert.ok(displayed.length < groupNovelParagraphs(FIXTURE_LEGACY_FRAGMENTED).length);
    assert.ok(displayed.some((p) => classifyNovelParagraph(p) === "dialogue"));
    assert.ok(maxConsecutiveSingleSentenceNarration(displayed) < 5);
  });

  it("stabilize keeps frozen prefix when tip grows with matching identity", () => {
    const previous = ["고정 문단.", "자라는"];
    const next = ["고정 문단.", "자라는 중."];
    assert.deepEqual(stabilizeStreamingNovelParagraphs(previous, next), next);
  });
});
