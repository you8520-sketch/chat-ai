import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStreamReveal } from "@/lib/streamReveal";
import {
  computeAdaptiveCharsPerTick,
  estimateStreamRevealDurationMs,
  streamRevealOptionsFromInterval,
} from "@/lib/streamRevealTiming";

const FAST = streamRevealOptionsFromInterval(28);
const BURST_CHARS = 3000;

describe("streamReveal foreground speed — regression gates", () => {
  it("R1: 빠름 + normal incremental chunks honors base charsPerTick", () => {
    assert.equal(computeAdaptiveCharsPerTick(10, FAST), FAST.charsPerTick);
    assert.equal(FAST.intervalMs, 28);
    assert.equal(FAST.charsPerTick, 1);
  });

  it("R2: 빠름 + 3000-char burst uses preset theoretical duration (no adaptive catch-up)", () => {
    assert.equal(computeAdaptiveCharsPerTick(BURST_CHARS, FAST), 1);
    assert.equal(estimateStreamRevealDurationMs(BURST_CHARS, FAST), BURST_CHARS * 28);
  });

  it("R3: 빠름 + pending backlog without flush reveals one char per tick", async () => {
    let shown = "";
    const reveal = createStreamReveal({ onAppend: (c) => { shown += c; } }, FAST);
    reveal.enqueue("가".repeat(20));
    assert.equal(reveal.getPendingLength(), 20);
    assert.equal(shown, "");
    await new Promise((r) => setTimeout(r, 40));
    assert.equal([...shown].length, 1);
    assert.ok(reveal.getPendingLength() >= 18);
    reveal.flush();
  });

  it("R4: 즉시 preset drains pending in one pump", () => {
    let shown = "";
    const instant = streamRevealOptionsFromInterval(0);
    const reveal = createStreamReveal({ onAppend: (c) => { shown += c; } }, instant);
    reveal.enqueue("instant");
    assert.equal(shown, "instant");
    assert.ok(reveal.isIdle());
  });

  it("R5: background tab bypasses reveal queue", () => {
    let shown = "";
    const reveal = createStreamReveal({ onAppend: (c) => { shown += c; } }, FAST);
    reveal.setBackgroundMode(true);
    reveal.enqueue("bg");
    assert.equal(shown, "bg");
    assert.equal(reveal.getPendingLength(), 0);
  });
});

describe("CASE A fixture — burst then done semantics", () => {
  it("records configured speed and rejects instant drain after simulated done", async () => {
    let shown = "";
    const reveal = createStreamReveal({ onAppend: (c) => { shown += c; } }, FAST);
    const burst = "다".repeat(3200);
    reveal.enqueue(burst);
    const pendingPeak = reveal.getPendingLength();
    const displayedBeforeDone = [...shown].length;

    // Simulated server done — no flush().
    await new Promise((r) => setTimeout(r, 40));
    const displayedAfterOneTick = [...shown].length;

    assert.equal(FAST.intervalMs, 28);
    assert.equal(FAST.charsPerTick, 1);
    assert.equal(pendingPeak, 3200);
    assert.equal(displayedBeforeDone, 0);
    assert.equal(displayedAfterOneTick, 1);
    assert.ok(estimateStreamRevealDurationMs(3200, FAST) > 80_000);
    reveal.flush();
  });
});
