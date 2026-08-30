/**
 * Production-equivalent room-single-slot recovery draft lifecycle tests (D1–D10, N1–N8).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStreamReveal } from "@/lib/streamReveal";
import {
  planStreamRevealTermination,
  runStreamRevealTermination,
} from "@/lib/streamRevealLifecycle";
import {
  createStreamDraftWriteGate,
  createSessionRecoveryDraftScope,
  adoptSessionRecoveryDraftChatId,
  clearRecoveryDraftScopes,
  type RecoveryDraftScopeOps,
} from "@/lib/streamDraftLifecycle";
import {
  streamDraftStorageKey,
  type ChatStreamDraft,
} from "@/lib/streamingPersistence";
import { streamRevealOptionsFromInterval } from "@/lib/streamRevealTiming";

const TICK = streamRevealOptionsFromInterval(1);
const CHAR_ID = 1;
const CHAT_ID = 42;
const REAL_CHAT_ID = 42;

type RoomStore = Map<string, ChatStreamDraft>;

function createRoomStore(): RoomStore {
  return new Map();
}

function roomKey(chatId: number | null): string {
  return streamDraftStorageKey(CHAR_ID, chatId);
}

function writeRoomDraft(store: RoomStore, chatId: number | null, draft: ChatStreamDraft) {
  store.set(roomKey(chatId), draft);
}

function readRoomDraft(store: RoomStore, chatId: number | null): ChatStreamDraft | null {
  return store.get(roomKey(chatId)) ?? null;
}

function clearRoomDraft(store: RoomStore, chatId: number | null) {
  store.delete(roomKey(chatId));
}

function createScopeOps(store: RoomStore): RecoveryDraftScopeOps {
  return {
    clearScope: (id) => clearRoomDraft(store, id),
    readScope: (id) => readRoomDraft(store, id),
    writeScope: (id, draft) => writeRoomDraft(store, id, draft),
  };
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
  userText: string,
  chatId: number | null = CHAT_ID
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
            writeRoomDraft(store, chatId, {
              requestId,
              chatId: chatId ?? 0,
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

type NewChatScopeSim = {
  requestId: string;
  gate: ReturnType<typeof createStreamDraftWriteGate>;
  scope: ReturnType<typeof createSessionRecoveryDraftScope>;
  ops: RecoveryDraftScopeOps;
  reveal: ReturnType<typeof createStreamReveal>;
  text: string;
  writeDraft: (partial: string) => void;
  closeDraft: () => void;
  adoptChatId: (nextChatId: number, partial?: string) => void;
};

function createNewChatScopeSim(
  store: RoomStore,
  requestId: string,
  userText: string
): NewChatScopeSim {
  const gate = createStreamDraftWriteGate();
  const scope = createSessionRecoveryDraftScope(null);
  const ops = createScopeOps(store);
  let text = "";
  const sim: NewChatScopeSim = {
    requestId,
    gate,
    scope,
    ops,
    text: "",
    reveal: null as unknown as ReturnType<typeof createStreamReveal>,
    writeDraft(partial: string) {
      gate.tryWrite(() =>
        writeRoomDraft(store, scope.chatId, {
          requestId,
          chatId: scope.chatId ?? 0,
          userText,
          assistantPartial: partial,
          updatedAt: Date.now(),
        })
      );
    },
    closeDraft() {
      gate.closeAndClear(() => clearRecoveryDraftScopes(scope, (id) => clearRoomDraft(store, id)));
    },
    adoptChatId(nextChatId: number, partial?: string) {
      const snapshot =
        partial != null
          ? {
              requestId,
              chatId: nextChatId,
              userText,
              assistantPartial: partial,
              updatedAt: Date.now(),
            }
          : undefined;
      adoptSessionRecoveryDraftChatId(scope, nextChatId, ops, snapshot);
    },
  };
  sim.reveal = createStreamReveal(
    {
      onAppend: (chunk) => {
        text += chunk;
        sim.text = text;
        sim.writeDraft(text);
      },
    },
    TICK
  );
  return sim;
}

function serverDone(session: SessionSim, store: RoomStore, chatId: number | null = CHAT_ID) {
  session.gate.closeAndClear(() => clearRoomDraft(store, chatId));
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

describe("NEW_CHAT_SCOPE_MIGRATION — reproduction (pre-fix closure chatId)", () => {
  it("stale `new` key survives when onAppend uses closure null after turn_persisted", async () => {
    const store = createRoomStore();
    const requestId = "req-a";
    const closureChatId: number | null = null;
    let text = "";

    writeRoomDraft(store, null, {
      requestId,
      chatId: 0,
      userText: "hello",
      assistantPartial: "",
      updatedAt: Date.now(),
    });
    assert.ok(readRoomDraft(store, null), "N1 initial `new` key exists");

    writeRoomDraft(store, REAL_CHAT_ID, {
      requestId,
      chatId: REAL_CHAT_ID,
      userText: "hello",
      assistantPartial: "partial-from-turn-persisted",
      updatedAt: Date.now(),
    });
    clearRoomDraft(store, null);

    const reveal = createStreamReveal(
      {
        onAppend: (chunk) => {
          text += chunk;
          writeRoomDraft(store, closureChatId, {
            requestId,
            chatId: closureChatId ?? 0,
            userText: "hello",
            assistantPartial: text,
            updatedAt: Date.now(),
          });
        },
      },
      TICK
    );
    reveal.enqueue("more-after-persist");
    await tick(10);

    assert.ok(
      readRoomDraft(store, null),
      "OLD_NEW_SCOPE_AFTER_MIGRATION — post-persist append wrote stale `new` key"
    );
    assert.equal(readRoomDraft(store, REAL_CHAT_ID)?.assistantPartial, "partial-from-turn-persisted");

    clearRoomDraft(store, REAL_CHAT_ID);
    assert.ok(
      readRoomDraft(store, null),
      "NO_STALE_NEW_SCOPE_AFTER_DONE — done cleared real chat only; `new` survives"
    );
  });
});

describe("new-chat scope migration — N1–N8", () => {
  it("N1: null chat initial write → `new` key owns req-A", () => {
    const store = createRoomStore();
    const sim = createNewChatScopeSim(store, "req-a", "hello");
    sim.writeDraft("");
    assert.equal(readRoomDraft(store, null)?.requestId, "req-a");
    assert.equal(readRoomDraft(store, REAL_CHAT_ID), null);
  });

  it("N2: turn_persisted → chatId 42 → `new` removed, 42 owns req-A", () => {
    const store = createRoomStore();
    const sim = createNewChatScopeSim(store, "req-a", "hello");
    sim.writeDraft("partial");
    sim.adoptChatId(REAL_CHAT_ID, "partial");
    assert.equal(readRoomDraft(store, null), null);
    assert.equal(readRoomDraft(store, REAL_CHAT_ID)?.requestId, "req-a");
    assert.equal(readRoomDraft(store, REAL_CHAT_ID)?.assistantPartial, "partial");
  });

  it("N3: append after migration → only key 42 updates, `new` stays absent", async () => {
    const store = createRoomStore();
    const sim = createNewChatScopeSim(store, "req-a", "hello");
    sim.writeDraft("");
    sim.adoptChatId(REAL_CHAT_ID, "");
    sim.reveal.enqueue("ABCDEF");
    await tick(10);
    assert.equal(readRoomDraft(store, null), null);
    assert.ok(readRoomDraft(store, REAL_CHAT_ID)?.assistantPartial.includes("A"));
    assert.equal(readRoomDraft(store, REAL_CHAT_ID)?.requestId, "req-a");
  });

  it("N4: mid-stream reload after URL moved to chat 42 → recovery from key 42", async () => {
    const store = createRoomStore();
    const sim = createNewChatScopeSim(store, "req-a", "hello");
    sim.writeDraft("");
    sim.adoptChatId(REAL_CHAT_ID, "");
    sim.reveal.enqueue("RECOVERY_PARTIAL");
    await tick(10);
    const recovered = readRoomDraft(store, REAL_CHAT_ID);
    assert.equal(recovered?.requestId, "req-a");
    assert.ok(recovered!.assistantPartial.includes("RECOVERY"));
    assert.equal(readRoomDraft(store, null), null);
  });

  it("N5: normal done → both 42 and `new` keys absent", async () => {
    const store = createRoomStore();
    const sim = createNewChatScopeSim(store, "req-a", "hello");
    sim.writeDraft("");
    sim.adoptChatId(REAL_CHAT_ID, "");
    sim.reveal.enqueue("DONE");
    await tick(5);
    sim.closeDraft();
    runStreamRevealTermination(
      planStreamRevealTermination({
        instantReveal: false,
        isIdle: sim.reveal.isIdle(),
        hadError: false,
        trafficOverload: false,
      }),
      { reveal: sim.reveal, removeVisibilityListener: () => {} }
    );
    await tick(20);
    await sim.reveal.waitUntilIdle();
    assert.equal(readRoomDraft(store, REAL_CHAT_ID), null);
    assert.equal(readRoomDraft(store, null), null);
  });

  it("N6: future brand-new chat for same character → no stale prior `new` draft", async () => {
    const store = createRoomStore();
    const a = createNewChatScopeSim(store, "req-a", "first");
    a.writeDraft("old-turn");
    a.adoptChatId(REAL_CHAT_ID, "old-turn");
    a.reveal.enqueue("OLD");
    await tick(5);
    a.closeDraft();
    await tick(20);
    await a.reveal.waitUntilIdle();
    assert.equal(readRoomDraft(store, null), null);
    assert.equal(readRoomDraft(store, REAL_CHAT_ID), null);

    const b = createNewChatScopeSim(store, "req-b", "fresh");
    b.writeDraft("");
    assert.equal(readRoomDraft(store, null)?.requestId, "req-b");
    assert.notEqual(readRoomDraft(store, null)?.assistantPartial, "old-turn");
  });

  it("N7: EOF terminal after scope migration → real-chat scope cleared", async () => {
    const store = createRoomStore();
    const sim = createNewChatScopeSim(store, "req-a", "hello");
    sim.writeDraft("");
    sim.adoptChatId(REAL_CHAT_ID, "partial");
    sim.reveal.enqueue("EOF");
    await tick(5);
    sim.closeDraft();
    assert.equal(readRoomDraft(store, REAL_CHAT_ID), null);
    assert.equal(readRoomDraft(store, null), null);
  });

  it("N8: A migrated+done+deferred, then B send → B owns scope; A cannot recreate old/new", async () => {
    const store = createRoomStore();
    const a = createNewChatScopeSim(store, "req-a", "ua");
    a.writeDraft("");
    a.adoptChatId(REAL_CHAT_ID, "");
    a.reveal.enqueue("A".repeat(30));
    await tick(5);
    a.closeDraft();
    runStreamRevealTermination(
      planStreamRevealTermination({
        instantReveal: false,
        isIdle: a.reveal.isIdle(),
        hadError: false,
        trafficOverload: false,
      }),
      { reveal: a.reveal, removeVisibilityListener: () => {} }
    );

    const b = createSessionSim(store, "req-b", "ub", REAL_CHAT_ID);
    writeRoomDraft(store, REAL_CHAT_ID, {
      requestId: "req-b",
      chatId: REAL_CHAT_ID,
      userText: "ub",
      assistantPartial: "",
      updatedAt: Date.now(),
    });
    b.reveal.enqueue("B".repeat(20));
    await tick(30);
    assert.equal(readRoomDraft(store, REAL_CHAT_ID)?.requestId, "req-b");
    assert.equal(readRoomDraft(store, null), null);
    await Promise.all([a.reveal.waitUntilIdle(), b.reveal.waitUntilIdle()]);
    assert.equal(readRoomDraft(store, REAL_CHAT_ID)?.requestId, "req-b");
    assert.equal(readRoomDraft(store, null), null);
  });
});

describe("POST_TERMINAL_SCOPE_MIGRATION — reproduction (pre-fix ungated deferred updater)", () => {
  it("POST_TERMINAL_SCOPE_MIGRATION_WRITE_CONFIRMED when adopt runs after gate close", () => {
    const store = createRoomStore();
    const gate = createStreamDraftWriteGate();
    const scope = createSessionRecoveryDraftScope(null);
    const ops = createScopeOps(store);

    writeRoomDraft(store, null, {
      requestId: "req-a",
      chatId: 0,
      userText: "hello",
      assistantPartial: "partial",
      updatedAt: Date.now(),
    });

    const deferredUpdater = () => {
      adoptSessionRecoveryDraftChatId(scope, REAL_CHAT_ID, ops, {
        requestId: "req-a",
        chatId: REAL_CHAT_ID,
        userText: "hello",
        assistantPartial: "partial",
        updatedAt: Date.now(),
      });
    };

    gate.closeAndClear(() => clearRecoveryDraftScopes(scope, (id) => clearRoomDraft(store, id)));
    assert.equal(gate.isActive(), false);
    assert.equal(readRoomDraft(store, REAL_CHAT_ID), null);

    deferredUpdater();

    assert.ok(
      readRoomDraft(store, REAL_CHAT_ID),
      "POST_TERMINAL_SCOPE_MIGRATION_WRITE_CONFIRMED"
    );
  });
});

describe("scope migration scheduling — N9–N12", () => {
  function gatedAdopt(
    gate: ReturnType<typeof createStreamDraftWriteGate>,
    scope: ReturnType<typeof createSessionRecoveryDraftScope>,
    ops: RecoveryDraftScopeOps,
    nextChatId: number
  ) {
    gate.tryWrite(() => adoptSessionRecoveryDraftChatId(scope, nextChatId, ops));
  }

  function closeGate(
    gate: ReturnType<typeof createStreamDraftWriteGate>,
    scope: ReturnType<typeof createSessionRecoveryDraftScope>,
    store: RoomStore
  ) {
    gate.closeAndClear(() => clearRecoveryDraftScopes(scope, (id) => clearRoomDraft(store, id)));
  }

  it("N9 DEFERRED_REACT_UPDATER: done closes gate before deferred updater → no draft recreated", () => {
    const store = createRoomStore();
    const gate = createStreamDraftWriteGate();
    const scope = createSessionRecoveryDraftScope(null);
    const ops = createScopeOps(store);

    writeRoomDraft(store, null, {
      requestId: "req-a",
      chatId: 0,
      userText: "hello",
      assistantPartial: "",
      updatedAt: Date.now(),
    });

    const deferredUpdater = () => gatedAdopt(gate, scope, ops, REAL_CHAT_ID);
    closeGate(gate, scope, store);
    deferredUpdater();

    assert.equal(gate.isActive(), false);
    assert.equal(readRoomDraft(store, REAL_CHAT_ID), null);
    assert.equal(readRoomDraft(store, null), null);
  });

  it("N10 ALREADY_COMPLETED_BURST: sync turn_persisted then done → terminal clear wins", () => {
    const store = createRoomStore();
    const gate = createStreamDraftWriteGate();
    const scope = createSessionRecoveryDraftScope(null);
    const ops = createScopeOps(store);

    writeRoomDraft(store, null, {
      requestId: "req-a",
      chatId: 0,
      userText: "hello",
      assistantPartial: "burst",
      updatedAt: Date.now(),
    });

    gatedAdopt(gate, scope, ops, REAL_CHAT_ID);
    assert.equal(readRoomDraft(store, null), null);
    assert.equal(readRoomDraft(store, REAL_CHAT_ID)?.requestId, "req-a");

    closeGate(gate, scope, store);

    assert.equal(gate.isActive(), false);
    assert.equal(readRoomDraft(store, REAL_CHAT_ID), null);
    assert.equal(readRoomDraft(store, null), null);
  });

  it("N11 LATE_TURN_PERSISTED_AFTER_TERMINAL: gate closed → migration is no-op", () => {
    const store = createRoomStore();
    const gate = createStreamDraftWriteGate();
    const scope = createSessionRecoveryDraftScope(null);
    const ops = createScopeOps(store);

    writeRoomDraft(store, null, {
      requestId: "req-a",
      chatId: 0,
      userText: "hello",
      assistantPartial: "",
      updatedAt: Date.now(),
    });

    closeGate(gate, scope, store);
    gatedAdopt(gate, scope, ops, REAL_CHAT_ID);

    assert.equal(gate.isActive(), false);
    assert.equal(readRoomDraft(store, REAL_CHAT_ID), null);
    assert.equal(readRoomDraft(store, null), null);
  });

  it("N12 DUPLICATE_TURN_PERSISTED: same real chatId twice → no mis-scoped mutation", () => {
    const store = createRoomStore();
    const gate = createStreamDraftWriteGate();
    const scope = createSessionRecoveryDraftScope(null);
    const ops = createScopeOps(store);

    writeRoomDraft(store, null, {
      requestId: "req-a",
      chatId: 0,
      userText: "hello",
      assistantPartial: "first",
      updatedAt: Date.now(),
    });

    gatedAdopt(gate, scope, ops, REAL_CHAT_ID);
    const afterFirst = readRoomDraft(store, REAL_CHAT_ID);
    gatedAdopt(gate, scope, ops, REAL_CHAT_ID);
    const afterSecond = readRoomDraft(store, REAL_CHAT_ID);

    assert.equal(scope.chatId, REAL_CHAT_ID);
    assert.equal(afterSecond?.requestId, "req-a");
    assert.equal(afterSecond?.assistantPartial, afterFirst?.assistantPartial);
    assert.equal(readRoomDraft(store, null), null);
  });
});

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
    assert.equal(readRoomDraft(store, CHAT_ID)?.requestId, undefined);

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
      readRoomDraft(store, CHAT_ID)?.requestId,
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
    assert.equal(readRoomDraft(store, CHAT_ID)?.requestId, "req-a");
  });

  it("D2: A server done → room draft absent", () => {
    const store = createRoomStore();
    const a = createSessionSim(store, "req-a", "ua");
    a.reveal.enqueue("AAA");
    serverDone(a, store);
    assert.equal(readRoomDraft(store, CHAT_ID), null);
  });

  it("D3: A deferred visual ticks after done → room draft remains absent", async () => {
    const store = createRoomStore();
    const a = createSessionSim(store, "req-a", "ua");
    a.reveal.enqueue("A".repeat(25));
    await tick(5);
    serverDone(a, store);
    await tick(20);
    await a.reveal.waitUntilIdle();
    assert.equal(readRoomDraft(store, CHAT_ID), null);
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
    assert.equal(readRoomDraft(store, CHAT_ID)?.requestId, "req-b");
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
    assert.equal(readRoomDraft(store, CHAT_ID)?.requestId, "req-b");
    await Promise.all([a.reveal.waitUntilIdle(), b.reveal.waitUntilIdle()]);
    assert.equal(readRoomDraft(store, CHAT_ID)?.requestId, "req-b");
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
      const draft = readRoomDraft(store, CHAT_ID);
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
    assert.equal(readRoomDraft(store, CHAT_ID), null);
    await b.reveal.waitUntilIdle();
    assert.equal(readRoomDraft(store, CHAT_ID), null);
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
    assert.equal(readRoomDraft(store, CHAT_ID), null);
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
    const draft = readRoomDraft(store, CHAT_ID);
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
    assert.equal(readRoomDraft(store, CHAT_ID), null);
  });
});
