import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catchUpStreamRevealToReceived } from "@/lib/streamClickReveal";
import { createStreamReveal } from "@/lib/streamReveal";
import type { PendingRevealSession } from "@/lib/streamRevealIdentity";
import {
  buildSuccessDoneRevealDiagnostics,
  planSuccessDoneFinalContentReveal,
  resolveCanonicalContentAtRevealIdle,
} from "@/lib/streamSuccessDoneReconcile";
import { streamRevealOptionsFromInterval } from "@/lib/streamRevealTiming";

const TICK = streamRevealOptionsFromInterval(1);

function paraBlock(label: string, paragraphs: number): string {
  return Array.from({ length: paragraphs }, (_, i) => `${label} 문장 ${i + 1}.`).join("\n\n");
}

function applySuccessDonePlan(
  reveal: ReturnType<typeof createStreamReveal>,
  plan: ReturnType<typeof planSuccessDoneFinalContentReveal>
) {
  if (plan.action === "enqueue") {
    reveal.enqueue(plan.enqueue);
  }
}

describe("G37 success done — production-real queued-tail fixture (P0)", () => {
  it("Case A: finalContent === streamTarget with pending queue — NEW_ENQUEUE_LEN=0", () => {
    const A = "가".repeat(1000);
    const B = "나".repeat(1800);
    const displayed = A;
    const streamTarget = A + B;
    const finalContent = streamTarget;

    const plan = planSuccessDoneFinalContentReveal({
      displayed,
      streamTarget,
      finalContent,
      revealIdle: false,
      instantRevealMode: false,
    });

    assert.equal(plan.action, "noop");
    assert.equal(plan.reason, "case_a_target_owned_by_queue");

    const diag = buildSuccessDoneRevealDiagnostics({
      displayed,
      streamTarget,
      finalContent,
      revealIdle: false,
      visualRevealPending: true,
      plan,
    });
    assert.equal(diag.displayedLenAtDone, 1000);
    assert.equal(diag.targetLenAtDone, 2800);
    assert.equal(diag.finalContentLen, 2800);
    assert.equal(diag.queueOwnedGapLen, 1800);
    assert.equal(diag.newEnqueueLen, 0);
    assert.equal(diag.reconcilePlan, "noop");
  });

  it("integration: existing queue B drains to A+B exactly once (not A+B+B)", async () => {
    const A = "가".repeat(1000);
    const B = "나".repeat(1800);
    const streamTarget = A + B;
    let displayed = A;

    const reveal = createStreamReveal({ onAppend: (c) => { displayed += c; } }, TICK);
    reveal.enqueue(B);
    assert.equal(reveal.isIdle(), false);

    const plan = planSuccessDoneFinalContentReveal({
      displayed,
      streamTarget,
      finalContent: streamTarget,
      revealIdle: false,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "noop");
    applySuccessDonePlan(reveal, plan);

    assert.equal(displayed, A);
    await reveal.waitUntilIdle();
    assert.equal(displayed, streamTarget);
    assert.equal(displayed.includes(B + B), false);
  });
});

describe("G37 success done — planner cases", () => {
  it("Case B: finalContent extends streamTarget — enqueue done-only tail", () => {
    const A = "가".repeat(500);
    const B = "나".repeat(800);
    const C = "다".repeat(200);
    const displayed = A;
    const streamTarget = A + B;
    const finalContent = A + B + C;

    const plan = planSuccessDoneFinalContentReveal({
      displayed,
      streamTarget,
      finalContent,
      revealIdle: false,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "enqueue");
    if (plan.action === "enqueue") {
      assert.equal(plan.enqueue, C);
      assert.equal(plan.reason, "case_b_done_only_tail");
    }
  });

  it("Case C: streamTarget === displayed — may enqueue from displayed", () => {
    const displayed = "가".repeat(1800);
    const streamTarget = displayed;
    const finalContent = displayed + "마무리.";

    const plan = planSuccessDoneFinalContentReveal({
      displayed,
      streamTarget,
      finalContent,
      revealIdle: false,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "enqueue");
    if (plan.action === "enqueue") {
      assert.equal(plan.enqueue, "마무리.");
      assert.ok(
        plan.reason === "case_c_displayed_caught_up" || plan.reason === "case_b_done_only_tail"
      );
    }
  });

  it("Case D: final shorter/divergent while queue pending — defer, no enqueue", () => {
    const displayed = "A".repeat(900);
    const streamTarget = displayed + "B".repeat(600);
    const finalContent = "B".repeat(900);

    const plan = planSuccessDoneFinalContentReveal({
      displayed,
      streamTarget,
      finalContent,
      revealIdle: false,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "defer_canonical");
    assert.match(plan.reason, /^case_d_/);
  });
});

describe("G37 success done — integration with createStreamReveal", () => {
  it("R1: exact already-queued target — planner adds zero characters", async () => {
    const A = "가".repeat(400);
    const B = "나".repeat(600);
    const streamTarget = A + B;
    let displayed = A;

    const reveal = createStreamReveal({ onAppend: (c) => { displayed += c; } }, TICK);
    reveal.enqueue(B);

    const plan = planSuccessDoneFinalContentReveal({
      displayed,
      streamTarget,
      finalContent: streamTarget,
      revealIdle: false,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "noop");
    applySuccessDonePlan(reveal, plan);

    assert.equal(displayed, A);
    await reveal.waitUntilIdle();
    assert.equal(displayed, streamTarget);
  });

  it("R2: finalContent has additional done-only tail — enqueue C only", async () => {
    const A = "가";
    const B = "나";
    const C = "다";
    const streamTarget = A + B;
    let displayed = A;

    const reveal = createStreamReveal({ onAppend: (c) => { displayed += c; } }, TICK);
    reveal.enqueue(B);

    const plan = planSuccessDoneFinalContentReveal({
      displayed,
      streamTarget,
      finalContent: A + B + C,
      revealIdle: false,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "enqueue");
    if (plan.action === "enqueue") assert.equal(plan.enqueue, C);
    applySuccessDonePlan(reveal, plan);

    await reveal.waitUntilIdle();
    assert.equal(displayed, A + B + C);
  });

  it("R3: formatting-only difference while target ahead — defer, no duplicate", async () => {
    const fullDisplayed = paraBlock("stream", 12);
    const displayed = fullDisplayed.slice(0, 200);
    const streamTarget = fullDisplayed;
    const finalContent = fullDisplayed.replace(/\n\n/g, " ");
    let shown = displayed;

    const reveal = createStreamReveal({ onAppend: (c) => { shown += c; } }, TICK);
    reveal.enqueue(streamTarget.slice(shown.length));

    const plan = planSuccessDoneFinalContentReveal({
      displayed: shown,
      streamTarget,
      finalContent,
      revealIdle: false,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "defer_canonical");
    applySuccessDonePlan(reveal, plan);

    await reveal.waitUntilIdle();
    assert.equal(shown, streamTarget);
    const canonical = resolveCanonicalContentAtRevealIdle(shown, finalContent);
    assert.equal(canonical, shown);
  });

  it("R4: final shorter/divergent — no duplicate enqueue, idle reconciliation only", async () => {
    const displayed = "A".repeat(500);
    const streamTarget = displayed + "B".repeat(300);
    const finalContent = "C".repeat(500);
    let shown = displayed;

    const reveal = createStreamReveal({ onAppend: (c) => { shown += c; } }, TICK);
    reveal.enqueue(streamTarget.slice(displayed.length));

    const plan = planSuccessDoneFinalContentReveal({
      displayed: shown,
      streamTarget,
      finalContent,
      revealIdle: false,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "defer_canonical");
    applySuccessDonePlan(reveal, plan);

    await reveal.waitUntilIdle();
    assert.equal(shown, streamTarget);
    const canonical = resolveCanonicalContentAtRevealIdle(shown, finalContent);
    assert.equal(canonical, finalContent);
  });

  it("R5: click catch-up while success-done reconciliation pending — no duplicate tail", async () => {
    const A = "가".repeat(300);
    const B = "나".repeat(500);
    const streamTarget = A + B;
    let displayed = A;

    const reveal = createStreamReveal({ onAppend: (c) => { displayed += c; } }, TICK);
    reveal.enqueue(B);

    const plan = planSuccessDoneFinalContentReveal({
      displayed,
      streamTarget,
      finalContent: streamTarget,
      revealIdle: false,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "noop");
    let deferredCanonical = streamTarget;
    applySuccessDonePlan(reveal, plan);

    const session: PendingRevealSession = {
      controller: reveal,
      requestId: "req-r5",
      aiIndex: 0,
      catchUpToReceived: () => {
        reveal.flush();
        if (streamTarget.length > displayed.length) {
          displayed = streamTarget;
        }
      },
    };
    assert.equal(catchUpStreamRevealToReceived(session), true);
    assert.equal(displayed, streamTarget);

    await reveal.waitUntilIdle();
    assert.equal(displayed, streamTarget);
    assert.equal(displayed.includes(B + B), false);

    const canonical = resolveCanonicalContentAtRevealIdle(displayed, deferredCanonical);
    assert.equal(canonical, streamTarget);
  });

  it("R6: normal/regen parity — collapsed-prefix long stream enqueues tail when caught up", async () => {
    const displayed = "가".repeat(1800);
    const streamTarget = displayed;
    const finalContent = displayed + "마무리.";
    let shown = displayed;

    const reveal = createStreamReveal({ onAppend: (c) => { shown += c; } }, TICK);

    const plan = planSuccessDoneFinalContentReveal({
      displayed,
      streamTarget,
      finalContent,
      revealIdle: false,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "enqueue");
    applySuccessDonePlan(reveal, plan);

    await reveal.waitUntilIdle();
    assert.equal(shown, finalContent);
  });
});

describe("G37 success done — guard rails", () => {
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

  it("reveal idle bypasses success defer plan", () => {
    const plan = planSuccessDoneFinalContentReveal({
      displayed: "x".repeat(100),
      streamTarget: "x".repeat(2800),
      finalContent: "x".repeat(2800),
      revealIdle: true,
      instantRevealMode: false,
    });
    assert.equal(plan.action, "noop");
  });
});
