import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { visibleAssistantDisplayCharCount } from "@/lib/chatDisplayLength";
import {
  detectAdultGenerationFailure,
  isCatastrophicallyShortResponse,
  isBelowResponseTarget,
  needsServerUnderLengthRecovery,
  needsUnderLengthRecovery,
  resolveMaxOutputTokensForTarget,
  resolveServerUnderLengthRecoveryFloor,
} from "@/lib/responseLength";
import {
  UNIFIED_TIER_AIM_CHARS,
  UNIFIED_TIER_MIN_CHARS,
} from "@/lib/responseLengthConstants";

const RECORDED = [
  { label: "SCENE-DIRECTIVE-1", chars: 3202 },
  { label: "SCENE-DIRECTIVE-2", chars: 4186 },
  { label: "POST-MERGE-1", chars: 3149 },
  { label: "POST-MERGE-2", chars: 2932 },
] as const;

function proseOfLength(chars: number): string {
  const body = "창가에서 라이크는 유리 너머를 보았다. ";
  const pad = "가".repeat(Math.max(0, chars - body.length - 1));
  return `${body}${pad}.`;
}

describe("recorded DeepSeek auto outputs vs live length gates", () => {
  it("keeps 3,200 as a soft aim and 2,700 as an internal floor", () => {
    assert.equal(UNIFIED_TIER_AIM_CHARS, 3200);
    assert.equal(UNIFIED_TIER_MIN_CHARS, 2700);
    assert.equal(resolveServerUnderLengthRecoveryFloor(3200), 2720);
    assert.equal(resolveMaxOutputTokensForTarget(3200, "deepseek-v4.1-flash"), undefined);
  });

  for (const sample of RECORDED) {
    it(`${sample.label} (${sample.chars}) is not a generation failure on stop`, () => {
      const text = proseOfLength(sample.chars);
      assert.equal(text.length, sample.chars);
      assert.equal(visibleAssistantDisplayCharCount(text), sample.chars);
      assert.equal(isCatastrophicallyShortResponse(text, 3200), false);
      assert.equal(detectAdultGenerationFailure("stop", text, 3200), null);
      assert.equal(needsUnderLengthRecovery(text, 3200), false);
      assert.equal(needsServerUnderLengthRecovery(text, "stop", 3200), false);
      assert.equal(isBelowResponseTarget(sample.chars, 3200), sample.chars < UNIFIED_TIER_MIN_CHARS);
      assert.equal(sample.chars >= UNIFIED_TIER_MIN_CHARS, true);
    });
  }
});
