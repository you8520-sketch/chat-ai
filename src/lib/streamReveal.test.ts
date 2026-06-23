import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collapseStreamCompareText,
  createStreamReveal,
  planStreamRevealCatchUp,
  rawPrefixForCollapsedCompare,
  resolveStreamAppendTail,
  resolveStreamCatchUp,
  resolveStreamReplaceCatchUp,
  sliceCodePoints,
} from "./streamReveal.ts";

describe("resolveStreamAppendTail", () => {
  it("appends only beyond streamTarget when displayed lags reveal queue", () => {
    const displayed = "ABCDEF";
    const streamTarget = "ABCDEFGH";
    const incoming = "ABCDEFGHXYZ";
    const tail = resolveStreamAppendTail(displayed, streamTarget, incoming);
    assert.equal(tail, "XYZ");
  });

  it("returns null when incoming diverges from enqueued streamTarget", () => {
    const displayed = "ABCDEF";
    const streamTarget = "ABCDEFGHIJ";
    const incoming = "ABCDEFGHXYZ";
    assert.equal(resolveStreamAppendTail(displayed, streamTarget, incoming), null);
  });

  it("returns null when streamTarget already matches incoming", () => {
    assert.equal(resolveStreamAppendTail("AB", "ABCDEF", "ABCDEF"), null);
  });

  it("falls back to displayed prefix when streamTarget does not match", () => {
    const tail = resolveStreamAppendTail("hello", "other", "hello world");
    assert.equal(tail, " world");
  });
});

describe("resolveStreamCatchUp", () => {
  it("appends tail when target extends displayed", () => {
    const r = resolveStreamCatchUp("hello", "hello world");
    assert.ok(r);
    assert.equal(r!.prefix, "hello");
    assert.equal(r!.tail, " world");
  });

  it("returns null when already synced", () => {
    assert.equal(resolveStreamCatchUp("same", "same"), null);
  });

  it("rewrites prefix on mid-text correction then appends", () => {
    const displayed = "abcOLD";
    const target = "abcNEWtail";
    const r = resolveStreamCatchUp(displayed, target);
    assert.ok(r);
    assert.equal(r!.prefix, sliceCodePoints(target, 0, 3));
    assert.equal(r!.tail, "NEWtail");
  });
});

describe("planStreamRevealCatchUp", () => {
  it("enqueues suffix instead of snapping when only paragraph breaks differ", () => {
    const displayed = "첫 문장. 둘째 문장. 셋째 문장.";
    const target = "첫 문장.\n\n둘째 문장.\n\n셋째 문장.";
    const r = planStreamRevealCatchUp(displayed, target);
    assert.ok(r);
    assert.ok(r!.enqueue.length > 0 || r!.setPrefix !== displayed);
  });

  it("enqueues final tail at stream end instead of instant full replace", () => {
    const displayed = "가".repeat(1800);
    const target = displayed + "마무리.";
    const r = planStreamRevealCatchUp(displayed, target);
    assert.ok(r);
    assert.equal(r!.enqueue, "마무리.");
    assert.equal(r!.resetQueue, false);
  });

  it("does not re-enqueue when streamTarget already matches replace target", () => {
    const displayed = "hello";
    const streamTarget = "hello world";
    const target = "hello world";
    assert.equal(planStreamRevealCatchUp(displayed, target, "", streamTarget), null);
  });

  it("does not re-enqueue displayed lag when streamTarget already covers target", () => {
    const displayed = "ABCDEF";
    const streamTarget = "ABCDEFGH";
    const target = "ABCDEFGH";
    assert.equal(planStreamRevealCatchUp(displayed, target, "", streamTarget), null);
  });

  it("enqueues only beyond streamTarget when displayed lags reveal queue", () => {
    const displayed = "ABCDEF";
    const streamTarget = "ABCDEFGH";
    const target = "ABCDEFGHXYZ";
    const r = planStreamRevealCatchUp(displayed, target, "", streamTarget);
    assert.ok(r);
    assert.equal(r!.enqueue, "XYZ");
  });
});

describe("resolveStreamReplaceCatchUp", () => {
  it("snaps instantly when only paragraph breaks differ", () => {
    const displayed = "첫 문장. 둘째 문장. 셋째 문장.";
    const target = "첫 문장.\n\n둘째 문장.\n\n셋째 문장.";
    const r = resolveStreamReplaceCatchUp(displayed, target);
    assert.ok(r);
    assert.equal(r!.mode, "instant");
    assert.equal(r!.prefix, target);
  });

  it("remaps layout without rewinding when collapsed prefix matches", () => {
    const displayed = "첫 문장. 둘째";
    const target = "첫 문장.\n\n둘째 문장. 셋째 문장.";
    const r = resolveStreamReplaceCatchUp(displayed, target);
    assert.ok(r);
    assert.equal(r!.mode, "remap");
    assert.equal(collapseStreamCompareText(r!.prefix), collapseStreamCompareText(displayed));
    assert.ok(r!.tail.length > 0);
  });

  it("snaps instantly when long displayed text only gains paragraph breaks", () => {
    const displayed = `${"가".repeat(950)}다. ${"나".repeat(950)}다.`;
    const target = displayed.replace(/\. /g, ".\n\n");
    const r = resolveStreamReplaceCatchUp(displayed, target);
    assert.ok(r);
    assert.equal(r!.mode, "instant");
  });
});

describe("createStreamReveal pause", () => {
  it("drops enqueue while paused and resumes afterward", () => {
    let shown = "";
    const reveal = createStreamReveal(
      {
        onAppend: (chunk) => {
          shown += chunk;
        },
      },
      { intervalMs: 40, charsPerTick: 20 }
    );

    reveal.enqueue("hello");
    reveal.flush();
    assert.equal(shown, "hello");

    reveal.pause();
    reveal.enqueue(" world");
    assert.equal(shown, "hello");

    reveal.resume();
    assert.equal(shown, "hello");

    reveal.enqueue("!");
    reveal.flush();
    assert.equal(shown, "hello!");
  });
});
describe("rawPrefixForCollapsedCompare", () => {
  it("maps collapsed prefix back to raw with paragraph breaks", () => {
    const raw = rawPrefixForCollapsedCompare("첫.\n\n둘.", "첫. 둘.");
    assert.equal(collapseStreamCompareText(raw), "첫. 둘.");
  });
});
