import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

const NAMES = { charName: "식스", userName: "제이" };

type Harness = {
  getDb: typeof import("@/lib/db").getDb;
  getOrCreateChatMemory: typeof import("./memory-db").getOrCreateChatMemory;
  applyRelationshipDeltaToChat: typeof import("./memory-relationship-meta").applyRelationshipDeltaToChat;
  loadChatRelationshipMeta: typeof import("./memory-relationship-meta").loadChatRelationshipMeta;
  formatMemoryMetaForPrompt: typeof import("@/lib/chatMemory").formatMemoryMetaForPrompt;
  trackTurnTailWork: typeof import("@/lib/turnTailWork").trackTurnTailWork;
  waitForTurnTailWork: typeof import("@/lib/turnTailWork").waitForTurnTailWork;
};

let h: Harness;

function seedChat(): number {
  const db = h.getDb();
  const userId = Number(
    db
      .prepare("INSERT INTO users (email, nickname, pw_hash, points) VALUES (?,?,?,0)")
      .run(`b61barrier_${Date.now()}_${Math.random()}@test.local`, "b61barrier", "x").lastInsertRowid
  );
  const characterId = Number(
    db.prepare("INSERT INTO characters (name) VALUES (?)").run("식스").lastInsertRowid
  );
  const chatId = Number(
    db
      .prepare("INSERT INTO chats (user_id, character_id, mode, memory_meta) VALUES (?,?,?,?)")
      .run(
        userId,
        characterId,
        "safe",
        JSON.stringify({ honorifics: [], items: [], thoughts: [], promises: [] })
      ).lastInsertRowid
  );
  h.getOrCreateChatMemory(chatId, userId, characterId, "free");
  return chatId;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("next-turn relationship memory barrier", () => {
  before(async () => {
    // Install the isolated DATA_DIR BEFORE importing any module that can open
    // the DB, so this fixture never touches the workspace app.db.
    installIsolatedTestDatabase();
    const [db, memoryDb, rel, chatMemory, tail] = await Promise.all([
      import("@/lib/db"),
      import("./memory-db"),
      import("./memory-relationship-meta"),
      import("@/lib/chatMemory"),
      import("@/lib/turnTailWork"),
    ]);
    h = {
      getDb: db.getDb,
      getOrCreateChatMemory: memoryDb.getOrCreateChatMemory,
      applyRelationshipDeltaToChat: rel.applyRelationshipDeltaToChat,
      loadChatRelationshipMeta: rel.loadChatRelationshipMeta,
      formatMemoryMetaForPrompt: chatMemory.formatMemoryMetaForPrompt,
      trackTurnTailWork: tail.trackTurnTailWork,
      waitForTurnTailWork: tail.waitForTurnTailWork,
    };
  });
  after(() => {
    try {
      uninstallIsolatedTestDatabase();
    } catch {
      // Windows can keep the SQLite handle briefly; the test body already passed.
    }
  });

  it("an immediate next turn would miss the promise without the barrier", async () => {
    const chatId = seedChat();
    const gate = deferred();
    const tail = (async () => {
      await gate.promise;
      h.applyRelationshipDeltaToChat({
        chatId,
        names: NAMES,
        delta: {
          items: [],
          itemsRemove: [],
          promisesAdd: [{ text: "식스가 제이에게 허가 없이 절단하지 않겠다고 약속했다." }],
          promisesRemove: [],
        },
      });
    })();
    h.trackTurnTailWork(tail, { chatId, memoryCritical: true });

    // Simulates the next request's prompt read before the tail settles.
    const before = h.formatMemoryMetaForPrompt(h.loadChatRelationshipMeta(chatId, NAMES));
    assert.equal(before, null);

    const wait = h.waitForTurnTailWork(chatId, { timeoutMs: 1_000 });
    gate.resolve();
    const result = await wait;
    assert.deepEqual(result, { waited: true, timedOut: false });

    const after = h.formatMemoryMetaForPrompt(h.loadChatRelationshipMeta(chatId, NAMES));
    assert.match(after ?? "", /약속: 식스가 제이에게 허가 없이 절단하지 않겠다고 약속했다\./);
  });

  it("writes the base delta before a slow scene call, then exposes the scene promise after the barrier", async () => {
    const chatId = seedChat();
    const gate = deferred();

    // Mirrors route.ts: the base write starts first, the scene call runs in
    // parallel, and the scene's additive promise is written after both.
    const baseWrite = (async () => {
      h.applyRelationshipDeltaToChat({
        chatId,
        names: NAMES,
        delta: {
          items: ["제이: 은빛 반지"],
          itemsRemove: [],
          promisesAdd: [],
          promisesRemove: [],
        },
      });
    })();
    const scene = (async () => {
      await gate.promise;
      return { text: "식스가 제이에게 허가 없이 절단하지 않겠다고 약속했다." };
    })();
    const tail = (async () => {
      await baseWrite;
      const found = await scene;
      h.applyRelationshipDeltaToChat({
        chatId,
        names: NAMES,
        delta: {
          items: [],
          itemsRemove: [],
          promisesAdd: [{ text: found.text }],
          promisesRemove: [],
        },
      });
    })();
    h.trackTurnTailWork(tail, { chatId, memoryCritical: true });

    await baseWrite;
    const duringScene = h.formatMemoryMetaForPrompt(h.loadChatRelationshipMeta(chatId, NAMES));
    assert.match(duringScene ?? "", /은빛 반지/);
    assert.doesNotMatch(duringScene ?? "", /허가 없이 절단/);

    const wait = h.waitForTurnTailWork(chatId, { timeoutMs: 1_000 });
    gate.resolve();
    await wait;
    const after = h.formatMemoryMetaForPrompt(h.loadChatRelationshipMeta(chatId, NAMES));
    assert.match(after ?? "", /은빛 반지/);
    assert.match(after ?? "", /약속: 식스가 제이에게 허가 없이 절단하지 않겠다고 약속했다\./);
  });

  it("a timed-out tail leaves the stored projection readable and does not hang", async () => {
    const chatId = seedChat();
    const gated = deferred();
    h.trackTurnTailWork(gated.promise, { chatId, memoryCritical: true });
    const result = await h.waitForTurnTailWork(chatId, { timeoutMs: 25 });
    assert.deepEqual(result, { waited: true, timedOut: true });
    assert.equal(h.formatMemoryMetaForPrompt(h.loadChatRelationshipMeta(chatId, NAMES)), null);
    gated.resolve();
  });
});
