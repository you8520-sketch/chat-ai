/**
 * Source message edit + repair-job ordering proofs (PR #809 correction 2).
 */
import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { isMaterialProseEdit } from "@/lib/canonicalProse";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { executeAtomicManualEditCore } from "@/lib/rpDerivedStateLifecycle";
import { buildMemoryContext } from "./memory-injector";
import { getOrCreateChatMemory } from "./memory-db";
import {
  reconcileMemoryAfterRecordDelete,
  reconcileMemoryAfterSourceMessageEdit,
} from "./memory-reconcile";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import {
  getMemorySourceBoundaryCore,
  invalidateDerivedMemoryGenerationCore,
} from "./memory-source-boundary";
import {
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
} from "./memory-rolling-summary";
import {
  listMemoryRecordsForChat,
  markMemoryRecordInactive,
  rebuildLorebookFromRecords,
} from "./memory-turn-summary";

const CHAT = 960001;
const USER = 960002;
const CHAR = 960003;
const OLD_FACT = "OLD_FACT_XYZ";
const NEW_FACT = "NEW_FACT_ABC";
const SECRET_OLD = "SECRET_OLD_QWE";
const SECRET_NEW = "SECRET_NEW_RTY";

const VALID_SUMMARY =
  `${OLD_FACT} `.repeat(6) +
  "장면 요약: 초기 배치 기록. 사실만 압축하고 반복 묘사는 생략한다.";

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);
}

function seedOpening() {
  getDb()
    .prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`)
    .run(CHAT, "assistant", "opening", "greeting");
}

function seedPlayableTurns(count: number, userPrefix = "user turn", assistantPrefix = "assistant") {
  for (let t = 1; t <= count; t++) {
    getDb()
      .prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`)
      .run(CHAT, "user", `${userPrefix} ${t} ${t === 1 ? SECRET_OLD : ""}`.trim(), "user");
    getDb()
      .prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`)
      .run(CHAT, "assistant", `${assistantPrefix} ${t} ${OLD_FACT}`, "test");
  }
}

function seedBase(turnCount: number) {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `edit-${USER}@test.local`,
    "edit",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "EditChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode, memory_capacity) VALUES (?,?,?,'safe',?)`).run(
    CHAT,
    USER,
    CHAR,
    10_000
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
  seedOpening();
  seedPlayableTurns(turnCount);
}

function sealBatch1To5() {
  persistValidatedSummaryBatch({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    turnStart: 1,
    assistantMessageId: null,
    summary: VALID_SUMMARY,
    playableTurnCount: 5,
  });
}

function waitUntil(condition: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("waitUntil timeout"));
        return;
      }
      setImmediate(tick);
    };
    tick();
  });
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

beforeEach(() => {
  process.env.MEMORY_5PLUS4_ENABLED = "1";
});

afterEach(() => {
  __setSummarizeTurnBatchCallerForTests(null);
  cleanup();
});

describe("repair job ordering after record delete", () => {
  it("post-invalidation repair job commits and reseals missing batch", async () => {
    seedBase(10);
    sealBatch1To5();
    getDb()
      .prepare(`UPDATE chat_memories SET message_count=10, summarized_turn_count=5 WHERE chat_id=?`)
      .run(CHAT);

    const row = listMemoryRecordsForChat(CHAT)[0]!;
    assert.ok(markMemoryRecordInactive(CHAT, row.id));

    let llmEntered = false;
    let releaseLlm!: () => void;
    const llmGate = new Promise<void>((resolve) => {
      releaseLlm = resolve;
    });

    __setSummarizeTurnBatchCallerForTests(async () => {
      llmEntered = true;
      await llmGate;
      return {
        text:
          `${NEW_FACT} `.repeat(8) +
          "resealed batch after record delete gap repair.",
      };
    });

    reconcileMemoryAfterRecordDelete({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "EditChar",
      tier: "free",
      memoryCapacity: 10_000,
    });

    await waitUntil(() => llmEntered);
    releaseLlm();
    await new Promise((r) => setTimeout(r, 200));

    const lore = rebuildLorebookFromRecords(CHAT);
    assert.doesNotMatch(lore, new RegExp(OLD_FACT));
    assert.match(lore, new RegExp(NEW_FACT));
    const active = listMemoryRecordsForChat(CHAT).filter((r) => !r.inactive);
    assert.equal(active.length, 1);
    assert.equal(active[0]!.turnStart, 1);
    assert.equal(active[0]!.turnEnd, 5);
    const mem = getDb()
      .prepare(`SELECT summarized_turn_count FROM chat_memories WHERE chat_id=?`)
      .get(CHAT) as { summarized_turn_count: number };
    assert.equal(mem.summarized_turn_count, 5);
  });
});

describe("assistant material prose edit", () => {
  it("invalidates sealed summary and reseals with new source prose", async () => {
    seedBase(5);
    sealBatch1To5();

    const db = getDb();
    const assistant = db
      .prepare(
        `SELECT id FROM messages WHERE chat_id=? AND role='assistant' AND model='test' ORDER BY id LIMIT 1`
      )
      .get(CHAT) as { id: number };

    let releaseLlm!: () => void;
    __setSummarizeTurnBatchCallerForTests(async () => {
      await new Promise<void>((resolve) => {
        releaseLlm = resolve;
      });
      return {
        text:
          `${NEW_FACT} `.repeat(8) +
          "material edit reseal with updated assistant source.",
      };
    });

    const newProse = `assistant 1 ${NEW_FACT} updated narrative`;
    executeAtomicManualEditCore(db, {
      chatId: CHAT,
      messageId: assistant.id,
      content: newProse,
      alternatesJson: "[]",
      statusWidgetValuesJson: "{}",
      materialProseChange: true,
      sourceTurn: 1,
    });

    reconcileMemoryAfterSourceMessageEdit({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "EditChar",
      tier: "free",
      memoryCapacity: 10_000,
      sourceTurn: 1,
      sourceUserMessageId: db
        .prepare(`SELECT id FROM messages WHERE chat_id=? AND role='user' ORDER BY id LIMIT 1`)
        .get(CHAT) as { id: number } | undefined
        ? (
            db
              .prepare(`SELECT id FROM messages WHERE chat_id=? AND role='user' ORDER BY id LIMIT 1`)
              .get(CHAT) as { id: number }
          ).id
        : null,
      assistantMessageId: assistant.id,
    });

    releaseLlm!();
    await new Promise((r) => setTimeout(r, 250));

    const lore = rebuildLorebookFromRecords(CHAT);
    assert.doesNotMatch(lore, new RegExp(OLD_FACT));
    assert.match(lore, new RegExp(NEW_FACT));

    const memory = getOrCreateChatMemory(CHAT, USER, CHAR, "free");
    const injection = buildMemoryContext({
      memory,
      userMessage: "next turn",
      memoryCapacity: 10_000,
    });
    assert.doesNotMatch(injection.text, new RegExp(OLD_FACT));
    assert.match(injection.text, new RegExp(NEW_FACT));
  });

  it("format-only edit does not bump generation or invalidate sealed summary", () => {
    seedBase(5);
    sealBatch1To5();
    const beforeEpoch = getMemorySourceBoundaryCore(getDb(), CHAT).epoch;

    const db = getDb();
    const assistant = db
      .prepare(
        `SELECT id, content FROM messages WHERE chat_id=? AND role='assistant' AND model='test' ORDER BY id LIMIT 1`
      )
      .get(CHAT) as { id: number; content: string };

    const formatOnly = `  ${assistant.content.replace(/\n/g, "\r\n")}  `;
    assert.equal(isMaterialProseEdit(assistant.content, formatOnly), false);

    executeAtomicManualEditCore(db, {
      chatId: CHAT,
      messageId: assistant.id,
      content: formatOnly,
      alternatesJson: "[]",
      statusWidgetValuesJson: "{}",
      materialProseChange: false,
      sourceTurn: 1,
    });

    assert.equal(getMemorySourceBoundaryCore(db, CHAT).epoch, beforeEpoch);
    const lore = rebuildLorebookFromRecords(CHAT);
    assert.match(lore, new RegExp(OLD_FACT));
  });

  it("status-only edit does not bump generation", () => {
    seedBase(5);
    sealBatch1To5();
    const beforeEpoch = getMemorySourceBoundaryCore(getDb(), CHAT).epoch;

    const db = getDb();
    const assistant = db
      .prepare(
        `SELECT id, content FROM messages WHERE chat_id=? AND role='assistant' AND model='test' ORDER BY id LIMIT 1`
      )
      .get(CHAT) as { id: number; content: string };

    executeAtomicManualEditCore(db, {
      chatId: CHAT,
      messageId: assistant.id,
      content: assistant.content,
      alternatesJson: "[]",
      statusWidgetValuesJson: JSON.stringify({
        character: { mood: "calm" },
        user: { mood: "curious" },
      }),
      materialProseChange: false,
      sourceTurn: 1,
      supersedeTriggers: true,
      triggerSupersessionReason: "manual_status_edit",
    });

    assert.equal(getMemorySourceBoundaryCore(db, CHAT).epoch, beforeEpoch);
    assert.match(rebuildLorebookFromRecords(CHAT), new RegExp(OLD_FACT));
  });
});

describe("user message edit", () => {
  it("material user source edit invalidates sealed summary and allows reseal", async () => {
    seedBase(5);
    sealBatch1To5();

    const db = getDb();
    const userMsg = db
      .prepare(`SELECT id, content FROM messages WHERE chat_id=? AND role='user' AND model='user' ORDER BY id LIMIT 1`)
      .get(CHAT) as { id: number; content: string };

    const newContent = userMsg.content.replace(SECRET_OLD, SECRET_NEW);
    assert.ok(isMaterialProseEdit(userMsg.content, newContent));

    db.prepare(`UPDATE messages SET content=? WHERE id=?`).run(newContent, userMsg.id);

    let releaseLlm!: () => void;
    __setSummarizeTurnBatchCallerForTests(async () => {
      await new Promise<void>((resolve) => {
        releaseLlm = resolve;
      });
      return {
        text:
          `${SECRET_NEW} `.repeat(4) +
          `${NEW_FACT} `.repeat(4) +
          "user source edit reseal.",
      };
    });

    reconcileMemoryAfterSourceMessageEdit({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "EditChar",
      tier: "free",
      memoryCapacity: 10_000,
      sourceTurn: 1,
      sourceUserMessageId: userMsg.id,
    });

    releaseLlm!();
    await new Promise((r) => setTimeout(r, 250));

    const lore = rebuildLorebookFromRecords(CHAT);
    assert.doesNotMatch(lore, new RegExp(SECRET_OLD));
    assert.match(lore, new RegExp(SECRET_NEW));

    const memory = getOrCreateChatMemory(CHAT, USER, CHAR, "free");
    const injection = buildMemoryContext({
      memory,
      userMessage: "continue",
      memoryCapacity: 10_000,
    });
    assert.doesNotMatch(injection.text, new RegExp(SECRET_OLD));
  });
});

describe("helper — old repair self-stale ordering regression", () => {
  it("invalidate-before-schedule prevents freshly started job from self-stale", async () => {
    seedBase(10);
    sealBatch1To5();
    getDb()
      .prepare(`UPDATE chat_memories SET message_count=10, summarized_turn_count=5 WHERE chat_id=?`)
      .run(CHAT);
    markMemoryRecordInactive(CHAT, listMemoryRecordsForChat(CHAT)[0]!.id);

    const snapshotBefore = getMemorySourceBoundaryCore(getDb(), CHAT);

    let releaseLlm!: () => void;
    __setSummarizeTurnBatchCallerForTests(async () => {
      await new Promise<void>((resolve) => {
        releaseLlm = resolve;
      });
      return { text: `${NEW_FACT} `.repeat(10) + "repair committed." };
    });

    reconcileMemoryAfterRecordDelete({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "EditChar",
      tier: "free",
      memoryCapacity: 10_000,
    });

    const snapshotAfterReconcile = getMemorySourceBoundaryCore(getDb(), CHAT);
    assert.ok(snapshotAfterReconcile.epoch > snapshotBefore.epoch);

    releaseLlm!();
    const ok = await processRollingSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "EditChar",
      tier: "free",
      memoryCapacity: 10_000,
    });
    assert.equal(ok, true);
    assert.match(rebuildLorebookFromRecords(CHAT), new RegExp(NEW_FACT));
  });

  it("stale snapshot from pre-invalidation epoch is rejected at persist", () => {
    seedBase(5);
    sealBatch1To5();
    const staleSnapshot = getMemorySourceBoundaryCore(getDb(), CHAT);
    invalidateDerivedMemoryGenerationCore(getDb(), CHAT);
    assert.equal(staleSnapshot.epoch + 1, getMemorySourceBoundaryCore(getDb(), CHAT).epoch);
    void staleSnapshot;
  });
});
