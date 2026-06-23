import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupNovelParagraphs,
  normalizeAiNovelProseLayout,
  stripLeadingPauseEllipsisFromDialogue,
} from "@/lib/novelParagraphs";

describe("pause-heavy RP post-processing", () => {
  it("normalizes leading ellipsis in dialogue to ...", () => {
    assert.equal(
      stripLeadingPauseEllipsisFromDialogue('"…근데 사실."'),
      '"... 근데 사실."'
    );
  });

  it("keeps dialogue and narration as separate paragraphs in pause-heavy sample", () => {
    const input = `"…근데 사실."

에쉬가 고개를 들었다. 금빛 눈동자가 렌의 얼굴을 응시했다. 두 사람의 코끝이 거의 닿을 거리.

"…하고 싶은 대로 하는 게 뭔지."

목소리가 낮았다. 거칠었다. 숨결이 렌의 입술 위로 퍼졌다.`;

    const grouped = groupNovelParagraphs(input);
    for (const p of grouped) {
      const kind =
        p.startsWith('"') && p.endsWith('"')
          ? "dialogue"
          : p.includes('"')
            ? "mixed"
            : "narration";
      assert.notEqual(kind, "mixed", `paragraph should not mix narration+dialogue: ${p}`);
    }
    assert.ok(
      !grouped.some((p) => /"[…]+/.test(p)),
      "unicode ellipsis at dialogue start should be normalized"
    );
  });

  it("normalizeAiNovelProseLayout splits narration ending with dialogue", () => {
    const input = `그는 다가왔고, 손을 뻗으며 상대의 어깨에 닿을 듯 말 듯 멈췄다. 숨결이 가까워졌다. "test."`;
    const out = normalizeAiNovelProseLayout(input);
    const parts = out.split(/\n{2,}/);
    assert.ok(parts.length >= 2);
    assert.doesNotMatch(parts[0]!, /"test/);
    assert.match(parts[parts.length - 1]!, /"test\."/);
  });
});
