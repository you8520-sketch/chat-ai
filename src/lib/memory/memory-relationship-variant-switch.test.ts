import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { ensureEpisodicMemoryFactsTable } from "@/lib/episodicMemoryFacts";
import { executeAtomicNonnumericVariantSwitch } from "@/lib/nonnumericVariantSwitchAtomic";
import {
  parseMessageVariants,
  serializeVariantsForClient,
  type MessageVariant,
} from "@/lib/messageAlternates";
import { ensureStatusWidgetTriggerTables } from "@/lib/statusWidgetTriggers";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      memory_meta TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE chat_memories (
      chat_id INTEGER PRIMARY KEY,
      memory_reset_after_message_id INTEGER,
      memory_epoch INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      usage TEXT,
      alternates TEXT,
      active_variant INTEGER DEFAULT 0,
      adult_route_meta_json TEXT DEFAULT '',
      status_widget_values_json TEXT DEFAULT '',
      status_widget_turn_active INTEGER DEFAULT 0,
      generation_status TEXT DEFAULT 'completed',
      request_id TEXT,
      user_message_id INTEGER
    );
  `);
  ensureStatusWidgetTriggerTables(db);
  ensureEpisodicMemoryFactsTable(db);
  return db;
}

function meta(items: string[]) {
  return {
    honorifics: [],
    items,
    thoughts: [],
    promises: [],
  };
}

describe("relationship memory parity on canonical variant switch", () => {
  it("D→A reprojects chats.memory_meta from active variant snapshot to selected variant snapshot", () => {
    const db = makeDb();
    const baseline = meta(["Tester: old-key"]);
    const dAfter = meta(["Tester: old-key, D-only-seal"]);

    db.prepare("INSERT INTO chats (id, memory_meta) VALUES (1, ?)").run(
      JSON.stringify(dAfter)
    );
    const userMessageId = Number(
      db.prepare(
        "INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (1, 'user', 'u', 'user', 'submitted')"
      ).run().lastInsertRowid
    );

    const variants = [
      {
        content: "A prose",
        model: "test",
        usage: null,
        created_at: "",
        generationSequence: 0,
        requestId: "req-a",
        relationshipMetaAfter: baseline,
      },
      {
        content: "D prose",
        model: "test",
        usage: null,
        created_at: "",
        generationSequence: 1,
        requestId: "req-d",
        relationshipMetaAfter: dAfter,
      },
    ];

    const assistantMessageId = Number(
      db.prepare(
        `INSERT INTO messages
          (chat_id, role, content, model, alternates, active_variant, generation_status, user_message_id)
         VALUES (1, 'assistant', 'D prose', 'test', ?, 1, 'completed', ?)`
      ).run(JSON.stringify(variants), userMessageId).lastInsertRowid
    );

    const result = executeAtomicNonnumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: assistantMessageId,
      variantIndex: 0,
    });
    assert.equal(result.kind, "APPLIED");

    const row = db
      .prepare("SELECT memory_meta FROM chats WHERE id=1")
      .get() as { memory_meta: string };
    assert.deepEqual(JSON.parse(row.memory_meta), baseline);
  });

  it("preserves explicit external relationship edits instead of overwriting them on switch", () => {
    const db = makeDb();
    const baseline = meta(["Tester: old-key"]);
    const dAfter = meta(["Tester: old-key, D-only-seal"]);
    const userEdited = meta([]);

    db.prepare("INSERT INTO chats (id, memory_meta) VALUES (1, ?)").run(
      JSON.stringify(userEdited)
    );
    const userMessageId = Number(
      db.prepare(
        "INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (1, 'user', 'u', 'user', 'submitted')"
      ).run().lastInsertRowid
    );
    const variants = [
      {
        content: "A prose",
        model: "test",
        usage: null,
        created_at: "",
        generationSequence: 0,
        requestId: "req-a",
        relationshipMetaAfter: baseline,
      },
      {
        content: "D prose",
        model: "test",
        usage: null,
        created_at: "",
        generationSequence: 1,
        requestId: "req-d",
        relationshipMetaAfter: dAfter,
      },
    ];
    const assistantMessageId = Number(
      db.prepare(
        `INSERT INTO messages
          (chat_id, role, content, model, alternates, active_variant, generation_status, user_message_id)
         VALUES (1, 'assistant', 'D prose', 'test', ?, 1, 'completed', ?)`
      ).run(JSON.stringify(variants), userMessageId).lastInsertRowid
    );

    executeAtomicNonnumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: assistantMessageId,
      variantIndex: 0,
    });

    const row = db
      .prepare("SELECT memory_meta FROM chats WHERE id=1")
      .get() as { memory_meta: string };
    assert.deepEqual(JSON.parse(row.memory_meta), userEdited);
  });

  it("relationship reprojection failure rolls back message selection and memory_meta together", () => {
    const db = makeDb();
    const baseline = meta(["Tester: old-key"]);
    const dAfter = meta(["Tester: old-key, D-only-seal"]);

    db.prepare("INSERT INTO chats (id, memory_meta) VALUES (1, ?)").run(
      JSON.stringify(dAfter)
    );
    const userMessageId = Number(
      db.prepare(
        "INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (1, 'user', 'u', 'user', 'submitted')"
      ).run().lastInsertRowid
    );
    const variants = [
      {
        content: "A prose",
        model: "test",
        usage: null,
        created_at: "",
        generationSequence: 0,
        requestId: "req-a",
        relationshipMetaAfter: baseline,
      },
      {
        content: "D prose",
        model: "test",
        usage: null,
        created_at: "",
        generationSequence: 1,
        requestId: "req-d",
        relationshipMetaAfter: dAfter,
      },
    ];
    const assistantMessageId = Number(
      db.prepare(
        `INSERT INTO messages
          (chat_id, role, content, model, alternates, active_variant, generation_status, user_message_id)
         VALUES (1, 'assistant', 'D prose', 'test', ?, 1, 'completed', ?)`
      ).run(JSON.stringify(variants), userMessageId).lastInsertRowid
    );

    assert.throws(
      () =>
        executeAtomicNonnumericVariantSwitch(db, {
          chatId: 1,
          characterId: 7,
          userId: 1,
          messageId: assistantMessageId,
          variantIndex: 0,
          __testThrowAfterRelationshipReprojection: true,
        }),
      /TEST_THROW_AFTER_RELATIONSHIP_REPROJECTION/
    );

    const message = db
      .prepare("SELECT content, active_variant FROM messages WHERE id=?")
      .get(assistantMessageId) as { content: string; active_variant: number };
    assert.equal(message.content, "D prose");
    assert.equal(message.active_variant, 1);

    const row = db
      .prepare("SELECT memory_meta FROM chats WHERE id=1")
      .get() as { memory_meta: string };
    assert.deepEqual(JSON.parse(row.memory_meta), dAfter);
  });

  it("never serializes relationshipMetaAfter to client variants", () => {
    const internal = [
      {
        content: "A",
        model: "test",
        usage: null,
        created_at: "",
        generationSequence: 0,
        requestId: "req-a",
        relationshipMetaAfter: meta(["Tester: secret-internal-memory"]),
      },
    ] satisfies MessageVariant[];

    const serialized = serializeVariantsForClient(internal, 0);
    assert.equal(
      Object.prototype.hasOwnProperty.call(serialized.variants[0], "relationshipMetaAfter"),
      false
    );

    const roundTrip = parseMessageVariants(JSON.stringify(internal));
    assert.deepEqual(roundTrip[0]?.relationshipMetaAfter, internal[0]!.relationshipMetaAfter);
  });
});
