/**
 * Reproduces ChatClient shared-ref concurrency bug and validates session-local fix.
 * Mirrors consumeChatStream text ownership: onAppend reads/writes displayed buffer.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStreamReveal } from "@/lib/streamReveal";
import {
  planStreamRevealTermination,
  runStreamRevealTermination,
} from "@/lib/streamRevealLifecycle";
import { streamRevealOptionsFromInterval } from "@/lib/streamRevealTiming";

const TICK = streamRevealOptionsFromInterval(1);

type Row = { content: string; requestId: string };
type Draft = { requestId: string; assistantPartial: string };

type SessionText = { displayed: string; target: string };

function createSessionText(): SessionText {
  return { displayed: "", target: "" };
}

type SessionHarness = {
  text: SessionText;
  row: Row;
  draft: Draft | null;
  reveal: ReturnType<typeof createStreamReveal>;
  aiIndex: number;
  start: () => void;
  serverDone: () => void;
  snapshot: () => { displayed: string; pending: number; draft: Draft | null };
};

function createSessionHarness(
  label: "A" | "B",
  rows: Row[],
  drafts: Map<string, Draft>,
  aiIndex: number
): SessionHarness {
  const text = createSessionText();
  const row = rows[aiIndex]!;
  const requestId = row.requestId;

  const reveal = createStreamReveal(
    {
      onAppend: (chunk) => {
        text.displayed += chunk;
        row.content = text.displayed;
        drafts.set(requestId, {
          requestId,
          assistantPartial: text.displayed,
        });
      },
    },
    TICK
  );

  return {
    text,
    row,
    draft: null,
    reveal,
    aiIndex,
    start() {
      text.displayed = "";
      text.target = "";
    },
    serverDone() {
      runStreamRevealTermination(
        planStreamRevealTermination({
          instantReveal: false,
          isIdle: reveal.isIdle(),
          hadError: false,
          trafficOverload: false,
        }),
        { reveal, removeVisibilityListener: () => {} }
      );
    },
    snapshot() {
      return {
        displayed: row.content,
        pending: reveal.getPendingLength(),
        draft: drafts.get(requestId) ?? null,
      };
    },
  };
}

async function waitTicks(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

describe("CONCURRENT_REVEAL_SHARED_STATE — reproduction", () => {
  it("shared global refs cross-contaminate overlapping turns", async () => {
    const shared = createSessionText();
    const rows: Row[] = [
      { content: "", requestId: "req-a" },
      { content: "", requestId: "req-b" },
    ];

    const revealA = createStreamReveal(
      {
        onAppend: (chunk) => {
          shared.displayed += chunk;
          rows[0]!.content = shared.displayed;
        },
      },
      TICK
    );
    revealA.enqueue("A".repeat(30));
    await waitTicks(5);
    const aLenBeforeB = [...rows[0]!.content].length;
    assert.ok(aLenBeforeB > 0);

    runStreamRevealTermination(
      { action: "end_deferred" },
      { reveal: revealA, removeVisibilityListener: () => {} }
    );

    shared.displayed = "";
    shared.target = "";

    const revealB = createStreamReveal(
      {
        onAppend: (chunk) => {
          shared.displayed += chunk;
          rows[1]!.content = shared.displayed;
        },
      },
      TICK
    );
    revealB.enqueue("B".repeat(30));

    await waitTicks(15);
    await Promise.all([revealA.waitUntilIdle(), revealB.waitUntilIdle()]);

    const contaminated =
      rows[0]!.content.includes("B") ||
      rows[1]!.content.includes("A") ||
      [...rows[0]!.content].length < aLenBeforeB;

    assert.equal(contaminated, true, "CONCURRENT_REVEAL_SHARED_STATE_CONFIRMED");
  });
});

describe("session-local text state — production-equivalent gates", () => {
  async function runOverlappingTurns() {
    const rows: Row[] = [
      { content: "", requestId: "req-a" },
      { content: "", requestId: "req-b" },
    ];
    const drafts = new Map<string, Draft>();
    const sessionA = createSessionHarness("A", rows, drafts, 0);
    const sessionB = createSessionHarness("B", rows, drafts, 1);

    sessionA.start();
    sessionA.reveal.enqueue("A".repeat(40));
    await waitTicks(8);
    sessionA.serverDone();

    sessionB.start();
    sessionB.reveal.enqueue("B".repeat(40));

    await waitTicks(20);
    const mid = {
      a: sessionA.snapshot(),
      b: sessionB.snapshot(),
    };

    await Promise.all([sessionA.reveal.waitUntilIdle(), sessionB.reveal.waitUntilIdle()]);

    return {
      rows,
      drafts,
      mid,
      finalA: rows[0]!.content,
      finalB: rows[1]!.content,
    };
  }

  it("C1: Turn A pending after done → Turn B starts → content never mixes", async () => {
    const { finalA, finalB, mid } = await runOverlappingTurns();
    assert.ok(mid.a.pending > 0 || mid.a.displayed.length < 40);
    assert.ok(!finalA.includes("B"), `A must not contain B: ${finalA}`);
    assert.ok(!finalB.includes("A"), `B must not contain A: ${finalB}`);
  });

  it("C2: B start does not shrink A displayed content", async () => {
    const rows: Row[] = [
      { content: "", requestId: "req-a" },
      { content: "", requestId: "req-b" },
    ];
    const drafts = new Map<string, Draft>();
    const sessionA = createSessionHarness("A", rows, drafts, 0);
    const sessionB = createSessionHarness("B", rows, drafts, 1);

    sessionA.start();
    sessionA.reveal.enqueue("A".repeat(25));
    await waitTicks(10);
    const aMinLen = [...rows[0]!.content].length;
    assert.ok(aMinLen > 0);

    sessionA.serverDone();
    sessionB.start();
    sessionB.reveal.enqueue("B".repeat(25));
    await waitTicks(15);

    assert.ok([...rows[0]!.content].length >= aMinLen);
    await sessionA.reveal.waitUntilIdle();
    await sessionB.reveal.waitUntilIdle();
  });

  it("C3: concurrent reveals each reach exact own final target", async () => {
    const targetA = "A".repeat(30);
    const targetB = "B".repeat(30);
    const rows: Row[] = [
      { content: "", requestId: "req-a" },
      { content: "", requestId: "req-b" },
    ];
    const drafts = new Map<string, Draft>();
    const sessionA = createSessionHarness("A", rows, drafts, 0);
    const sessionB = createSessionHarness("B", rows, drafts, 1);

    sessionA.start();
    sessionA.reveal.enqueue(targetA);
    await waitTicks(5);
    sessionA.serverDone();

    sessionB.start();
    sessionB.reveal.enqueue(targetB);
    await Promise.all([sessionA.reveal.waitUntilIdle(), sessionB.reveal.waitUntilIdle()]);

    assert.equal(rows[0]!.content, targetA);
    assert.equal(rows[1]!.content, targetB);
  });

  it("C4: draft partial isolation per requestId", async () => {
    const { drafts } = await runOverlappingTurns();
    const draftA = drafts.get("req-a");
    const draftB = drafts.get("req-b");
    assert.ok(draftA);
    assert.ok(draftB);
    assert.ok(!draftA!.assistantPartial.includes("B"));
    assert.ok(!draftB!.assistantPartial.includes("A"));
  });

  it("C5: B error path does not stop A deferred reveal", async () => {
    const rows: Row[] = [
      { content: "", requestId: "req-a" },
      { content: "", requestId: "req-b" },
    ];
    const drafts = new Map<string, Draft>();
    const sessionA = createSessionHarness("A", rows, drafts, 0);
    const sessionB = createSessionHarness("B", rows, drafts, 1);
    const targetA = "A".repeat(20);

    sessionA.start();
    sessionA.reveal.enqueue(targetA);
    await waitTicks(5);
    sessionA.serverDone();

    sessionB.start();
    runStreamRevealTermination(
      { action: "end_sync", flush: true },
      { reveal: sessionB.reveal, removeVisibilityListener: () => {} }
    );

    await sessionA.reveal.waitUntilIdle();
    assert.equal(rows[0]!.content, targetA);
  });

  it("C6: background bypass applies per session only", async () => {
    let shownA = "";
    let shownB = "";
    const textA = createSessionText();
    const textB = createSessionText();
    const revealA = createStreamReveal(
      { onAppend: (c) => { textA.displayed += c; shownA = textA.displayed; } },
      TICK
    );
    const revealB = createStreamReveal(
      { onAppend: (c) => { textB.displayed += c; shownB = textB.displayed; } },
      TICK
    );
    revealA.enqueue("A1");
    revealB.enqueue("B1");
    await waitTicks(3);
    revealA.setBackgroundMode(true);
    revealA.enqueue("A2");
    assert.equal(shownA, "A1A2");
    assert.equal(shownB, "B1");
    revealB.flush();
    assert.equal(shownB, "B1");
  });

  it("C7: unmount guard skips setState after dispose", async () => {
    let mounted = true;
    let shown = "";
    const text = createSessionText();
    const reveal = createStreamReveal(
      {
        onAppend: (chunk) => {
          if (!mounted) return;
          text.displayed += chunk;
          shown = text.displayed;
        },
      },
      TICK
    );
    reveal.enqueue("xyz");
    mounted = false;
    reveal.flush();
    assert.equal(shown, "");
    assert.equal(reveal.activeTimerCount(), 0);
  });

  it("C8: speed change on active reveal does not cross-contaminate sessions", async () => {
    let intervalMs = 1;
    const textA = createSessionText();
    const textB = createSessionText();
    let shownA = "";
    let shownB = "";
    const revealA = createStreamReveal(
      { onAppend: (c) => { textA.displayed += c; shownA = textA.displayed; } },
      () => ({ intervalMs, charsPerTick: 1 })
    );
    const revealB = createStreamReveal(
      { onAppend: (c) => { textB.displayed += c; shownB = textB.displayed; } },
      TICK
    );
    revealA.enqueue("A".repeat(10));
    revealB.enqueue("B".repeat(10));
    intervalMs = 5;
    revealA.syncOptions();
    await Promise.all([revealA.waitUntilIdle(), revealB.waitUntilIdle()]);
    assert.equal(shownA, "A".repeat(10));
    assert.equal(shownB, "B".repeat(10));
    assert.ok(!shownA.includes("B"));
    assert.ok(!shownB.includes("A"));
  });

  it("C9: continue-style overlap uses isolated session text (same as send)", async () => {
    const rows: Row[] = [
      { content: "", requestId: "req-a" },
      { content: "", requestId: "req-b" },
    ];
    const drafts = new Map<string, Draft>();
    const sessionA = createSessionHarness("A", rows, drafts, 0);
    const sessionB = createSessionHarness("B", rows, drafts, 1);
    const targetA = "A".repeat(15);
    const targetB = "B".repeat(15);

    sessionA.start();
    sessionA.reveal.enqueue(targetA);
    await waitTicks(5);
    sessionA.serverDone();

    sessionB.start();
    sessionB.reveal.enqueue(targetB);
    await Promise.all([sessionA.reveal.waitUntilIdle(), sessionB.reveal.waitUntilIdle()]);

    assert.equal(rows[0]!.content, targetA);
    assert.equal(rows[1]!.content, targetB);
  });
});
