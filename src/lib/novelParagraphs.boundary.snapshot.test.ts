/**
 * Step 7.10 Commit A — renderer paragraph boundary snapshots.
 * Prompt / semantic rules are out of scope; this only locks display grouping.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyNovelParagraph,
  groupNovelParagraphs,
  normalizeAiNovelProseLayout,
} from "@/lib/novelParagraphs";

/** A — recent DB style: many sentence-level blank lines */
const FIXTURE_A_FRAGMENTED = `레온의 허리를 감싼 두 팔이, 돌아서려던 그의 몸을 완전히 멈춰 세웠다.

등판에 느껴지는 렌의 이마.

허리께를 감아 쥔 손의 온기.

코트 자락 너머로 전해지는 체온이 제복 아래 갈비뼈를 따라 스며들었다.

레온은 돌아서지 못했다.`;

/** B — legacy giant: no blank lines; renderer must not invent breaks */
const FIXTURE_B_GIANT =
  "별빛이 쏟아지는 언덕 위, 레온의 고백이 밤공기에 스며들고도 한참이 지났다. 렌은 레온의 어깨에 머리를 기댄 채로 가만히 별들을 올려다보고 있었다. 은하수가 하늘을 가로질러 흐르고, 별똥별 하나가 긴 꼬리를 그리며 사라졌다. 바람이 불 때마다 풀잎들이 은빛으로 일렁였다. 그런데 렌의 눈에는 별이 들어오지 않았다. 별보다 더 보고 싶은 것이 옆에 있었으니까. 그는 천천히 고개를 들어 레온의 옆모습을 바라보았다. 별빛이 흑발의 끝자락에 걸려 반짝이고 있었다.";

/** C — mixed dialogue / narration / single newline / blank line / fenced status block */
const FIXTURE_C_MIXED = `그는 천천히 다가왔다.
손끝이 떨렸다.

"아직…… 괜찮아?"

렌은 고개를 끄덕였다.

[STATUS]
HP 80 · 장소 언덕

다시 시선을 맞췄다.`;

describe("Step 7.10 Commit A — paragraph boundary snapshots", () => {
  it("A: preserves blank-line boundaries from fragmented recent-DB style", () => {
    const grouped = groupNovelParagraphs(FIXTURE_A_FRAGMENTED);
    assert.equal(grouped.length, 5);
    assert.deepEqual(grouped, [
      "레온의 허리를 감싼 두 팔이, 돌아서려던 그의 몸을 완전히 멈춰 세웠다.",
      "등판에 느껴지는 렌의 이마.",
      "허리께를 감아 쥔 손의 온기.",
      "코트 자락 너머로 전해지는 체온이 제복 아래 갈비뼈를 따라 스며들었다.",
      "레온은 돌아서지 못했다.",
    ]);
    assert.ok(Math.max(...grouped.map((p) => p.length)) < 80);
    const normalized = normalizeAiNovelProseLayout(FIXTURE_A_FRAGMENTED);
    assert.match(normalized, /세웠다\.\n\n등판에/);
    assert.doesNotMatch(normalized, /세웠다\. 등판에/);
  });

  it("B: does not invent paragraph breaks inside a giant no-blank-line block", () => {
    const grouped = groupNovelParagraphs(FIXTURE_B_GIANT);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0], FIXTURE_B_GIANT);
    assert.ok(grouped[0]!.length > 180);
    assert.equal(grouped[0]!.includes("\n\n"), false);
  });

  it("C: keeps dialogue, narration, single-newline join, blank lines, and status block boundaries", () => {
    const grouped = groupNovelParagraphs(FIXTURE_C_MIXED);
    // Single \\n inside a blank-line block joins; \\n\\n boundaries stay separate.
    assert.deepEqual(grouped, [
      "그는 천천히 다가왔다. 손끝이 떨렸다.",
      '"아직 ... 괜찮아?"',
      "렌은 고개를 끄덕였다.",
      "[STATUS] HP 80 · 장소 언덕",
      "다시 시선을 맞췄다.",
    ]);
    assert.equal(classifyNovelParagraph(grouped[1]!), "dialogue");
    assert.equal(classifyNovelParagraph(grouped[0]!), "narration");
    assert.equal(classifyNovelParagraph(grouped[2]!), "narration");
    assert.equal(grouped.length, 5);
  });
});
