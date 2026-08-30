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
  resolveAssistantDisplayBody,
  shouldUseLiveDisplayedContent,
} from "@/lib/streamRevealDisplaySource";
import { isRevealRowWritable } from "@/lib/streamRevealIdentity";
import { isInFlightGenerationStatus, isTerminalGenerationStatus } from "@/lib/streamingPersistence";
import { resolveActiveVariantContent } from "@/lib/messageAlternates";
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
