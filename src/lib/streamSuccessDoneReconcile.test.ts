import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStreamReveal } from "@/lib/streamReveal";
import {
  buildSuccessDoneRevealDiagnostics,
  inferFirstDisplayJumpOwner,
  planSuccessDoneFinalContentReveal,
  resolveCanonicalContentAtRevealIdle,
} from "@/lib/streamSuccessDoneReconcile";
import { streamRevealOptionsFromInterval } from "@/lib/streamRevealTiming";

const TICK = streamRevealOptionsFromInterval(1);

function paraBlock(label: string, paragraphs: number): string {
  return Array.from({ length: paragraphs }, (_, i) => `${label} 문장 ${i + 1}.`).join("\n\n");
}

describe("G37 success done — premature snap regressions", () => {
  it("R1 success done while queue pending — plan enqueues, never instant", () => {
    const displayed = "가".repeat(1000);
    const target = displayed + "나".repeat(1800);
    const plan = planSuccessDoneFinalContentReveal({
      displayed,
      streamTarget: displayed,
      finalContent: target,
      revealIdle: false,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "enqueue");
    if (plan.action === "enqueue") {
      assert.equal(plan.enqueue, "나".repeat(1800));
      assert.equal(plan.deferredCanonical, target);
    }
    const diag = buildSuccessDoneRevealDiagnostics({
      displayed,
      streamTarget: displayed,
      finalContent: target,
      revealIdle: false,
      visualRevealPending: true,
      plan,
    });
    assert.equal(diag.setAssistantContentInstantCalled, false);
    assert.equal(diag.revealResetCalled, false);
    assert.equal(inferFirstDisplayJumpOwner(diag), "none — enqueue-only success done reconcile");
  });

  it("R2 queue naturally drains — displayed reaches final without instant snap", async () => {
    const prefix = "가".repeat(400);
    const suffix = "나".repeat(600);
    const finalContent = prefix + suffix;
    let displayed = prefix;
    const reveal = createStreamReveal({ onAppend: (c) => { displayed += c; } }, TICK);
    const plan = planSuccessDoneFinalContentReveal({
      displayed,
      streamTarget: prefix,
      finalContent,
      revealIdle: false,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "enqueue");
    if (plan.action === "enqueue") reveal.enqueue(plan.enqueue);
    assert.equal(displayed, prefix);
    await reveal.waitUntilIdle();
    assert.equal(displayed, finalContent);
    const canonical = resolveCanonicalContentAtRevealIdle(displayed, finalContent);
    assert.equal(canonical, finalContent);
  });

  it("R3 finalContent newline/layout differs — defer canonical, no mid-stream snap plan", () => {
    const displayed = paraBlock("stream", 12);
    const finalContent = paraBlock("stream", 12).replace(/\n\n/g, " ");
    const plan = planSuccessDoneFinalContentReveal({
      displayed,
      streamTarget: displayed,
      finalContent,
      revealIdle: false,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "defer_canonical");
    if (plan.action === "defer_canonical") {
      assert.equal(plan.deferredCanonical, finalContent);
    }
  });

  it("R4 true non-prefix divergence — defer canonical, no instant plan", () => {
    const displayed = "A".repeat(900);
    const finalContent = "B".repeat(900);
    const plan = planSuccessDoneFinalContentReveal({
      displayed,
      streamTarget: displayed,
      finalContent,
      revealIdle: false,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "defer_canonical");
  });

  it("R6 normal/regen parity — collapsed-prefix long stream enqueues tail", () => {
    const displayed = "가".repeat(1800);
    const finalContent = displayed + "마무리.";
    const plan = planSuccessDoneFinalContentReveal({
      displayed,
      streamTarget: displayed,
      finalContent,
      revealIdle: false,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "enqueue");
    if (plan.action === "enqueue") assert.equal(plan.enqueue, "마무리.");
  });

  it("instant reveal mode bypasses success defer plan", () => {
    const plan = planSuccessDoneFinalContentReveal({
      displayed: "x".repeat(100),
      streamTarget: "x".repeat(100),
      finalContent: "x".repeat(500),
      revealIdle: false,
      instantRevealMode: true,
    });
    assert.equal(plan.action, "noop");
  });
});

describe("G37 success done — production-shape fixture", () => {
  it("proves enqueue-only reconcile for displayed=1000 target=2800 shape", () => {
    const displayed = "가".repeat(1000);
    const finalContent = displayed + "나".repeat(1800);
    const plan = planSuccessDoneFinalContentReveal({
      displayed,
      streamTarget: displayed,
      finalContent,
      revealIdle: false,
      instantRevealMode: false,
    });
    const diag = buildSuccessDoneRevealDiagnostics({
      displayed,
      streamTarget: displayed,
      finalContent,
      revealIdle: false,
      visualRevealPending: true,
      plan,
    });
    assert.equal(diag.displayedLenAtDone, 1000);
    assert.equal(diag.finalContentLen, 2800);
    assert.equal(diag.revealIdleAtDone, false);
    assert.equal(diag.visualRevealPendingAtDone, true);
    assert.equal(plan.action, "enqueue");
    assert.equal(inferFirstDisplayJumpOwner(diag).startsWith("none"), true);
  });
});
