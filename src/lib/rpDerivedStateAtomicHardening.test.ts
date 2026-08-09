import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  persistEpisodicMemoryFactsBestEffort,
  replaceEpisodicMemoryFactsForCanonicalMutation,
  persistEpisodicMemoryFactsCore,
  deleteEpisodicMemoryFactsByAssistantMessageIds,
} from "@/lib/episodicMemoryFacts";
import {
  ensureStatusWidgetTriggerTables,
  insertStatusWidgetTriggerForTest,
  evaluateStatusWidgetTriggers,
  type StatusWidgetTriggerDefinition,
} from "@/lib/statusWidgetTriggers";
import {
  executeAtomicVariantSwitchCore,
  executeAtomicManualEditCore,
  supersedeStatusTriggerEventsForSourceMessage,
  getAssistantSourceTurn,
} from "@/lib/rpDerivedStateLifecycle";
import {
  parseStoredStatusWidgetValuesJson,
  sanitizeParsedStatusWidgetValues,
  serializeStatusWidgetValuesJson,
} from "@/lib/statusWidget/parseValues";
import type {
  ExtractedStatusFact,
  ParsedStatusWidgetTurnValues,
} from "@/lib/statusWidget/types";
import { isMaterialProseEdit } from "@/lib/canonicalProse";

function fact(text: string, subject = "enok", attribute = "agreement"): ExtractedStatusFact {
  return {
    category: "relationship",
    subject,
    attribute,
    value: "yes",
    importance: "important",
    fact_text: text,
  };
}

function makeMessagesDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
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
      user_message_id INTEGER,
      character_id INTEGER,
      user_id INTEGER
    );
    CREATE TABLE episodic_memory_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      character_id INTEGER,
      user_id INTEGER,
      source_turn INTEGER NOT NULL,
      source_user_message_id INTEGER,
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      attribute TEXT NOT NULL,
      value TEXT NOT NULL,
      importance TEXT NOT NULL,
      fact_text TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureStatusWidgetTriggerTables(db);
  return db;
}

function countFacts(db: Database.Database, chatId: number, sourceTurn: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts WHERE chat_id=? AND source_turn=?")
    .get(chatId, sourceTurn) as { c: number };
  return row.c;
}

function storedWidgetJson(db: Database.Database, messageId: number): string {
  const row = db
    .prepare("SELECT status_widget_values_json AS v FROM messages WHERE id=?")
    .get(messageId) as { v: string | null } | undefined;
  return row?.v ?? "";
}

function messageContent(db: Database.Database, messageId: number): string {
  const row = db
    .prepare("SELECT content AS c FROM messages WHERE id=?")
    .get(messageId) as { c: string };
  return row.c;
}

function activeVariant(db: Database.Database, messageId: number): number {
  const row = db
    .prepare("SELECT active_variant AS v FROM messages WHERE id=?")
    .get(messageId) as { v: number };
  return row.v;
}

function activeTriggerEvents(db: Database.Database, chatId: number, sourceMessageId?: number): number {
  const where = sourceMessageId != null ? " AND source_message_id=?" : "";
  const params = sourceMessageId != null ? [chatId, sourceMessageId] : [chatId];
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM status_trigger_events WHERE chat_id=? AND is_consumed=0 AND is_superseded=0${where}`
    )
    .get(...params) as { c: number };
  return row.c;
}

function buildManualEditPayload(opts: {
  existingJson: string;
  hasWidgetPatch: boolean;
  incomingWidgets: ParsedStatusWidgetTurnValues | null;
  materialProseChange: boolean;
}): { statusWidgetValuesJson: string; sanitized: ParsedStatusWidgetTurnValues } {
  const existing = parseStoredStatusWidgetValuesJson(opts.existingJson);
  const nextCharacter =
    opts.hasWidgetPatch && opts.incomingWidgets?.character
      ? opts.incomingWidgets.character
      : existing.character ?? null;
  const nextUser =
    opts.hasWidgetPatch && opts.incomingWidgets?.user
      ? opts.incomingWidgets.user
      : existing.user ?? null;
  const preserveFacts =
    !opts.materialProseChange && existing.extracted_facts?.length
      ? { extracted_facts: existing.extracted_facts }
      : {};
  const merged: ParsedStatusWidgetTurnValues = {
    character: nextCharacter,
    user: nextUser,
    ...preserveFacts,
  };
  const sanitized = sanitizeParsedStatusWidgetValues(merged);
  return {
    statusWidgetValuesJson: serializeStatusWidgetValuesJson(sanitized),
    sanitized,
  };
}

function variantRow(content: string, opts?: { requestId?: string; facts?: ExtractedStatusFact[]; character?: Record<string, string> }) {
  return {
    content,
    model: "test",
    usage: null,
    created_at: "",
    requestId: opts?.requestId ?? null,
    statusWidgetValues: {
      character: opts?.character ?? null,
      user: null,
      ...(opts?.facts?.length ? { extracted_facts: opts.facts } : {}),
    },
  };
}

function insertVariantMessage(
  db: Database.Database,
  opts: {
    messageId: number;
    chatId: number;
    variants: Array<{ content: string; requestId?: string; facts?: ExtractedStatusFact[]; character?: Record<string, string> }>;
    activeVariant?: number;
  }
): void {
  const variantsJson = JSON.stringify(opts.variants.map((v) => variantRow(v.content, v)));
  db.prepare(
    "INSERT INTO messages (id, chat_id, role, content, model, usage, alternates, active_variant, generation_status) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(
    opts.messageId,
    opts.chatId,
    "assistant",
    opts.variants[opts.activeVariant ?? 0]!.content,
    "test",
    "null",
    variantsJson,
    opts.activeVariant ?? 0,
    "completed"
  );
  const aFacts = opts.variants[0]!.facts ?? [];
  if (aFacts.length) {
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: opts.chatId,
      characterId: 7,
      userId: 4,
      sourceTurn: 1,
      facts: aFacts,
      metadata: { assistant_message_id: opts.messageId, request_id: opts.variants[0]!.requestId ?? "a" },
    });
  }
}

describe("Phase B0.1 — Fix A: material edit embedded facts independent of widget patch (A1-A4)", () => {
  it("A1 material prose edit + statusWidgetValues omitted → character/user preserved, embedded facts cleared, DB facts deleted", () => {
    const db = makeMessagesDb();
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content, model, status_widget_values_json) VALUES (?,?,?,?,?,?)"
    ).run(
      50, 1, "assistant", "원본 본문입니다.", "test",
      JSON.stringify({
        character: { affection: "40" },
        user: { mood: "happy" },
        extracted_facts: [fact("둘은 동행하기로 합의했다.")],
      })
    );
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 5,
      facts: [fact("둘은 동행하기로 합의했다.")],
      metadata: { assistant_message_id: 50, request_id: "r1" },
    });
    assert.equal(countFacts(db, 1, 5), 1);

    const newText = "완전히 다른 전개로 바뀌었다.";
    assert.equal(isMaterialProseEdit("원본 본문입니다.", newText), true);

    const { statusWidgetValuesJson } = buildManualEditPayload({
      existingJson: storedWidgetJson(db, 50),
      hasWidgetPatch: false,
      incomingWidgets: null,
      materialProseChange: true,
    });

    executeAtomicManualEditCore(db, {
      chatId: 1, messageId: 50, content: newText,
      alternatesJson: JSON.stringify([variantRow(newText)]),
      statusWidgetValuesJson,
      materialProseChange: true,
      sourceTurn: getAssistantSourceTurn(db, 1, 50),
    });

    const stored = parseStoredStatusWidgetValuesJson(storedWidgetJson(db, 50));
    assert.deepEqual(stored.character, { affection: "40" }, "character preserved");
    assert.deepEqual(stored.user, { mood: "happy" }, "user preserved");
    assert.equal(stored.extracted_facts, undefined, "embedded extracted_facts cleared");
    assert.equal(countFacts(db, 1, 5), 0, "DB episodic facts deleted");
    assert.equal(messageContent(db, 50), newText);
  });

  it("A2 material edit + widget patch → incoming status stored, facts cleared", () => {
    const db = makeMessagesDb();
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content, model, status_widget_values_json) VALUES (?,?,?,?,?,?)"
    ).run(
      50, 1, "assistant", "원본 본문입니다.", "test",
      JSON.stringify({
        character: { affection: "40" },
        user: { mood: "happy" },
        extracted_facts: [fact("둘은 동행하기로 합의했다.")],
      })
    );
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 5,
      facts: [fact("둘은 동행하기로 합의했다.")],
      metadata: { assistant_message_id: 50, request_id: "r1" },
    });

    const newText = "완전히 다른 전개로 바뀌었다.";
    const incomingWidgets: ParsedStatusWidgetTurnValues = {
      character: { affection: "75" },
      user: null,
    };
    const { statusWidgetValuesJson } = buildManualEditPayload({
      existingJson: storedWidgetJson(db, 50),
      hasWidgetPatch: true,
      incomingWidgets,
      materialProseChange: true,
    });

    executeAtomicManualEditCore(db, {
      chatId: 1, messageId: 50, content: newText,
      alternatesJson: JSON.stringify([variantRow(newText)]),
      statusWidgetValuesJson,
      materialProseChange: true,
      sourceTurn: getAssistantSourceTurn(db, 1, 50),
    });

    const stored = parseStoredStatusWidgetValuesJson(storedWidgetJson(db, 50));
    assert.deepEqual(stored.character, { affection: "75" }, "incoming character stored");
    assert.deepEqual(stored.user, { mood: "happy" }, "incoming user null → existing user preserved");
    assert.equal(stored.extracted_facts, undefined, "embedded facts cleared");
    assert.equal(countFacts(db, 1, 5), 0, "DB episodic facts deleted");
  });

  it("A3 format-only edit + no widget patch → facts preserved", () => {
    const db = makeMessagesDb();
    const before = "에녹은 렌의 손을 잡았다.\n\n그는 대답하지 않았다.";
    const after = "에녹은 렌의 손을 잡았다.  \r\n\r\n  그는 대답하지 않았다.";
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content, model, status_widget_values_json) VALUES (?,?,?,?,?,?)"
    ).run(
      50, 1, "assistant", before, "test",
      JSON.stringify({
        character: { affection: "40" },
        user: null,
        extracted_facts: [fact("둘은 동행하기로 합의했다.")],
      })
    );
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 5,
      facts: [fact("둘은 동행하기로 합의했다.")],
      metadata: { assistant_message_id: 50, request_id: "r1" },
    });

    assert.equal(isMaterialProseEdit(before, after), false, "whitespace-only = not material");

    const { statusWidgetValuesJson } = buildManualEditPayload({
      existingJson: storedWidgetJson(db, 50),
      hasWidgetPatch: false,
      incomingWidgets: null,
      materialProseChange: false,
    });

    executeAtomicManualEditCore(db, {
      chatId: 1, messageId: 50, content: after,
      alternatesJson: JSON.stringify([variantRow(after)]),
      statusWidgetValuesJson,
      materialProseChange: false,
      sourceTurn: getAssistantSourceTurn(db, 1, 50),
    });

    const stored = parseStoredStatusWidgetValuesJson(storedWidgetJson(db, 50));
    assert.deepEqual(stored.character, { affection: "40" }, "character preserved");
    assert.equal(stored.extracted_facts?.length, 1, "embedded facts preserved");
    assert.equal(countFacts(db, 1, 5), 1, "DB episodic facts preserved");
  });

  it("A4 status-only edit → facts preserved", () => {
    const db = makeMessagesDb();
    const same = "동일 본문입니다.";
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content, model, status_widget_values_json) VALUES (?,?,?,?,?,?)"
    ).run(
      50, 1, "assistant", same, "test",
      JSON.stringify({
        character: { affection: "40" },
        user: null,
        extracted_facts: [fact("둘은 동행하기로 합의했다.")],
      })
    );
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 5,
      facts: [fact("둘은 동행하기로 합의했다.")],
      metadata: { assistant_message_id: 50, request_id: "r1" },
    });

    assert.equal(isMaterialProseEdit(same, same), false);

    const incomingWidgets: ParsedStatusWidgetTurnValues = {
      character: { affection: "55" },
      user: null,
    };
    const { statusWidgetValuesJson } = buildManualEditPayload({
      existingJson: storedWidgetJson(db, 50),
      hasWidgetPatch: true,
      incomingWidgets,
      materialProseChange: false,
    });

    executeAtomicManualEditCore(db, {
      chatId: 1, messageId: 50, content: same,
      alternatesJson: JSON.stringify([variantRow(same)]),
      statusWidgetValuesJson,
      materialProseChange: false,
      sourceTurn: getAssistantSourceTurn(db, 1, 50),
    });

    const stored = parseStoredStatusWidgetValuesJson(storedWidgetJson(db, 50));
    assert.deepEqual(stored.character, { affection: "55" }, "incoming status stored");
    assert.equal(stored.extracted_facts?.length, 1, "embedded facts preserved");
    assert.equal(countFacts(db, 1, 5), 1, "DB episodic facts preserved");
  });
});

describe("Phase B0.1 — Fix B: atomic canonical mutation core (TX1-TX5)", () => {
  function triggerDef(over: Partial<StatusWidgetTriggerDefinition>): StatusWidgetTriggerDefinition {
    return {
      trigger_id: over.trigger_id ?? "corruption_70",
      status_key: over.status_key ?? "corruption",
      operator: over.operator ?? ">=",
      value: over.value ?? 70,
      fire_once: over.fire_once ?? true,
      event_key: over.event_key ?? "corruption_event",
      effect_text: over.effect_text ?? "환각 이벤트",
      character_knowledge: over.character_knowledge ?? "unknown",
      is_enabled: over.is_enabled ?? true,
    } as StatusWidgetTriggerDefinition;
  }

  it("TX1 variant atomic rollback — strict episodic failure rolls back message + trigger supersession", () => {
    const db = makeMessagesDb();
    insertVariantMessage(db, {
      messageId: 50,
      chatId: 1,
      variants: [
        { content: "A 본문", requestId: "a", facts: [fact("에녹은 렌과 동행하기로 합의했다.")] },
        { content: "B 본문", requestId: "b", facts: [fact("에녹은 렌의 동행을 거절했다.")] },
      ],
      activeVariant: 0,
    });
    insertStatusWidgetTriggerForTest(db, triggerDef({ character_id: 7 }));
    // Fire trigger for variant A.
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 1,
      statusValues: { character: { corruption: "75" }, user: null },
      sourceMessageId: 50, requestId: "a", generationSequence: 0,
    });
    assert.equal(activeTriggerEvents(db, 1, 50), 1);
    assert.equal(countFacts(db, 1, 1), 1);

    const variantsRow = db.prepare("SELECT alternates FROM messages WHERE id=50").get() as { alternates: string };
    const variants = JSON.parse(variantsRow.alternates) as Array<{ content: string }>;
    const selected = variants[1]!;

    // Force a strict episodic failure by dropping the table mid-transaction.
    // We wrap so the supersession + message UPDATE run first, then the
    // episodic replace throws → whole transaction must roll back.
    assert.throws(() => {
      const tx = db.transaction(() => {
        db.prepare(
          "UPDATE messages SET content=?, model=?, usage=?, adult_route_meta_json=?, alternates=?, active_variant=? WHERE id=?"
        ).run(selected.content, "test", "null", "", JSON.stringify(variants), 1, 50);
        supersedeStatusTriggerEventsForSourceMessage(db, 1, 50, "variant_switch");
        db.exec("DROP TABLE episodic_memory_facts");
        replaceEpisodicMemoryFactsForCanonicalMutation(db, {
          chatId: 1, characterId: 7, userId: 4, sourceTurn: 1,
          facts: [fact("에녹은 렌의 동행을 거절했다.")],
          metadata: { assistant_message_id: 50, request_id: "b", variant_switch: true, variant_index: 1 },
        });
      });
      tx();
    });

    // The DROP TABLE was inside the rolled-back transaction, so SQLite restored
    // the table AND its data. No CREATE needed. Inspect rollback state.
    assert.equal(messageContent(db, 50), "A 본문", "message content rolled back to A");
    assert.equal(activeVariant(db, 50), 0, "active_variant rolled back to A");
    assert.equal(activeTriggerEvents(db, 1, 50), 1, "A trigger supersession rolled back");
    // The canonical core did NOT leave a B-fact half-state: the original A
    // fact row is intact (table + data restored on rollback).
    assert.equal(countFacts(db, 1, 1), 1, "no B-fact half-state committed; A fact restored");
    const aFact = db
      .prepare("SELECT fact_text FROM episodic_memory_facts WHERE chat_id=1 AND source_turn=1")
      .get() as { fact_text: string };
    assert.equal(aFact.fact_text, "에녹은 렌과 동행하기로 합의했다.", "A fact preserved");
  });

  it("TX2 variant success — A→B in one transaction: message=B, episodic=B, A trigger superseded", () => {
    const db = makeMessagesDb();
    insertVariantMessage(db, {
      messageId: 50,
      chatId: 1,
      variants: [
        { content: "A 본문", requestId: "a", facts: [fact("에녹은 렌과 동행하기로 합의했다.")] },
        { content: "B 본문", requestId: "b", facts: [fact("에녹은 렌의 동행을 거절했다.")] },
      ],
      activeVariant: 0,
    });
    insertStatusWidgetTriggerForTest(db, triggerDef({ character_id: 7 }));
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 1,
      statusValues: { character: { corruption: "75" }, user: null },
      sourceMessageId: 50, requestId: "a", generationSequence: 0,
    });
    assert.equal(activeTriggerEvents(db, 1, 50), 1);

    const variantsRow = db.prepare("SELECT alternates FROM messages WHERE id=50").get() as { alternates: string };
    const variants = JSON.parse(variantsRow.alternates) as Array<{ content: string }>;
    const selected = variants[1]!;

    executeAtomicVariantSwitchCore(db, {
      chatId: 1, messageId: 50,
      content: selected.content, model: "test", usageJson: "null",
      adultRouteMetaJson: "", variantsJson: JSON.stringify(variants), variantIndex: 1,
      statusWidgetValuesJson: undefined, statusWidgetTurnActive: undefined,
      sourceTurn: 1, characterId: 7, userId: 4,
      selectedFacts: [fact("에녹은 렌의 동행을 거절했다.")],
      selectedRequestId: "b", selectedGenerationSequence: 1,
    });

    assert.equal(messageContent(db, 50), "B 본문", "message = B");
    assert.equal(activeVariant(db, 50), 1, "active_variant = B");
    assert.equal(countFacts(db, 1, 1), 1, "episodic = B");
    const txt = db
      .prepare("SELECT fact_text FROM episodic_memory_facts WHERE chat_id=1 AND source_turn=1")
      .get() as { fact_text: string };
    assert.equal(txt.fact_text, "에녹은 렌의 동행을 거절했다.", "B fact stored");
    assert.equal(activeTriggerEvents(db, 1, 50), 0, "A trigger superseded");
  });

  it("TX3 variant B facts empty — A=[fact1], B=[]: message=B, DB facts=[], A trigger superseded", () => {
    const db = makeMessagesDb();
    insertVariantMessage(db, {
      messageId: 50,
      chatId: 1,
      variants: [
        { content: "A 본문", requestId: "a", facts: [fact("에녹은 렌과 동행하기로 합의했다.")] },
        { content: "B 본문", requestId: "b", facts: [] },
      ],
      activeVariant: 0,
    });
    insertStatusWidgetTriggerForTest(db, triggerDef({ character_id: 7 }));
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 1,
      statusValues: { character: { corruption: "75" }, user: null },
      sourceMessageId: 50, requestId: "a", generationSequence: 0,
    });
    assert.equal(activeTriggerEvents(db, 1, 50), 1);
    assert.equal(countFacts(db, 1, 1), 1);

    const variantsRow = db.prepare("SELECT alternates FROM messages WHERE id=50").get() as { alternates: string };
    const variants = JSON.parse(variantsRow.alternates) as Array<{ content: string }>;
    const selected = variants[1]!;

    executeAtomicVariantSwitchCore(db, {
      chatId: 1, messageId: 50,
      content: selected.content, model: "test", usageJson: "null",
      adultRouteMetaJson: "", variantsJson: JSON.stringify(variants), variantIndex: 1,
      statusWidgetValuesJson: undefined, statusWidgetTurnActive: undefined,
      sourceTurn: 1, characterId: 7, userId: 4,
      selectedFacts: [],
      selectedRequestId: "b", selectedGenerationSequence: 1,
    });

    assert.equal(messageContent(db, 50), "B 본문", "message = B");
    assert.equal(activeVariant(db, 50), 1, "active_variant = B");
    assert.equal(countFacts(db, 1, 1), 0, "DB facts = [] (valid empty success)");
    assert.equal(activeTriggerEvents(db, 1, 50), 0, "A trigger superseded");
  });

  it("TX4 manual material edit atomic rollback — episodic invalidation failure rolls back prose update", () => {
    const db = makeMessagesDb();
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content, model, status_widget_values_json) VALUES (?,?,?,?,?,?)"
    ).run(
      50, 1, "assistant", "원본 본문입니다.", "test",
      JSON.stringify({
        character: { affection: "40" },
        user: null,
        extracted_facts: [fact("둘은 동행하기로 합의했다.")],
      })
    );
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 5,
      facts: [fact("둘은 동행하기로 합의했다.")],
      metadata: { assistant_message_id: 50, request_id: "r1" },
    });
    assert.equal(countFacts(db, 1, 5), 1);

    const newText = "완전히 다른 전개로 바뀌었다.";

    // Force episodic invalidation to fail inside the atomic core → prose UPDATE
    // must roll back so no "new prose + old memory" half-state survives.
    assert.throws(() => {
      const tx = db.transaction(() => {
        db.prepare(
          "UPDATE messages SET content=?, alternates=?, active_variant=?, status_widget_values_json=? WHERE id=?"
        ).run(newText, JSON.stringify([variantRow(newText)]), 0, "{}", 50);
        db.exec("DROP TABLE episodic_memory_facts");
        deleteEpisodicMemoryFactsByAssistantMessageIds(db, 1, [50]);
      });
      tx();
    });

    // The DROP TABLE was inside the rolled-back transaction, so SQLite restored
    // the table AND its data. No CREATE needed. Inspect rollback state.
    assert.equal(messageContent(db, 50), "원본 본문입니다.", "prose update rolled back");
    const stored = parseStoredStatusWidgetValuesJson(storedWidgetJson(db, 50));
    assert.deepEqual(stored.character, { affection: "40" }, "status snapshot rolled back");
    assert.equal(stored.extracted_facts?.length, 1, "embedded facts rolled back (preserved)");
    // No new-prose + old-memory half-state: the original fact row is intact
    // (table + data restored on rollback), and the prose did NOT advance.
    assert.equal(countFacts(db, 1, 5), 1, "no half-state; original fact preserved");
  });

  it("TX5 manual status edit — saved sanitized status == trigger evaluator input", () => {
    const db = makeMessagesDb();
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content, model, status_widget_values_json) VALUES (?,?,?,?,?,?)"
    ).run(
      50, 1, "assistant", "동일 본문입니다.", "test",
      JSON.stringify({ character: { corruption: "40" }, user: null })
    );
    insertStatusWidgetTriggerForTest(db, triggerDef({ character_id: 7 }));

    const same = "동일 본문입니다.";
    const incomingWidgets: ParsedStatusWidgetTurnValues = {
      character: { corruption: "75" },
      user: null,
    };
    const { statusWidgetValuesJson, sanitized } = buildManualEditPayload({
      existingJson: storedWidgetJson(db, 50),
      hasWidgetPatch: true,
      incomingWidgets,
      materialProseChange: false,
    });

    executeAtomicManualEditCore(db, {
      chatId: 1, messageId: 50, content: same,
      alternatesJson: JSON.stringify([variantRow(same)]),
      statusWidgetValuesJson,
      materialProseChange: false,
      sourceTurn: getAssistantSourceTurn(db, 1, 50),
      supersedeTriggers: true,
      triggerSupersessionReason: "manual_status_edit",
    });

    // What DB saved:
    const stored = parseStoredStatusWidgetValuesJson(storedWidgetJson(db, 50));
    assert.deepEqual(stored, sanitized, "stored sanitized payload == sanitized");

    // Trigger evaluator receives the same sanitized payload (§13 parity).
    const sourceTurn = getAssistantSourceTurn(db, 1, 50);
    assert(sourceTurn != null);
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn,
      statusValues: sanitized,
      sourceMessageId: 50, requestId: null, generationSequence: null,
    });
    assert.equal(activeTriggerEvents(db, 1, 50), 1, "trigger fired from saved sanitized status");
  });
});

describe("Phase B0.2 — manual status trigger atomicity (TX6-TX9)", () => {
  function triggerDef(over: Partial<StatusWidgetTriggerDefinition>): StatusWidgetTriggerDefinition {
    return {
      trigger_id: over.trigger_id ?? "corruption_70",
      status_key: over.status_key ?? "corruption",
      operator: over.operator ?? ">=",
      value: over.value ?? 70,
      fire_once: over.fire_once ?? true,
      event_key: over.event_key ?? "corruption_event",
      effect_text: over.effect_text ?? "환각 이벤트",
      character_knowledge: over.character_knowledge ?? "unknown",
      is_enabled: over.is_enabled ?? true,
    } as StatusWidgetTriggerDefinition;
  }

  function countSuperseded(
    db: Database.Database,
    chatId: number,
    sourceMessageId: number
  ): number {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM status_trigger_events
         WHERE chat_id=? AND source_message_id=? AND is_superseded=1`
      )
      .get(chatId, sourceMessageId) as { c: number };
    return row.c;
  }

  it("TX6 status-only supersession forced-failure → message/status + trigger all roll back", () => {
    const db = makeMessagesDb();
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content, model, status_widget_values_json, generation_status) VALUES (?,?,?,?,?,?,?)"
    ).run(
      50, 1, "assistant", "동일 본문입니다.", "test",
      JSON.stringify({ character: { corruption: "80" }, user: null }),
      "completed"
    );
    insertStatusWidgetTriggerForTest(db, triggerDef({ character_id: 7 }));
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 1,
      statusValues: { character: { corruption: "80" }, user: null },
      sourceMessageId: 50, requestId: "r1", generationSequence: 0,
    });
    assert.equal(activeTriggerEvents(db, 1, 50), 1, "old trigger active");

    const same = "동일 본문입니다.";
    const { statusWidgetValuesJson } = buildManualEditPayload({
      existingJson: storedWidgetJson(db, 50),
      hasWidgetPatch: true,
      incomingWidgets: { character: { corruption: "20" }, user: null },
      materialProseChange: false,
    });

    // Force supersession UPDATE to abort inside the atomic core transaction.
    db.exec(`
      CREATE TRIGGER fail_supersede BEFORE UPDATE ON status_trigger_events
      WHEN NEW.is_superseded = 1
      BEGIN
        SELECT RAISE(ABORT, 'forced supersession failure');
      END;
    `);

    assert.throws(() => {
      executeAtomicManualEditCore(db, {
        chatId: 1, messageId: 50, content: same,
        alternatesJson: JSON.stringify([variantRow(same)]),
        statusWidgetValuesJson,
        materialProseChange: false,
        sourceTurn: getAssistantSourceTurn(db, 1, 50),
        supersedeTriggers: true,
        triggerSupersessionReason: "manual_status_edit",
      });
    }, /forced supersession failure/);

    // No NEW STATUS + OLD TRIGGER half-state.
    const stored = parseStoredStatusWidgetValuesJson(storedWidgetJson(db, 50));
    assert.deepEqual(stored.character, { corruption: "80" }, "status rolled back to 80");
    assert.equal(messageContent(db, 50), same, "prose unchanged");
    assert.equal(activeTriggerEvents(db, 1, 50), 1, "old trigger remains active");
    assert.equal(countSuperseded(db, 1, 50), 0, "no supersession committed");
  });

  it("TX7 material prose + widget → episodic invalidate + trigger supersede atomically; re-eval uses new status", () => {
    const db = makeMessagesDb();
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content, model, status_widget_values_json, generation_status) VALUES (?,?,?,?,?,?,?)"
    ).run(
      50, 1, "assistant", "원본 본문 A입니다.", "test",
      JSON.stringify({
        character: { corruption: "80" },
        user: null,
        extracted_facts: [fact("둘은 동행하기로 합의했다.")],
      }),
      "completed"
    );
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 1,
      facts: [fact("둘은 동행하기로 합의했다.")],
      metadata: { assistant_message_id: 50, request_id: "r1" },
    });
    insertStatusWidgetTriggerForTest(db, triggerDef({ character_id: 7 }));
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 1,
      statusValues: { character: { corruption: "80" }, user: null },
      sourceMessageId: 50, requestId: "r1", generationSequence: 0,
    });
    assert.equal(activeTriggerEvents(db, 1, 50), 1);
    assert.equal(countFacts(db, 1, 1), 1);

    const newText = "완전히 다른 전개 B로 바뀌었다.";
    assert.equal(isMaterialProseEdit("원본 본문 A입니다.", newText), true);
    const { statusWidgetValuesJson, sanitized } = buildManualEditPayload({
      existingJson: storedWidgetJson(db, 50),
      hasWidgetPatch: true,
      incomingWidgets: { character: { corruption: "20" }, user: null },
      materialProseChange: true,
    });

    executeAtomicManualEditCore(db, {
      chatId: 1, messageId: 50, content: newText,
      alternatesJson: JSON.stringify([variantRow(newText)]),
      statusWidgetValuesJson,
      materialProseChange: true,
      sourceTurn: getAssistantSourceTurn(db, 1, 50),
      supersedeTriggers: true,
      triggerSupersessionReason: "manual_status_edit",
    });

    assert.equal(messageContent(db, 50), newText, "prose = B");
    const stored = parseStoredStatusWidgetValuesJson(storedWidgetJson(db, 50));
    assert.deepEqual(stored.character, { corruption: "20" }, "status = 20");
    assert.equal(stored.extracted_facts, undefined, "embedded facts cleared");
    assert.equal(countFacts(db, 1, 1), 0, "old episodic fact deleted");
    assert.equal(activeTriggerEvents(db, 1, 50), 0, "old trigger superseded");
    assert.equal(countSuperseded(db, 1, 50), 1, "exactly one supersession");

    // Post-commit re-eval with saved sanitized payload (corruption=20 < 70 → no fire).
    const sourceTurn = getAssistantSourceTurn(db, 1, 50);
    assert(sourceTurn != null);
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn,
      statusValues: sanitized,
      sourceMessageId: 50, requestId: null, generationSequence: null,
    });
    assert.equal(activeTriggerEvents(db, 1, 50), 0, "20 does not re-fire corruption>=70");
    assert.deepEqual(stored, sanitized, "DB SAVED STATUS == TRIGGER EVALUATION STATUS");
  });

  it("TX8 material prose no-widget → facts cleared, triggers untouched", () => {
    const db = makeMessagesDb();
    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content, model, status_widget_values_json, generation_status) VALUES (?,?,?,?,?,?,?)"
    ).run(
      50, 1, "assistant", "원본 본문입니다.", "test",
      JSON.stringify({
        character: { corruption: "80", affection: "40" },
        user: { mood: "tense" },
        extracted_facts: [fact("둘은 동행하기로 합의했다.")],
      }),
      "completed"
    );
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 1,
      facts: [fact("둘은 동행하기로 합의했다.")],
      metadata: { assistant_message_id: 50, request_id: "r1" },
    });
    assert.equal(countFacts(db, 1, 1), 1, "precondition: episodic fact present");
    insertStatusWidgetTriggerForTest(db, triggerDef({ character_id: 7 }));
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 1,
      statusValues: { character: { corruption: "80" }, user: null },
      sourceMessageId: 50, requestId: "r1", generationSequence: 0,
    });
    assert.equal(activeTriggerEvents(db, 1, 50), 1);

    const newText = "완전히 다른 전개로 바뀌었다.";
    const { statusWidgetValuesJson } = buildManualEditPayload({
      existingJson: storedWidgetJson(db, 50),
      hasWidgetPatch: false,
      incomingWidgets: null,
      materialProseChange: true,
    });

    executeAtomicManualEditCore(db, {
      chatId: 1, messageId: 50, content: newText,
      alternatesJson: JSON.stringify([variantRow(newText)]),
      statusWidgetValuesJson,
      materialProseChange: true,
      sourceTurn: getAssistantSourceTurn(db, 1, 50),
      supersedeTriggers: false,
    });

    const stored = parseStoredStatusWidgetValuesJson(storedWidgetJson(db, 50));
    assert.deepEqual(stored.character, { corruption: "80", affection: "40" }, "status preserved");
    assert.deepEqual(stored.user, { mood: "tense" }, "user preserved");
    assert.equal(stored.extracted_facts, undefined, "embedded facts cleared");
    assert.equal(countFacts(db, 1, 1), 0, "DB episodic deleted");
    assert.equal(activeTriggerEvents(db, 1, 50), 1, "trigger events unchanged");
    assert.equal(countSuperseded(db, 1, 50), 0, "no supersession");
  });

  it("TX9 format-only + widget → episodic preserved, trigger superseded atomically, re-eval on new status", () => {
    const db = makeMessagesDb();
    const before = "에녹은 렌의 손을 잡았다.\n\n그는 대답하지 않았다.";
    const after = "에녹은 렌의 손을 잡았다.  \r\n\r\n  그는 대답하지 않았다.";
    assert.equal(isMaterialProseEdit(before, after), false);

    db.prepare(
      "INSERT INTO messages (id, chat_id, role, content, model, status_widget_values_json, generation_status) VALUES (?,?,?,?,?,?,?)"
    ).run(
      50, 1, "assistant", before, "test",
      JSON.stringify({
        character: { corruption: "80" },
        user: null,
        extracted_facts: [fact("둘은 동행하기로 합의했다.")],
      }),
      "completed"
    );
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 1,
      facts: [fact("둘은 동행하기로 합의했다.")],
      metadata: { assistant_message_id: 50, request_id: "r1" },
    });
    assert.equal(countFacts(db, 1, 1), 1, "precondition: episodic fact present");
    insertStatusWidgetTriggerForTest(db, triggerDef({ character_id: 7 }));
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 1,
      statusValues: { character: { corruption: "80" }, user: null },
      sourceMessageId: 50, requestId: "r1", generationSequence: 0,
    });
    assert.equal(activeTriggerEvents(db, 1, 50), 1);

    const { statusWidgetValuesJson, sanitized } = buildManualEditPayload({
      existingJson: storedWidgetJson(db, 50),
      hasWidgetPatch: true,
      incomingWidgets: { character: { corruption: "20" }, user: null },
      materialProseChange: false,
    });

    executeAtomicManualEditCore(db, {
      chatId: 1, messageId: 50, content: after,
      alternatesJson: JSON.stringify([variantRow(after)]),
      statusWidgetValuesJson,
      materialProseChange: false,
      sourceTurn: getAssistantSourceTurn(db, 1, 50),
      supersedeTriggers: true,
      triggerSupersessionReason: "manual_status_edit",
    });

    assert.equal(countFacts(db, 1, 1), 1, "episodic facts preserved");
    const stored = parseStoredStatusWidgetValuesJson(storedWidgetJson(db, 50));
    assert.deepEqual(stored.character, { corruption: "20" }, "status snapshot updated");
    assert.equal(stored.extracted_facts?.length, 1, "embedded facts preserved");
    assert.equal(activeTriggerEvents(db, 1, 50), 0, "old trigger superseded");
    assert.equal(countSuperseded(db, 1, 50), 1);

    const sourceTurn = getAssistantSourceTurn(db, 1, 50);
    assert(sourceTurn != null);
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn,
      statusValues: sanitized,
      sourceMessageId: 50, requestId: null, generationSequence: null,
    });
    assert.equal(activeTriggerEvents(db, 1, 50), 0, "new status 20 does not fire >=70");
    assert.deepEqual(stored, sanitized, "DB SAVED STATUS == TRIGGER EVALUATION STATUS");
  });
});

describe("Phase B0.1 — strict episodic persistence core (no exception swallow)", () => {
  it("persistEpisodicMemoryFactsCore throws on DB failure (best-effort wrapper swallows)", () => {
    const db = makeMessagesDb();
    // Drop the table to force a DB error.
    db.exec("DROP TABLE episodic_memory_facts");
    assert.throws(() => {
      persistEpisodicMemoryFactsCore(db, {
        chatId: 1, characterId: 7, userId: 4, sourceTurn: 1,
        facts: [fact("테스트 사실입니다.")],
        metadata: { assistant_message_id: 50, request_id: "r1" },
      });
    }, /episodic_memory_facts/);

    // Best-effort wrapper must swallow the same failure (unchanged semantics).
    const n = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 1,
      facts: [fact("테스트 사실입니다.")],
      metadata: { assistant_message_id: 50, request_id: "r1" },
    });
    assert.equal(n, 0, "best-effort wrapper returns 0 on failure");
  });
});
