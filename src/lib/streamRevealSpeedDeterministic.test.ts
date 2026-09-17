import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStreamReveal } from "@/lib/streamReveal";
import { streamRevealOptionsFromInterval } from "@/lib/streamRevealTiming";

const FAST = streamRevealOptionsFromInterval(16);
const NORMAL = streamRevealOptionsFromInterval(40);
const PREBUFFER_CHARS = 1200;

type RevealTrace = {
  visibleCharCount: number;
  tickCount: number;
  timerRestartCount: number;
  activeIntervalMs: number;
};

async function tracePrebufferedReveal(
  opts: { intervalMs: number; charsPerTick: number },
  elapsedMs: number
): Promise<RevealTrace> {
  let shown = "";
  let tickCount = 0;
  let timerRestartCount = 0;
  let activeIntervalMs = -1;

  const reveal = createStreamReveal(
    {
      onAppend: (chunk) => {
        shown += chunk;
        tickCount += 1;
      },
    },
    () => {
      const current = opts;
      if (current.intervalMs !== activeIntervalMs && activeIntervalMs !== -1) {
        timerRestartCount += 1;
      }
      activeIntervalMs = current.intervalMs;
      return current;
    }
  );

  reveal.enqueue("가".repeat(PREBUFFER_CHARS));
  await new Promise((r) => setTimeout(r, elapsedMs));

  return {
    visibleCharCount: [...shown].length,
    tickCount,
    timerRestartCount,
    activeIntervalMs: opts.intervalMs,
  };
}

describe("CASE SPEED-A — prebuffered reveal cadence", () => {
  it("fast materially exceeds normal visible chars at identical elapsed times", async () => {
    const elapsedMs = 400;
    const [fast, normal] = await Promise.all([
      tracePrebufferedReveal(FAST, elapsedMs),
      tracePrebufferedReveal(NORMAL, elapsedMs),
    ]);

    assert.ok(fast.visibleCharCount > normal.visibleCharCount, {
      message: `fast=${fast.visibleCharCount} normal=${normal.visibleCharCount}`,
    });
    assert.ok(fast.visibleCharCount >= 20, `fast too low: ${fast.visibleCharCount}`);
    assert.ok(normal.visibleCharCount >= 8, `normal too low: ${normal.visibleCharCount}`);
    assert.ok(fast.visibleCharCount >= normal.visibleCharCount * 1.8);
  });

  it("records independent timer intervals for fast vs normal", async () => {
    const fast = await tracePrebufferedReveal(FAST, 64);
    const normal = await tracePrebufferedReveal(NORMAL, 64);
    assert.equal(fast.activeIntervalMs, 16);
    assert.equal(normal.activeIntervalMs, 40);
    assert.ok(fast.visibleCharCount > normal.visibleCharCount);
  });
});

describe("CASE SPEED-B — provider-like chunk supply", () => {
  it("converges to provider rate when supply is slower than both presets", async () => {
    const providerCharEveryMs = 45;
    const totalProviderChars = 240;
    let providerDelivered = 0;

    async function runWithPreset(opts: { intervalMs: number; charsPerTick: number }) {
      let shown = "";
      const pendingTimeline: number[] = [];
      const renderedTimeline: number[] = [];
      const reveal = createStreamReveal({ onAppend: (c) => { shown += c; } }, opts);

      const start = Date.now();
      while (providerDelivered < totalProviderChars) {
        reveal.enqueue("다");
        providerDelivered += 1;
        pendingTimeline.push(reveal.getPendingLength());
        renderedTimeline.push([...shown].length);
        await new Promise((r) => setTimeout(r, providerCharEveryMs));
      }
      await new Promise((r) => setTimeout(r, opts.intervalMs * 4));
      return {
        visibleCharCount: [...shown].length,
        elapsedMs: Date.now() - start,
        pendingTimeline,
        renderedTimeline,
      };
    }

    providerDelivered = 0;
    const fastRun = await runWithPreset(FAST);
    providerDelivered = 0;
    const normalRun = await runWithPreset(NORMAL);

    const providerRate = 1000 / providerCharEveryMs;
    const fastRate = fastRun.visibleCharCount / (fastRun.elapsedMs / 1000);
    const normalRate = normalRun.visibleCharCount / (normalRun.elapsedMs / 1000);

    assert.ok(Math.abs(fastRate - providerRate) < 4, `fastRate=${fastRate}`);
    assert.ok(Math.abs(normalRate - providerRate) < 4, `normalRate=${normalRate}`);
    assert.ok(Math.abs(fastRun.visibleCharCount - normalRun.visibleCharCount) <= 3);
  });

  it("preserves preset delta when provider bursts faster than reveal", async () => {
    let shownFast = "";
    let shownNormal = "";
    const fast = createStreamReveal({ onAppend: (c) => { shownFast += c; } }, FAST);
    const normal = createStreamReveal({ onAppend: (c) => { shownNormal += c; } }, NORMAL);

    fast.enqueue("가".repeat(600));
    normal.enqueue("가".repeat(600));

    await new Promise((r) => setTimeout(r, 320));

    const fastCount = [...shownFast].length;
    const normalCount = [...shownNormal].length;
    assert.ok(fastCount > normalCount * 1.5, `fast=${fastCount} normal=${normalCount}`);
  });
});

describe("S3/S4 — mid-stream cadence change on active reveal", () => {
  it("syncOptions switches active interval without clearing pending queue", async () => {
    let intervalMs = 16;
    let shown = "";
    const reveal = createStreamReveal(
      { onAppend: (c) => { shown += c; } },
      () => ({ intervalMs, charsPerTick: 1 })
    );

    reveal.enqueue("나".repeat(200));
    await new Promise((r) => setTimeout(r, 80));
    const beforeChange = [...shown].length;

    intervalMs = 40;
    reveal.syncOptions();
    await new Promise((r) => setTimeout(r, 120));
    const afterSlowdown = [...shown].length;
    const deltaAfterSlow = afterSlowdown - beforeChange;

    intervalMs = 16;
    reveal.syncOptions();
    await new Promise((r) => setTimeout(r, 80));
    const afterSpeedup = [...shown].length;
    const deltaAfterFast = afterSpeedup - afterSlowdown;

    assert.ok(beforeChange >= 4);
    assert.ok(deltaAfterSlow <= 4, `slow segment grew ${deltaAfterSlow}`);
    assert.ok(deltaAfterFast >= 4, `fast segment grew ${deltaAfterFast}`);
    assert.ok(reveal.getPendingLength() > 0);
    reveal.flush();
  });
});
