import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractDialogueBlockSpans } from "@/lib/novelParagraphs";
import { evaluatePrimaryFocus } from "@/lib/primaryFocusEval";

describe("dialogue block parser — quote-style coverage", () => {
  it("ASCII quote dialogue", () => {
    const prose = `태형이 고개를 들었다.\n\n"오늘 어땠어?"`;
    const spans = extractDialogueBlockSpans(prose);
    assert.equal(spans.length, 1);
    assert.ok(spans[0]!.text.startsWith('"'));
    assert.ok(spans[0]!.text.endsWith('"'));
  });

  it("curly quote dialogue", () => {
    const prose = `태형이 고개를 들었다.\n\n\u201C오늘 어땠어?\u201D`;
    const spans = extractDialogueBlockSpans(prose);
    assert.equal(spans.length, 1);
    assert.ok(spans[0]!.text.startsWith("\u201C"));
    assert.ok(spans[0]!.text.endsWith("\u201D"));
  });

  it("corner bracket dialogue", () => {
    const prose = `태형이 고개를 들었다.\n\n「오늘 어땠어?」`;
    const spans = extractDialogueBlockSpans(prose);
    assert.equal(spans.length, 1);
    assert.ok(spans[0]!.text.startsWith("「"));
    assert.ok(spans[0]!.text.endsWith("」"));
  });

  it("double corner bracket dialogue", () => {
    const prose = `태형이 고개를 들었다.\n\n『오늘 어땠어?』`;
    const spans = extractDialogueBlockSpans(prose);
    assert.equal(spans.length, 1);
    assert.ok(spans[0]!.text.startsWith("『"));
    assert.ok(spans[0]!.text.endsWith("』"));
  });

  it("mixed Korean narration and dialogue — inline citations not counted", () => {
    const prose = [
      "태형이 식당에 들어섰다. \"안내 받고, 식사하고\"라는 말이 떠올랐다.",
      "그는 자리에 앉았다.",
      "\u201C오늘 본부에서 첫날이었지? 어땠어?\u201D",
      "태형은 어깨를 으쓱했다.",
      "\u201C그냥 평범했어.\u201D",
    ].join("\n\n");
    const spans = extractDialogueBlockSpans(prose);
    assert.equal(spans.length, 2);
    for (const s of spans) {
      assert.ok(s.text.startsWith("\u201C") || s.text.startsWith('"'));
    }
  });

  it("multiple speakers alternating", () => {
    const q = (s: string) => `\u201C${s}\u201D`;
    const prose = [
      `태형이 말했다.\n${q("안녕.")}`,
      `서진화가 대답했다.\n${q("안녕하세요.")}`,
      `태형이 물었다.\n${q("뭐해?")}`,
      `서진화가 대답했다.\n${q("일해요.")}`,
    ].join("\n\n");
    const r = evaluatePrimaryFocus({
      prose,
      primaryCharacter: "태형",
      knownSupportingNames: ["서진화"],
      sceneCastMode: "single_primary",
    });
    assert.equal(r.totalDialogueBlockCount, 4);
    assert.ok(r.distinctSpeakingCharacters >= 2);
    assert.ok(r.speakerSwitchCount >= 2);
  });

  it("single speaker separated by narration — not fragmented into ping-pong", () => {
    const prose = [
      "태형이 포크를 내려놓고 렌을 바라보았다.",
      "\u201C오늘 본부에서 첫날이었지? 어땠어? 그냥 평범했어. 안내 받고, 식사하고, 이제 쉬면 되는 거지.\u201D",
      "태형은 잠깐 생각하다가 어깨를 으쓱했다. 특별할 것은 없었다. 물잔을 들어 한 모금 마셨다.",
    ].join("\n\n");
    const r = evaluatePrimaryFocus({
      prose,
      primaryCharacter: "태형",
      knownSupportingNames: [],
      sceneCastMode: "single_primary",
    });
    assert.equal(r.totalDialogueBlockCount, 1);
    assert.equal(r.speakerSwitchCount, 0);
    assert.equal(r.currentInteractionInterrupted, false);
  });
});
