/**
 * Production-equivalent room-single-slot recovery draft lifecycle tests (D1–D10).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStreamReveal } from "@/lib/streamReveal";
import {
  planStreamRevealTermination,
  runStreamRevealTermination,
} from "@/lib/streamRevealLifecycle";
import { createStreamDraftWriteGate } from "@/lib/streamDraftLifecycle";
import {
  streamDraftStorageKey,
  type ChatStreamDraft,
} from "@/lib/streamingPersistence";
import { streamRevealOptionsFromInterval } from "@/lib/streamRevealTiming";

const TICK = streamRevealOptionsFromInterval(1);
const CHAR_ID = 1;
const CHAT_ID = 42;

type RoomStore = Map<string, ChatStreamDraft>;

function createRoomStore(): RoomStore {
  return new Map();
}

function roomKey(chatId: number | null = CHAT_ID): string {
  return streamDraftStorageKey(CHAR_ID, chatId);
}

function writeRoomDraft(store: RoomStore, chatId: number | null, draft: ChatStreamDraft) {
  store.set(roomKey(chatId), draft);
}

function readRoomDraft(store: RoomStore, chatId: number | null = CHAT_ID): ChatStreamDraft | null {
  return store.get(roomKey(chatId)) ?? null;
}

function clearRoomDraft(store: RoomStore, chatId: number | null = CHAT_ID) {
  store.delete(roomKey(chatId));
}

type SessionSim = {
  requestId: string;
  gate: ReturnType<typeof createStreamDraftWriteGate>;
  reveal: ReturnType<typeof createStreamReveal>;
  rowContent: string;
  text: string;
};

function createSessionSim(
  store: RoomStore,
  requestId: string,
  userText: string
): SessionSim {
  const gate = createStreamDraftWriteGate();
  let text = "";
  const sim: SessionSim = {
    requestId,
    gate,
    rowContent: "",
    text: "",
    reveal: createStreamReveal(
      {
        onAppend: (chunk) => {
          text += chunk;
          sim.text = text;
          sim.rowContent = text;
          gate.tryWrite(() =>
            writeRoomDraft(store, CHAT_ID, {
              requestId,
              chatId: CHAT_ID,
              userText,
              assistantPartial: text,
              updatedAt: Date.now(),
            })
          );
        },
      },
      TICK
    ),
  };
  return sim;
}

function serverDone(session: SessionSim, store: RoomStore) {
  session.gate.closeAndClear(() => clearRoomDraft(store, CHAT_ID));
  runStreamRevealTermination(
    planStreamRevealTermination({
      instantReveal: false,
      isIdle: session.reveal.isIdle(),
      hadError: false,
      trafficOverload: false,
    }),
    { reveal: session.reveal, removeVisibilityListener: () => {} }
  );
}

async function tick(ms = 15) {
  await new Promise((r) => setTimeout(r, ms));
}

describe("DEFERRED_REVEAL_DRAFT_OVERWRITE — reproduction", () => {
  it("buggy gate (clear without close) allows A to overwrite B room draft", async () => {
    const store = createRoomStore();
    let textA = "";
    const gateA = {
      active: true,
      write() {
        if (!this.active) return;
        writeRoomDraft(store, CHAT_ID, {
          requestId: "req-a",
          chatId: CHAT_ID,
          userText: "ua",
          assistantPartial: textA,
          updatedAt: Date.now(),
        });
      },
      clearOnly() {
        clearRoomDraft(store, CHAT_ID);
      },
    };
    const revealA = createStreamReveal(
      {
        onAppend: (c) => {
          textA += c;
          gateA.write();
        },
      },
      TICK
    );
    revealA.enqueue("A".repeat(20));
    await tick(5);
    gateA.clearOnly();
    assert.equal(readRoomDraft(store)?.requestId, undefined);

    writeRoomDraft(store, CHAT_ID, {
      requestId: "req-b",
      chatId: CHAT_ID,
      userText: "ub",
      assistantPartial: "B",
      updatedAt: Date.now(),
    });

    await tick(10);
    await revealA.waitUntilIdle();

    assert.equal(
      readRoomDraft(store)?.requestId,
      "req-a",
      "DEFERRED_REVEAL_DRAFT_OVERWRITE_CONFIRMED"
    );
  });
});

describe("room-single-slot draft lifecycle — D1–D10", () => {
  it("D1: A in-flight → room draft requestId=A", () => {
    const store = createRoomStore();
    const a = createSessionSim(store, "req-a", "ua");
    a.reveal.enqueue("A");
    a.gate.tryWrite(() =>
      writeRoomDraft(store, CHAT_ID, {
        requestId: "req-a",
        chatId: CHAT_ID,
        userText: "ua",
        assistantPartial: "A",
        updatedAt: Date.now(),
      })
    );
    assert.equal(readRoomDraft(store)?.requestId, "req-a");
  });

  it("D2: A server done → room draft absent", () => {
    const store = createRoomStore();
    const a = createSessionSim(store, "req-a", "ua");
    a.reveal.enqueue("AAA");
    serverDone(a, store);
    assert.equal(readRoomDraft(store), null);
  });

  it("D3: A deferred visual ticks after done → room draft remains absent", async () => {
    const store = createRoomStore();
    const a = createSessionSim(store, "req-a", "ua");
    a.reveal.enqueue("A".repeat(25));
    await tick(5);
    serverDone(a, store);
    await tick(20);
    await a.reveal.waitUntilIdle();
    assert.equal(readRoomDraft(store), null);
  });

  it("D4: A deferred + B new send → room draft requestId=B", async () => {
    const store = createRoomStore();
    const a = createSessionSim(store, "req-a", "ua");
    a.reveal.enqueue("A".repeat(30));
    await tick(5);
    serverDone(a, store);

    writeRoomDraft(store, CHAT_ID, {
      requestId: "req-b",
      chatId: CHAT_ID,
      userText: "ub",
      assistantPartial: "",
      updatedAt: Date.now(),
    });
    const b = createSessionSim(store, "req-b", "ub");
    b.reveal.enqueue("B");
    await tick(3);
    assert.equal(readRoomDraft(store)?.requestId, "req-b");
    await Promise.all([a.reveal.waitUntilIdle(), b.reveal.waitUntilIdle()]);
  });

  it("D5 P0: A deferred tick after B draft written → room draft remains req-B", async () => {
    const store = createRoomStore();
    const a = createSessionSim(store, "req-a", "ua");
    a.reveal.enqueue("A".repeat(40));
    await tick(5);
    serverDone(a, store);

    writeRoomDraft(store, CHAT_ID, {
      requestId: "req-b",
      chatId: CHAT_ID,
      userText: "ub",
      assistantPartial: "",
      updatedAt: Date.now(),
    });
    const b = createSessionSim(store, "req-b", "ub");
    b.reveal.enqueue("B".repeat(40));

    await tick(30);
    assert.equal(readRoomDraft(store)?.requestId, "req-b");
    await Promise.all([a.reveal.waitUntilIdle(), b.reveal.waitUntilIdle()]);
    assert.equal(readRoomDraft(store)?.requestId, "req-b");
  });

  it("D6: A/B visual ticks while B in-flight → room draft always belongs to B", async () => {
    const store = createRoomStore();
    const a = createSessionSim(store, "req-a", "ua");
    a.reveal.enqueue("A".repeat(50));
    await tick(5);
    serverDone(a, store);

    const b = createSessionSim(store, "req-b", "ub");
    writeRoomDraft(store, CHAT_ID, {
      requestId: "req-b",
      chatId: CHAT_ID,
      userText: "ub",
      assistantPartial: "",
      updatedAt: Date.now(),
    });
    b.reveal.enqueue("B".repeat(50));

    for (let i = 0; i < 5; i++) {
      await tick(10);
      const draft = readRoomDraft(store);
      assert.ok(draft, `tick ${i}`);
      assert.equal(draft!.requestId, "req-b");
    }
    await Promise.all([a.reveal.waitUntilIdle(), b.reveal.waitUntilIdle()]);
  });

  it("D7: B server done → room draft cleared", async () => {
    const store = createRoomStore();
    const b = createSessionSim(store, "req-b", "ub");
    b.reveal.enqueue("BBB");
    await tick(3);
    serverDone(b, store);
    assert.equal(readRoomDraft(store), null);
    await b.reveal.waitUntilIdle();
    assert.equal(readRoomDraft(store), null);
  });

  it("D8: all deferred reveals finish → no stale draft remains", async () => {
    const store = createRoomStore();
    const a = createSessionSim(store, "req-a", "ua");
    a.reveal.enqueue("A".repeat(20));
    await tick(5);
    serverDone(a, store);

    const b = createSessionSim(store, "req-b", "ub");
    b.reveal.enqueue("B".repeat(20));
    await tick(5);
    serverDone(b, store);

    await Promise.all([a.reveal.waitUntilIdle(), b.reveal.waitUntilIdle()]);
    assert.equal(readRoomDraft(store), null);
  });

  it("D9 RELOAD/RECOVERY: active generating B draft recovered, not completed A", async () => {
    const store = createRoomStore();
    const a = createSessionSim(store, "req-a", "ua");
    a.reveal.enqueue("A".repeat(30));
    await tick(5);
    serverDone(a, store);

    const b = createSessionSim(store, "req-b", "ub");
    b.reveal.enqueue("B".repeat(10));
    await tick(5);
    const draft = readRoomDraft(store);
    assert.equal(draft?.requestId, "req-b");
    assert.ok(draft!.assistantPartial.includes("B"));
    assert.ok(!draft!.assistantPartial.includes("A"));
    await Promise.all([a.reveal.waitUntilIdle(), b.reveal.waitUntilIdle()]);
  });

  it("D10: B failure closes B draft gate; A deferred ticks cannot recreate A draft", async () => {
    const store = createRoomStore();
    const a = createSessionSim(store, "req-a", "ua");
    a.reveal.enqueue("A".repeat(30));
    await tick(5);
    serverDone(a, store);

    const b = createSessionSim(store, "req-b", "ub");
    b.reveal.enqueue("BB");
    await tick(3);
    b.gate.closeAndClear(() => clearRoomDraft(store, CHAT_ID));
    runStreamRevealTermination(
      { action: "end_sync", flush: true },
      { reveal: b.reveal, removeVisibilityListener: () => {} }
    );

    await tick(20);
    await a.reveal.waitUntilIdle();
    assert.equal(readRoomDraft(store), null);
  });
});
