import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catchUpStreamRevealToReceived } from "@/lib/streamClickReveal";
import type { PendingRevealSession } from "@/lib/streamRevealIdentity";
import { createStreamReveal } from "@/lib/streamReveal";

describe("streamClickReveal", () => {
  it("catchUpToReceived flushes queue and snaps to already-received target", () => {
    let displayed = "";
    const target = "ABCDEF";
    const reveal = createStreamReveal({
      onAppend: (chunk) => {
        displayed += chunk;
      },
    });
    reveal.enqueue("AB");
    const session: PendingRevealSession = {
      controller: reveal,
      requestId: "req-1",
      aiIndex: 1,
      catchUpToReceived: () => {
        reveal.flush();
        if (target.length > displayed.length) {
          displayed = target;
        }
      },
    };
    assert.equal(catchUpStreamRevealToReceived(session), true);
    assert.equal(displayed, "ABCDEF");
  });

  it("returns false when session has no catchUp hook", () => {
    assert.equal(
      catchUpStreamRevealToReceived({
        controller: createStreamReveal({ onAppend: () => {} }),
        requestId: "req-2",
        aiIndex: 0,
      }),
      false
    );
  });
});
