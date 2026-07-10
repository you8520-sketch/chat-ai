import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupNovelParagraphs,
  formatAiProseForEditTextarea,
  MIN_NARRATION_CHARS_PER_PARAGRAPH,
  MAX_NARRATION_CHARS_PER_PARAGRAPH,
  MAX_NARRATION_MERGE_CHARS,
} from "@/lib/novelParagraphs";

describe("groupNovelParagraphs merge", () => {
  it("preserves blank-line-separated narration as separate paragraphs (Step 7.10)", () => {
    const input = `그는 다가왔다.

손을 뻗었다.

시선을 맞췄다.`;
    assert.deepEqual(groupNovelParagraphs(input), [
      "그는 다가왔다.",
      "손을 뻗었다.",
      "시선을 맞췄다.",
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
  it("does not force-split long narration by character count", () => {
    const sentence =
      "그는 천천히 다가와 손을 뻗었고, 눈빛만은 흔들리지 않았으며, 숨결마저 조심스럽게 맞추었다.";
    const input = Array.from({ length: 18 }, () => sentence).join(" ");
    assert.ok(input.length > MAX_NARRATION_CHARS_PER_PARAGRAPH);
    const grouped = groupNovelParagraphs(input);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0], input);
  });

  it("does not merge flowing narration across blank lines (Step 7.10)", () => {
    const a =
      "아니, 마음에 든다는 말로는 부족했다. 그의 시선이 렌의 어깨선을 타고 천천히 내려갔다. 섬세한 자수가 빛나는 천의 질감, 그리고 그 아래로 이어지는 선.";
    const b =
      "등이 깊게 파인 그 디자인이, 오직 자신을 향한 마음으로 선택되었다는 것. 그 생각만으로 레온의 심장은 요동쳤고, 동시에 가슴 한복판이 칼로 도려내는 듯한 아픔에 휩싸였다. 그는 자신의 코트 자락을 양쪽으로 벌려, 렌의 몸을 그 안으로 끌어당겼다.";
    const prefix = Array.from({ length: 6 }, () =>
      "레온은 그 눈빛을 정면으로 마주했다. 그리고 입을 열려다, 말을 잃었다. 그가 무슨 말을 할 수 있겠는가. 마음에 안 들 리가 없었다."
    ).join(" ");
    const input = `${prefix}\n\n${a}\n\n${b}`;
    const grouped = groupNovelParagraphs(input);
    assert.equal(grouped.length, 3);
    assert.equal(grouped[1], a);
    assert.equal(grouped[2], b);
  });

  it("keeps a natural multi-sentence paragraph without blank lines intact", () => {
    const sentence =
      "그는 천천히 다가와 손을 뻗었고, 눈빛만은 흔들리지 않았으며, 숨결마저 조심스럽게 맞추었다.";
    const input = Array.from({ length: 10 }, () => sentence).join(" ");
    assert.ok(input.length > 480 && input.length <= MAX_NARRATION_CHARS_PER_PARAGRAPH);
    assert.equal(groupNovelParagraphs(input).length, 1);
  });

  it("does not invent a break at discourse-shift markers without author newlines", () => {
    const filler =
      "그는 천천히 다가와 손을 뻗었고, 눈빛만은 흔들리지 않았으며, 숨결마저 조심스럽게 맞추었다.";
    const marker =
      "하지만 그 순간 복도 끝에서 낯선 발소리가 울렸고, 두 사람은 동시에 몸을 굳혔다.";
    const input = [
      ...Array.from({ length: 10 }, () => filler),
      marker,
      ...Array.from({ length: 4 }, () => filler),
    ].join(" ");
    assert.ok(input.length > MAX_NARRATION_CHARS_PER_PARAGRAPH);
    const grouped = groupNovelParagraphs(input);
    assert.equal(grouped.length, 1);
    assert.match(grouped[0]!, /하지만 그 순간/);
  });
});

describe("MIN_NARRATION_CHARS_PER_PARAGRAPH", () => {
  it("is 50", () => {
    assert.equal(MIN_NARRATION_CHARS_PER_PARAGRAPH, 50);
  });
});

describe("MAX_NARRATION_CHARS_PER_PARAGRAPH", () => {
  it("is documentation/QA-only — blank-line merge is disabled (Step 7.10)", () => {
    assert.equal(MAX_NARRATION_CHARS_PER_PARAGRAPH, 700);
    assert.equal(MAX_NARRATION_MERGE_CHARS, 0);
  });
});

describe("formatAiProseForEditTextarea", () => {
  it("preserves blank-line narration boundaries to match display (Step 7.10)", () => {
    const raw = `아니, 마음에 든다는 말로는 부족했다.

그의 시선이 렌의 어깨선을 타고 천천히 내려갔다.

섬세한 자수가 빛나는 천의 질감, 그리고 그 아래로 이어지는 선.

등이 깊게 파인 그 디자인이, 오직 자신을 향한 마음으로 선택되었다는 것.`;
    const edited = formatAiProseForEditTextarea(raw);
    const displayed = groupNovelParagraphs(raw).join("\n\n");
    assert.equal(edited, displayed);
    assert.match(edited, /선\.\n\n등이/);
    assert.doesNotMatch(edited, /선\. 등이 깊게 파인/);
  });
});
