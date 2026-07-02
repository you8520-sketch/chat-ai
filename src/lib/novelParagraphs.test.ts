import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyNovelParagraph,
  isNarrationEmphasisLine,
  isMisclassifiedDialogueQuote,
  normalizeAiNovelProseLayout,
  unwrapMisclassifiedDialogueQuotes,
  groupAuthorParagraphs,
  groupNovelParagraphs,
  novelParagraphSpacingClass,
  parseGreetingSegments,
  parseNovelSegments,
} from "@/lib/novelParagraphs";
import { fixCommonJapaneseLeaksInKoreanProse } from "@/lib/koreanProseSanitize";

describe("parseGreetingSegments", () => {
  it("splits asterisk narration and quoted dialogue", () => {
    const segs = parseGreetingSegments('*창가에 기대어 연기를 내뿜는다.* "……왔어?"');
    assert.deepEqual(segs, [
      { kind: "narration", text: "창가에 기대어 연기를 내뿜는다." },
      { kind: "dialogue", text: '"……왔어?"' },
    ]);
  });
});

describe("groupAuthorParagraphs", () => {
  it("preserves each Enter-separated line as its own paragraph", () => {
    const input = `*창가에 기대어*\n"...왔어?"\n\n다시 고개를 돌렸다.`;
    assert.deepEqual(groupAuthorParagraphs(input), [
      "*창가에 기대어*",
      '"...왔어?"',
      "다시 고개를 돌렸다.",
    ]);
  });
});

describe("groupNovelParagraphs", () => {
  it("merges single-newline narration into multi-sentence paragraphs", () => {
    const input = `하지만 이 순간 백하율의 속마음은 정반대였다.
(이제……
절대 놓치지 않을 거니까.)
고개를 들고 방긋 웃었다.`;
    assert.deepEqual(groupNovelParagraphs(input), [
      "하지만 이 순간 백하율의 속마음은 정반대였다. (이제…… 절대 놓치지 않을 거니까.) 고개를 들고 방긋 웃었다.",
    ]);
  });

  it("merges blank-line-separated narration when each block is short", () => {
    const input = `첫 번째 지문이다.

두 번째 지문이다.

세 번째 지문이다.`;
    assert.deepEqual(groupNovelParagraphs(input), [
      "첫 번째 지문이다. 두 번째 지문이다. 세 번째 지문이다.",
    ]);
  });

  it("merges blank-line-separated short narration into one paragraph", () => {
    const input = `그는 다가왔다.

손을 뻗었다.

시선을 맞췄다.`;
    assert.deepEqual(groupNovelParagraphs(input), [
      "그는 다가왔다. 손을 뻗었다. 시선을 맞췄다.",
    ]);
  });

  it("keeps long narration as one paragraph", () => {
    const input =
      "그는 말없이 바라봤다. 천천히 다가왔다. 손을 뻗었다. 손끝이 차가웠다. 숨이 가빠졌다. 심장이 쿵쾅거렸다. 눈앞이 어지러웠다.";
    assert.deepEqual(groupNovelParagraphs(input), [input]);
  });

  it("splits open dialogue onto its own paragraph (streaming and idle)", () => {
    const input = '그는 응시했다. "아직 아파';
    const expected = ["그는 응시했다.", '"아직 아파'];
    assert.deepEqual(groupNovelParagraphs(input, { streaming: true }), expected);
    assert.deepEqual(groupNovelParagraphs(input), expected);
    assert.equal(classifyNovelParagraph('"아직 아파'), "dialogue");
  });

  it("streaming flag is a no-op after layout unify", () => {
    const input =
      '철저히 계산된 거리 두기. "잠깐…… 이대로만 있어요. 조금만." 백하율의 S-기어가 파르르 떨렸다.';
    assert.deepEqual(
      groupNovelParagraphs(input, { streaming: true }),
      groupNovelParagraphs(input)
    );
  });

  it("keeps standalone dialogue on its own paragraph", () => {
    const input = `그는 말없이 바라봤다.

"...왜 그러는 거야."

다시 고개를 돌렸다.`;
    assert.deepEqual(groupNovelParagraphs(input), [
      "그는 말없이 바라봤다.",
      '"... 왜 그러는 거야."',
      "다시 고개를 돌렸다.",
    ]);
  });

  it("splits inline narration+dialogue on the same line into separate paragraphs", () => {
    const input =
      '철저히 계산된 거리 두기. "잠깐…… 이대로만 있어요. 조금만." 백하율의 S-기어가 파르르 떨렸다.';
    assert.deepEqual(groupNovelParagraphs(input), [
      "철저히 계산된 거리 두기.",
      '"잠깐 ... 이대로만 있어요. 조금만."',
      "백하율의 S-기어가 파르르 떨렸다.",
    ]);
  });

  it("keeps one dialogue paragraph when model inserts blank lines inside quotes", () => {
    const input =
      '"연회장으로 돌아가시죠.\n\n더 늦으면 황태자 전하께서 의아해하실 겁니다.\n\n"';
    assert.deepEqual(groupNovelParagraphs(input), [
      '"연회장으로 돌아가시죠. 더 늦으면 황태자 전하께서 의아해하실 겁니다."',
    ]);
  });

  it("keeps multiline quoted dialogue as one line without internal breaks", () => {
    const input = `"이게 정상 수치가 아니거든요.
70% 밑으론 전부 위험 구간이에요.
매뉴얼 읽어보셨죠?"`;
    const grouped = groupNovelParagraphs(input);
    assert.equal(grouped.length, 1);
    assert.equal(classifyNovelParagraph(grouped[0]!), "dialogue");
    assert.doesNotMatch(grouped[0]!, /\n/);
    assert.match(grouped[0]!, /이게 정상 수치가 아니거든요./);
    assert.match(grouped[0]!, /매뉴얼 읽어보셨죠?/);
  });

  it("merges consecutive quoted sentences into one dialogue line", () => {
    const input = `"이게 정상 수치가 아니거든요."

"70% 밑으론 전부 위험 구간이에요."

"매뉴얼 읽어보셨죠?"`;
    const grouped = groupNovelParagraphs(input);
    assert.equal(grouped.length, 1);
    assert.equal(
      grouped[0],
      '"이게 정상 수치가 아니거든요. 70% 밑으론 전부 위험 구간이에요. 매뉴얼 읽어보셨죠?"'
    );
  });

  it("splits dialogue even when other lines already have line breaks", () => {
    const input = `첫 지문.

거리 두기. "안녕." 이어지는 지문.`;
    assert.deepEqual(groupNovelParagraphs(input), [
      "첫 지문. 거리 두기.",
      '"안녕."',
      "이어지는 지문.",
    ]);
  });

  it("splits inline narration+dialogue with curly quotes", () => {
    const input =
      "그는 말없이 바라봤다. \u201C잠깐…… 이대로만 있어요.\u201D 다시 고개를 돌렸다.";
    assert.deepEqual(groupNovelParagraphs(input), [
      "그는 말없이 바라봤다.",
      "\u201C잠깐 ... 이대로만 있어요.\u201D",
      "다시 고개를 돌렸다.",
    ]);
  });

  it("treats descriptive unquoted lines as narration, not dialogue", () => {
    const line = "이번에는 더 느리게, 더 깊은 압력으로.";
    assert.equal(classifyNovelParagraph(line), "narration");
    assert.equal(isNarrationEmphasisLine(line), true);
  });

  it("merges blank-line-separated long narration sentences into flowing paragraphs", () => {
    const s1 =
      "백하율은 렌이 내민 손을 마주 잡으며 천천히 손가락을 깍지 꼈다. 일부러 느리게, 한 마디 한 마디가 미끄러지듯 맞물리게.";
    const s2 =
      "입가에는 능글맞은 미소가 걸려 있었지만, 금빛 눈동자는 진지하게 렌의 얼굴을 응시했다. 숨결마저 조심스럽게 맞추었다.";
    const s3 =
      "그는 더 이상 도망칠 구석이 없다는 듯 몸을 기울였고, 손끝의 온기가 서서히 올라왔다. 심장 박동이 귓가에 울렸다.";
    const input = `${s1}\n\n${s2}\n\n${s3}`;
    const grouped = groupNovelParagraphs(input);
    assert.equal(grouped.length, 1);
    assert.ok(grouped[0]!.includes(s1.slice(0, 20)));
    assert.ok(grouped[0]!.includes(s3.slice(0, 20)));
  });

  it("keeps punch-line narration separate from flowing paragraphs", () => {
    const input = `그는 말없이 바라봤다.

……왜?

다시 고개를 돌렸다.`;
    assert.deepEqual(groupNovelParagraphs(input), [
      "그는 말없이 바라봤다.",
      "……왜?",
      "다시 고개를 돌렸다.",
    ]);
    assert.equal(classifyNovelParagraph("……왜?"), "narration");
    assert.equal(classifyNovelParagraph("정말 놀랍다."), "narration");
  });

  it("keeps single-quoted emphasis inside dialogue as one paragraph", () => {
    const input =
      '"아니면 제가 ...\'한 번\'을 좀 특별하게 만들어드릴까요? 그래야 렌 님도 후회하지 않으실 것 같은데."';
    const grouped = groupNovelParagraphs(input);
    assert.equal(grouped.length, 1);
    assert.equal(classifyNovelParagraph(grouped[0]!), "dialogue");
    const segs = parseNovelSegments(grouped[0]!);
    assert.equal(segs.length, 1);
    assert.equal(segs[0]!.kind, "dialogue");
    assert.match(segs[0]!.text, /'한 번'/);
  });

  it("merges blank lines inside double-quoted dialogue before paragraph split", () => {
    const input = `"아니면 제가 ...

'한 번'

을 좀 특별하게 만들어드릴까요? 그래야 렌 님도 후회하지 않으실 것 같은데."`;
    const normalized = normalizeAiNovelProseLayout(input);
    const grouped = groupNovelParagraphs(normalized);
    assert.equal(grouped.length, 1);
    assert.equal(classifyNovelParagraph(grouped[0]!), "dialogue");
    assert.match(grouped[0]!, /'한 번'/);
    assert.doesNotMatch(grouped[0]!, /\n/);
  });

  it("treats bare single-quoted emphasis in narration as narration segments", () => {
    const text = "그녀는 '한 번'만 더 시도했다.";
    const segs = parseNovelSegments(text);
    assert.equal(
      segs.every((s) => s.kind === "narration"),
      true
    );
    assert.equal(segs.map((s) => s.text).join(""), text);
  });

  it("does not treat single quotes as dialogue delimiters in mixed lines", () => {
    const input = "그는 말했다. '잠깐만.' 다시 고개를 돌렸다.";
    assert.deepEqual(groupNovelParagraphs(input), [input]);
    assert.equal(classifyNovelParagraph(input), "narration");
  });

  it("keeps inline narrated quotes in one narration paragraph", () => {
    const input = '평소엔 "괜찮아요"라고 했을거지만';
    assert.deepEqual(groupNovelParagraphs(input), [input]);
    assert.equal(classifyNovelParagraph(input), "narration");
  });

  it("does not split cited speech with attribution after the quote", () => {
    const input = '그는 "잠깐"하고 말했다.';
    assert.deepEqual(groupNovelParagraphs(input), [input]);
    assert.equal(classifyNovelParagraph(input), "narration");
  });

  it("merges multiline indirect speech quotes into one narration sentence", () => {
    const input = `백하율은 렌의 눈동자에 비친 자신의 모습을 가만히 들여다보았다. 렌이

"처음이고 신기하다"

고 말한 그 순간부터, 백하율의 가슴속에서는 낯선 감정이 꿈틀거리고 있었다`;
    const out = normalizeAiNovelProseLayout(input);
    assert.match(out, /렌이 '처음이고 신기하다'고 말한 그 순간부터/);
    assert.doesNotMatch(out, /^\s*"처음이고 신기하다"\s*$/m);
    assert.equal(classifyNovelParagraph(out), "narration");
  });

  it("keeps standalone dialogue when next line is not indirect attribution", () => {
    const input = `"안녕하세요."

렌은 고개를 끄덕였다.`;
    const grouped = groupNovelParagraphs(input);
    assert.equal(grouped.length, 2);
    assert.equal(classifyNovelParagraph(grouped[0]!), "dialogue");
    assert.equal(classifyNovelParagraph(grouped[1]!), "narration");
  });
});

describe("parseNovelSegments inline narrated quotes", () => {
  it("treats cited quotes as narration segments", () => {
    const text = '평소엔 "괜찮아요"라고 했을거지만';
    const segs = parseNovelSegments(text);
    assert.equal(
      segs.every((s) => s.kind === "narration"),
      true
    );
    assert.equal(segs.map((s) => s.text).join(""), text);
  });
});

describe("unwrapMisclassifiedDialogueQuotes", () => {
  it("unwraps acting labels like ~척", () => {
    assert.equal(isMisclassifiedDialogueQuote("아픈 척"), true);
    assert.equal(isMisclassifiedDialogueQuote("아쉬운 척"), true);
    assert.equal(unwrapMisclassifiedDialogueQuotes('"아픈 척"'), "아픈 척");
  });

  it("keeps real spoken dialogue quoted", () => {
    assert.equal(isMisclassifiedDialogueQuote("가이드님, 도와주세요..."), false);
    assert.equal(
      unwrapMisclassifiedDialogueQuotes('"가이드님, 도와주세요..."'),
      '"가이드님, 도와주세요..."'
    );
  });

  it("merges narration and removes spurious line breaks", () => {
    const input = `"아픈 척"

과

"아쉬운 척"

만으로도 충분히 씨앗은 뿌려졌다.`;
    assert.equal(
      normalizeAiNovelProseLayout(input),
      "아픈 척 과 아쉬운 척 만으로도 충분히 씨앗은 뿌려졌다."
    );
  });
});

describe("fixCommonJapaneseLeaksInKoreanProse", () => {
  it("replaces どころか with 은커녕 adjacent to Korean", () => {
    assert.equal(
      fixCommonJapaneseLeaksInKoreanProse("번화가どころか 병원"),
      "번화가은커녕 병원"
    );
    assert.equal(
      normalizeAiNovelProseLayout("번화가どころか 병원 근처였다."),
      "번화가은커녕 병원 근처였다."
    );
  });
});

describe("novelParagraphSpacingClass", () => {
  it("adds larger gap when crossing narration and dialogue", () => {
    assert.equal(novelParagraphSpacingClass("dialogue", "narration", "ai"), "mt-[1.5em]");
    assert.equal(novelParagraphSpacingClass("narration", "dialogue", "ai"), "mt-[1.5em]");
    assert.equal(novelParagraphSpacingClass("narration", "narration", "ai"), "mt-[1em]");
  });

  it("uses wider Enter-based gaps in author mode", () => {
    assert.equal(novelParagraphSpacingClass("narration", "narration", "author"), "mt-[1.25em]");
    assert.equal(novelParagraphSpacingClass("dialogue", "narration", "author"), "mt-[1.75em]");
  });
});
