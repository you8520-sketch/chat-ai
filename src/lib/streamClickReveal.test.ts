import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  catchUpStreamRevealToReceived,
  handleStreamRevealClick,
  STREAM_CLICK_REVEAL_OWNER,
} from "@/lib/streamClickReveal";
import type { PendingRevealSession } from "@/lib/streamRevealIdentity";
import { createStreamReveal } from "@/lib/streamReveal";
import { hasActiveTextSelection } from "@/lib/trpg/followLatest";

/** Interactive/selection skip invariants: `@/lib/trpg/followLatest` (`shouldSkipRevealFinishClick`). */

describe("streamClickReveal", () => {
  it("catchUpToReceived snaps to already-received target, not unreceived future chunks", () => {
    let displayed = "";
    const receivedTarget = "AB";
    const reveal = createStreamReveal({
      onAppend: (chunk) => {
        displayed += chunk;
      },
    });
    reveal.enqueue("A");
    const session: PendingRevealSession = {
      controller: reveal,
      requestId: "req-1",
      aiIndex: 1,
      catchUpToReceived: () => {
        reveal.flush();
        if (receivedTarget.length > displayed.length) {
          displayed = receivedTarget;
        }
      },
    };
    assert.equal(catchUpStreamRevealToReceived(session), true);
    assert.equal(displayed, "AB");
  });

  it("post-click chunks continue streaming via reveal queue", () => {
    let displayed = "";
    const reveal = createStreamReveal({
      onAppend: (chunk) => {
        displayed += chunk;
      },
    });
    reveal.enqueue("HELLO");
    reveal.flush();
    const session: PendingRevealSession = {
      controller: reveal,
      requestId: "req-stream",
      aiIndex: 0,
      catchUpToReceived: () => {
        reveal.flush();
      },
    };
    catchUpStreamRevealToReceived(session);
    assert.equal(displayed, "HELLO");
    reveal.enqueue(" WORLD");
    reveal.flush();
    assert.equal(displayed, "HELLO WORLD");
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

  it("catchUp only runs for the requested session id", () => {
    let displayedA = "";
    let displayedB = "";
    const revealA = createStreamReveal({ onAppend: (c) => (displayedA += c) });
    const revealB = createStreamReveal({ onAppend: (c) => (displayedB += c) });
    revealA.enqueue("A");
    revealB.enqueue("B");
    revealB.flush();
    const sessions = new Map<string, PendingRevealSession>([
      [
        "req-a",
        {
          controller: revealA,
          requestId: "req-a",
          aiIndex: 0,
          catchUpToReceived: () => {
            revealA.flush();
            displayedA = "AAA";
          },
        },
      ],
      [
        "req-b",
        {
          controller: revealB,
          requestId: "req-b",
          aiIndex: 1,
          catchUpToReceived: () => {
            revealB.flush();
            displayedB = "BBB";
          },
        },
      ],
    ]);
    assert.equal(
      catchUpStreamRevealToReceived(sessions.get("req-a")),
      true
    );
    assert.equal(displayedA, "AAA");
    assert.equal(displayedB, "B");
  });

  it("wires shouldSkipRevealFinishClick from followLatest (interactive + selection owner)", () => {
    const chatClient = readFileSync("src/app/chat/[id]/ChatClient.tsx", "utf8");
    const clickReveal = readFileSync("src/lib/streamClickReveal.ts", "utf8");
    assert.match(chatClient, /handleStreamRevealClick/);
    assert.match(clickReveal, /shouldSkipRevealFinishClick/);
    assert.match(clickReveal, new RegExp(STREAM_CLICK_REVEAL_OWNER.replace(".", "\\.")));
  });

  it("active text selection invariant owned by followLatest", () => {
    assert.equal(
      hasActiveTextSelection({
        isCollapsed: false,
        toString: () => "selected prose",
      }),
      true
    );
    assert.equal(
      hasActiveTextSelection({
        isCollapsed: true,
        toString: () => "",
      }),
      false
    );
  });

  it("handleStreamRevealClick returns false without requestId", () => {
    assert.equal(
      handleStreamRevealClick({ target: null }, null, new Map()),
      false
    );
  });
});
