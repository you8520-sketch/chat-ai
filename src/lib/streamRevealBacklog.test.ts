import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStreamReveal } from "@/lib/streamReveal";
import {
  computeAdaptiveCharsPerTick,
  estimateStreamRevealDurationMs,
  streamRevealOptionsFromInterval,
  theoreticalRevealDurationsForCharCount,
} from "@/lib/streamRevealTiming";

describe("streamRevealTiming — chat 707 theoretical durations", () => {
  const CHARS = 5485;

  it("A: 5485 chars fixed-speed presets", () => {
    const durations = theoreticalRevealDurationsForCharCount(CHARS);
    assert.equal(durations["즉시"], 0);
    assert.equal(durations["빠름"], 5485 * 28);
    assert.equal(durations["보통"], 5485 * 40);
    assert.equal(durations["빠름"], 153_580);
  });

  it("B: foreground backlog keeps user-selected charsPerTick (no adaptive override)", () => {
    const fast = streamRevealOptionsFromInterval(28);
    const adaptive = computeAdaptiveCharsPerTick(5485, fast);
    assert.equal(adaptive, fast.charsPerTick);
    const drainMs = Math.ceil(5485 / adaptive) * fast.intervalMs;
    assert.equal(drainMs, 5485 * 28);
  });

  it("G: small backlog keeps base charsPerTick", () => {
    const fast = streamRevealOptionsFromInterval(28);
    assert.equal(computeAdaptiveCharsPerTick(10, fast), 1);
  });
});

describe("createStreamReveal adaptive + visibility", () => {
  it("A: large fast backlog drains at fixed preset speed (theoretical)", () => {
    const fast = streamRevealOptionsFromInterval(28);
    const chars = 5485;
    const fixedTheoreticalMs = estimateStreamRevealDurationMs(chars, fast);
    assert.equal(computeAdaptiveCharsPerTick(chars, fast), fast.charsPerTick);
    assert.equal(fixedTheoreticalMs, chars * 28);
  });

  it("C/D: hidden tab bypasses animation backlog", () => {
    let shown = "";
    const reveal = createStreamReveal(
      { onAppend: (c) => { shown += c; } },
      { intervalMs: 28, charsPerTick: 1 }
    );
    reveal.setBackgroundMode(true);
    reveal.enqueue("hello");
    reveal.enqueue(" world");
    assert.equal(shown, "hello world");
    assert.equal(reveal.getPendingLength(), 0);
    reveal.setBackgroundMode(false);
    reveal.enqueue("!");
    reveal.flush();
    assert.equal(shown, "hello world!");
  });

  it("E/G: flush clears pending immediately", () => {
    let shown = "";
    const reveal = createStreamReveal(
      { onAppend: (c) => { shown += c; } },
      { intervalMs: 28, charsPerTick: 1 }
    );
    reveal.enqueue("abc");
    reveal.flush();
    assert.equal(shown, "abc");
    assert.ok(reveal.isIdle());
    assert.equal(reveal.activeTimerCount(), 0);
  });
});

describe("estimateStreamRevealDurationMs", () => {
  it("instant preset is zero", () => {
    assert.equal(
      estimateStreamRevealDurationMs(100, streamRevealOptionsFromInterval(0)),
      0
    );
  });
});
