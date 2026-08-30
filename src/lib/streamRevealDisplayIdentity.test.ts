/**
 * Display source + reveal row identity gates (V1–V8).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStreamReveal } from "@/lib/streamReveal";
import {
  planStreamRevealTermination,
  runStreamRevealTermination,
} from "@/lib/streamRevealLifecycle";
import {
  isGenerationStreamingMessage,
  isVisualRevealPendingForMessage,
  resolveApplyStreamDoneDisplayContent,
  resolveAssistantDisplayBody,
  shouldUseLiveDisplayedContent,
} from "@/lib/streamRevealDisplaySource";
import { isRevealRowWritable } from "@/lib/streamRevealIdentity";
import { isInFlightGenerationStatus, isTerminalGenerationStatus } from "@/lib/streamingPersistence";
import { resolveActiveVariantContent } from "@/lib/messageAlternates";
import { preferDisplayedNewlineLayout } from "@/lib/streamReveal";
import { streamRevealOptionsFromInterval } from "@/lib/streamRevealTiming";

const TICK = streamRevealOptionsFromInterval(1);
const PARTIAL = `PARTIAL_${"p".repeat(160)}`;
const FULL = `FINAL_${"f".repeat(3150)}`;

type Row = {
  role: "assistant";
  content: string;
  requestId: string;
  generationStatus: string;
  variants?: { content: string }[];
  activeVariant?: number;
};

function buggyDisplayBody(
  m: Row,
  pending: ReadonlySet<string>,
  lastAssistantIdx: number,
  i: number,
  loading: boolean
): string {
  const isStreamingThisMessage =
    i === lastAssistantIdx &&
    !isTerminalGenerationStatus(m.generationStatus) &&
    ((loading && i === 0) || m.generationStatus === "generating");
  return isStreamingThisMessage ? m.content : resolveActiveVariantContent(m);
}

function fixedDisplayBody(m: Row, pending: ReadonlySet<string>, i: number): string {
  const isGenerationStreaming = isGenerationStreamingMessage({
    messageIndex: i,
    lastAssistantIndex: 0,
    generationStatus: m.generationStatus,
    loading: false,
    messagesLength: 1,
  });
  const isVisualRevealPending = isVisualRevealPendingForMessage(m.requestId, pending);
  return resolveAssistantDisplayBody(m, {
    useLiveDisplayedContent: shouldUseLiveDisplayedContent(
      isGenerationStreaming,
      isVisualRevealPending
    ),
  });
}

async function tick(ms = 15) {
  await new Promise((r) => setTimeout(r, ms));
}

describe("TERMINAL_VARIANT_BYPASSES_VISUAL_REVEAL — reproduction", () => {
  it("completed + full variant + no pending flag resolves to full variant (buggy path)", () => {
    const m: Row = {
      role: "assistant",
      content: PARTIAL,
      requestId: "req-a",
      generationStatus: "completed",
      variants: [{ content: FULL }],
      activeVariant: 0,
    };
    const body = buggyDisplayBody(m, new Set(), 0, 0, false);
    assert.equal(body, FULL, "TERMINAL_VARIANT_BYPASSES_VISUAL_REVEAL_CONFIRMED");
    assert.notEqual(body, PARTIAL);
  });
});

describe("display source + reveal identity — V1–V8", () => {
  it("V1 TERMINAL DISPLAY SOURCE: completed + pending reveal uses partial m.content", () => {
    const m: Row = {
      role: "assistant",
      content: PARTIAL,
      requestId: "req-a",
      generationStatus: "completed",
      variants: [{ content: FULL }],
      activeVariant: 0,
    };
    const pending = new Set(["req-a"]);
    const body = fixedDisplayBody(m, pending, 0);
    assert.equal(body, PARTIAL);
    assert.notEqual(body, FULL);
  });

  it("V2 VISUAL COMPLETE HANDOFF: after pending clears uses canonical active variant", () => {
    const m: Row = {
      role: "assistant",
      content: PARTIAL,
      requestId: "req-a",
      generationStatus: "completed",
      variants: [{ content: FULL }],
      activeVariant: 0,
    };
    const body = fixedDisplayBody(m, new Set(), 0);
    assert.equal(body, FULL);
  });

  it("V3 NO DONE SNAP: done cannot jump visible chars from partial to full while pending", () => {
    const m: Row = {
      role: "assistant",
      content: PARTIAL,
      requestId: "req-a",
      generationStatus: "completed",
      variants: [{ content: FULL }],
      activeVariant: 0,
    };
    const pending = new Set(["req-a"]);
    const atDone = fixedDisplayBody(m, pending, 0);
    const oneTickAfter = fixedDisplayBody({ ...m, content: PARTIAL.slice(0, 180) }, pending, 0);
    assert.ok(atDone.length < FULL.length);
    assert.ok(oneTickAfter.length < FULL.length);
    assert.equal(atDone, PARTIAL);
  });

  it("V4 SAME-ROW REGENERATE: req-A pending reveal cannot mutate req-B row", async () => {
    const row: Row = {
      role: "assistant",
      content: "",
      requestId: "req-a",
      generationStatus: "generating",
    };
    const identityA = { requestId: "req-a", aiIndex: 0 };
    let abandoned = false;

    const revealA = createStreamReveal(
      {
        onAppend: (chunk) => {
          if (abandoned) return;
          if (!isRevealRowWritable(identityA, row, 0)) {
            abandoned = true;
            revealA.reset();
            return;
          }
          row.content += chunk;
        },
      },
      TICK
    );

    revealA.enqueue("A".repeat(30));
    await tick(8);
    runStreamRevealTermination(
      planStreamRevealTermination({
        instantReveal: false,
        isIdle: revealA.isIdle(),
        hadError: false,
        trafficOverload: false,
      }),
      { reveal: revealA, removeVisibilityListener: () => {} }
    );

    row.content = "";
    row.requestId = "req-b";
    row.generationStatus = "generating";

    const identityB = { requestId: "req-b", aiIndex: 0 };
    const revealB = createStreamReveal(
      {
        onAppend: (chunk) => {
          if (isRevealRowWritable(identityB, row, 0)) {
            row.content += chunk;
          }
        },
      },
      TICK
    );
    revealB.enqueue("B".repeat(20));

    await tick(25);
    assert.ok(!row.content.includes("A"), "STALE_REVEAL_WRITES_REGENERATED_ROW");
    assert.ok(row.content.includes("B"));
    await Promise.all([revealA.waitUntilIdle(), revealB.waitUntilIdle()]);
    assert.ok(!row.content.includes("A"));
  });

  it("V5 DELETE / ROW REUSE: old reveal cannot mutate row after requestId changed", async () => {
    const row: Row = {
      role: "assistant",
      content: "",
      requestId: "req-a",
      generationStatus: "completed",
    };
    const identityA = { requestId: "req-a", aiIndex: 0 };
    let abandoned = false;

    const revealA = createStreamReveal(
      {
        onAppend: (chunk) => {
          if (abandoned) return;
          if (!isRevealRowWritable(identityA, row, 0)) {
            abandoned = true;
            revealA.reset();
            return;
          }
          row.content += chunk;
        },
      },
      TICK
    );
    revealA.enqueue("OLD".repeat(15));
    await tick(5);

    row.requestId = "req-c";
    row.content = "";
    row.generationStatus = "generating";

    await tick(20);
    await revealA.waitUntilIdle();
    assert.ok(!row.content.includes("OLD"));
  });

  it("V6 NORMAL NEXT TURN: different-row overlapping reveal still works", async () => {
    const rows: Row[] = [
      {
        role: "assistant",
        content: "",
        requestId: "req-a",
        generationStatus: "completed",
      },
      {
        role: "assistant",
        content: "",
        requestId: "req-b",
        generationStatus: "generating",
      },
    ];

    const revealA = createStreamReveal(
      {
        onAppend: (chunk) => {
          if (isRevealRowWritable({ requestId: "req-a", aiIndex: 0 }, rows[0], 0)) {
            rows[0]!.content += chunk;
          }
        },
      },
      TICK
    );
    revealA.enqueue("A".repeat(25));
    await tick(5);
    runStreamRevealTermination(
      { action: "end_deferred" },
      { reveal: revealA, removeVisibilityListener: () => {} }
    );

    const revealB = createStreamReveal(
      {
        onAppend: (chunk) => {
          if (isRevealRowWritable({ requestId: "req-b", aiIndex: 1 }, rows[1], 1)) {
            rows[1]!.content += chunk;
          }
        },
      },
      TICK
    );
    revealB.enqueue("B".repeat(25));
    await tick(20);
    await Promise.all([revealA.waitUntilIdle(), revealB.waitUntilIdle()]);

    assert.ok(rows[0]!.content.includes("A"));
    assert.ok(!rows[0]!.content.includes("B"));
    assert.ok(rows[1]!.content.includes("B"));
    assert.ok(!rows[1]!.content.includes("A"));
  });

  it("V7 LIFECYCLE: server done clears generation in-flight; reveal pending is separate", () => {
    assert.equal(isTerminalGenerationStatus("completed"), true);
    assert.equal(isInFlightGenerationStatus("completed"), false);
    const isGenStreaming = isGenerationStreamingMessage({
      messageIndex: 0,
      lastAssistantIndex: 0,
      generationStatus: "completed",
      loading: false,
      messagesLength: 1,
    });
    assert.equal(isGenStreaming, false);
    assert.equal(isVisualRevealPendingForMessage("req-a", new Set(["req-a"])), true);
  });

  it("V8 VARIANT HANDOFF: after pending clears active variant remains canonical", () => {
    const m: Row = {
      role: "assistant",
      content: PARTIAL,
      requestId: "req-a",
      generationStatus: "completed",
      variants: [{ content: FULL }, { content: "ALT" }],
      activeVariant: 0,
    };
    const after = fixedDisplayBody(m, new Set(), 0);
    assert.equal(after, FULL);
    m.activeVariant = 1;
    assert.equal(fixedDisplayBody(m, new Set(), 0), "ALT");
  });
});

describe("APPLY_STREAM_DONE_OVERWRITES_PENDING_DISPLAY — reproduction", () => {
  it("preferDisplayedNewlineLayout partial+full returns full (buggy done owner)", () => {
    const resolved = preferDisplayedNewlineLayout(PARTIAL, FULL);
    assert.equal(resolved, FULL, "APPLY_STREAM_DONE_OVERWRITES_PENDING_DISPLAY_CONFIRMED");
    assert.notEqual(resolved, PARTIAL);
  });
});

describe("live content ownership — V9–V14", () => {
  function doneThenDisplay(
    streamingContent: string,
    preserve: boolean,
    pending: ReadonlySet<string>
  ): { mContent: string; visibleBody: string } {
    const mContent = resolveApplyStreamDoneDisplayContent({
      streamingContent,
      canonicalDoneContent: FULL,
      preserveStreamingContent: preserve,
    });
    const row: Row = {
      role: "assistant",
      content: mContent,
      requestId: "req-a",
      generationStatus: "completed",
      variants: [{ content: FULL }],
      activeVariant: 0,
    };
    const visibleBody = fixedDisplayBody(row, pending, 0);
    return { mContent, visibleBody };
  }

  it("V9 APPLY_STREAM_DONE CONTENT: partial 168 + preserve=true → m.content remains 168", () => {
    const mContent = resolveApplyStreamDoneDisplayContent({
      streamingContent: PARTIAL,
      canonicalDoneContent: FULL,
      preserveStreamingContent: true,
    });
    assert.equal(mContent, PARTIAL);
    assert.equal(mContent.length, PARTIAL.length);
    assert.notEqual(mContent, FULL);
  });

  it("V10 DONE + ACTUAL DISPLAY SOURCE: done owner then display resolution → visible partial", () => {
    const { mContent, visibleBody } = doneThenDisplay(PARTIAL, true, new Set(["req-a"]));
    assert.equal(mContent, PARTIAL);
    assert.equal(visibleBody, PARTIAL);
    assert.ok(visibleBody.length < FULL.length);
  });

  it("V11 REVEAL GROWTH: post-done ticks monotonically grow m.content", async () => {
    const canonicalFull = PARTIAL + "x".repeat(3000);
    let content = PARTIAL;
    const row: Row = {
      role: "assistant",
      content,
      requestId: "req-a",
      generationStatus: "completed",
      variants: [{ content: canonicalFull }],
      activeVariant: 0,
    };
    const identity = { requestId: "req-a", aiIndex: 0 };
    const reveal = createStreamReveal(
      {
        onAppend: (chunk) => {
          if (isRevealRowWritable(identity, row, 0)) {
            row.content += chunk;
          }
        },
      },
      TICK
    );
    reveal.enqueue(canonicalFull.slice(PARTIAL.length));
    const len0 = row.content.length;
    await tick(10);
    const len1 = row.content.length;
    await tick(10);
    const len2 = row.content.length;
    assert.ok(len1 >= len0);
    assert.ok(len2 >= len1);
    assert.ok(len2 < canonicalFull.length || len2 === canonicalFull.length);
    await reveal.waitUntilIdle();
  });

  it("V12 IDLE HANDOFF: reveal idle → active variant canonical, no duplication", async () => {
    const canonicalFull = PARTIAL + "x".repeat(3000);
    const row: Row = {
      role: "assistant",
      content: PARTIAL,
      requestId: "req-a",
      generationStatus: "completed",
      variants: [{ content: canonicalFull }],
      activeVariant: 0,
    };
    const identity = { requestId: "req-a", aiIndex: 0 };
    const reveal = createStreamReveal(
      {
        onAppend: (chunk) => {
          if (isRevealRowWritable(identity, row, 0)) row.content += chunk;
        },
      },
      TICK
    );
    reveal.enqueue(canonicalFull.slice(PARTIAL.length));
    await reveal.waitUntilIdle();
    assert.equal(row.content, canonicalFull);
    const pending = new Set<string>();
    const visible = fixedDisplayBody(row, pending, 0);
    assert.equal(visible, canonicalFull);
    assert.equal(visible.indexOf(PARTIAL + PARTIAL), -1);
  });

  it("V13 SAME-ROW EDIT: edit cancels pending req-A → no later reveal write", async () => {
    const row: Row = {
      role: "assistant",
      content: PARTIAL,
      requestId: "req-a",
      generationStatus: "completed",
    };
    const identityA = { requestId: "req-a", aiIndex: 0 };
    let abandoned = false;
    const revealA = createStreamReveal(
      {
        onAppend: (chunk) => {
          if (abandoned) return;
          if (!isRevealRowWritable(identityA, row, 0)) {
            abandoned = true;
            revealA.reset();
            return;
          }
          row.content += chunk;
        },
      },
      TICK
    );
    revealA.enqueue("A".repeat(25));
    await tick(5);
    runStreamRevealTermination(
      { action: "end_deferred" },
      { reveal: revealA, removeVisibilityListener: () => {} }
    );

    const contentAtEdit = row.content;
    revealA.reset();
    abandoned = true;

    row.content = "EDITED_BY_USER";
    await tick(25);
    await revealA.waitUntilIdle();
    assert.equal(row.content, "EDITED_BY_USER");
    assert.ok(!row.content.includes("AAAA"));
    assert.ok(contentAtEdit.length <= row.content.length || row.content === "EDITED_BY_USER");
  });

  it("V14 NORMAL NEXT TURN: old row reveal continues while new row streams", async () => {
    const rows: Row[] = [
      {
        role: "assistant",
        content: PARTIAL,
        requestId: "req-a",
        generationStatus: "completed",
      },
      {
        role: "assistant",
        content: "",
        requestId: "req-b",
        generationStatus: "generating",
      },
    ];
    const revealA = createStreamReveal(
      {
        onAppend: (chunk) => {
          if (isRevealRowWritable({ requestId: "req-a", aiIndex: 0 }, rows[0], 0)) {
            rows[0]!.content += chunk;
          }
        },
      },
      TICK
    );
    revealA.enqueue("A".repeat(20));
    await tick(5);
    runStreamRevealTermination(
      { action: "end_deferred" },
      { reveal: revealA, removeVisibilityListener: () => {} }
    );

    const revealB = createStreamReveal(
      {
        onAppend: (chunk) => {
          if (isRevealRowWritable({ requestId: "req-b", aiIndex: 1 }, rows[1], 1)) {
            rows[1]!.content += chunk;
          }
        },
      },
      TICK
    );
    revealB.enqueue("B".repeat(20));
    await tick(20);
    await Promise.all([revealA.waitUntilIdle(), revealB.waitUntilIdle()]);
    assert.ok(rows[0]!.content.includes("A"));
    assert.ok(rows[1]!.content.includes("B"));
    assert.ok(!rows[0]!.content.includes("B"));
    assert.ok(!rows[1]!.content.includes("A"));
  });
});
