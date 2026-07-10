import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasUnexpectedForeignScriptLeak,
  isDegenerateOutput,
  isHealthyKoreanNarrative,
  isStripableForeignScriptOnly,
  detectStreamingDegeneration,
  detectChunkDegeneration,
  stripUnexpectedForeignScriptLeak,
} from "@/lib/gibberishGuard";

const HEALTHY_KO = `${"가".repeat(50)} 그는 조용히 고개를 들었다. 창밖의 바람이 차갑게 스쳤다. 발걸음을 옮기며 숨을 고른다.`;

describe("gibberishGuard foreign-script leak", () => {
  it("detects Cyrillic mixed into otherwise healthy Korean (пространствен)", () => {
    const mixed = `${HEALTHY_KO} 오리지널의 пространствен(공간) 왜곡이 느껴졌다.`;
    assert.equal(isHealthyKoreanNarrative(mixed), true);
    assert.equal(hasUnexpectedForeignScriptLeak(mixed), true);
  });

  it("strips пространствен without deleting the Korean paragraph", () => {
    const mixed = `${HEALTHY_KO} 오리지널의 пространствен(공간) 왜곡이 느껴졌다.`;
    const cleaned = stripUnexpectedForeignScriptLeak(mixed);
    assert.equal(hasUnexpectedForeignScriptLeak(cleaned), false);
    assert.match(cleaned, /오리지널의/);
    assert.match(cleaned, /\(공간\)/);
    assert.match(cleaned, /왜곡이 느껴졌다/);
    assert.doesNotMatch(cleaned, /пространствен/);
    // Korean body not collapsed to empty
    assert.ok(cleaned.length > HEALTHY_KO.length * 0.8);
  });

  it("Korean-only healthy output passes", () => {
    assert.equal(hasUnexpectedForeignScriptLeak(HEALTHY_KO), false);
    assert.equal(stripUnexpectedForeignScriptLeak(HEALTHY_KO), HEALTHY_KO);
    assert.equal(isDegenerateOutput(HEALTHY_KO), false);
    assert.equal(isHealthyKoreanNarrative(HEALTHY_KO), true);
  });

  it("after strip, mixed Cyrillic sample is not treated as degenerate", () => {
    const mixed = `${HEALTHY_KO} 오리지널의 пространствен(공간) 왜곡이 느껴졌다.`;
    const cleaned = stripUnexpectedForeignScriptLeak(mixed);
    assert.equal(isDegenerateOutput(cleaned), false);
  });

  it("early mid-stream Cyrillic leak is stripable (does not abort stream)", () => {
    const early = `그는 천천히 다가왔다. пространствен 왜곡이 느껴졌다.`;
    assert.equal(hasUnexpectedForeignScriptLeak(early), true);
    assert.equal(isStripableForeignScriptOnly(early), true);
    assert.equal(detectChunkDegeneration(" пространствен ", early, undefined), false);

    const longer = `${"가".repeat(40)} 그는 다가왔다. пространствен(공간) 왜곡이 느껴졌다. 다시 숨을 고른다.`;
    assert.equal(isStripableForeignScriptOnly(longer), true);
    assert.equal(detectStreamingDegeneration(longer), false);
  });
});
