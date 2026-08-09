/**
 * Phase B1-D2 — selected variant = canonical worldline tests.
 *
 * LAST GENERATED != CANONICAL
 * ACTIVE SELECTED VARIANT == CANONICAL
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { ServerMeterNumericStateDefinitionV1 } from "@/lib/statusWidget/types";
import { ensureEpisodicMemoryFactsTable } from "@/lib/episodicMemoryFacts";
import {
  ensureStatusWidgetTriggerTables,
  evaluateStatusWidgetTriggers,
  insertStatusWidgetTriggerForTest,
} from "@/lib/statusWidgetTriggers";
import {
  executeAtomicVariantSwitchCore,
  isCanonicalFrontierAssistantMessage,
} from "@/lib/rpDerivedStateLifecycle";
import { executeLastTurnDeleteTransaction } from "@/lib/chatLastTurnDelete";
import {
  bootstrapNumericStateCurrentCore,
  commitNumericStateProposalCore,
  commitNumericStateReplacementCore,
  ensureRpNumericStateTables,
  executeAtomicNumericVariantSwitch,
  getNumericStateCurrent,
  getNumericStateEventById,
  listCanonicalEligibleNumericFields,
  NumericHistoricalVariantReplayUnsupportedError,
  NumericVariantFrontierMovedError,
  NumericVariantSourceNotReadyError,
  projectNumericStateToSelectedVariantCore,
  resolveSelectedVariantGenerationEvent,
} from "@/lib/rpNumericState";
import { parseStatusWidgetJson, serializeStatusWidget } from "@/lib/statusWidget";
import { parseStoredStatusWidgetValuesJson } from "@/lib/statusWidget/parseValues";
import { fingerprintNumericStateDefinition } from "@/lib/statusWidget/numericStateFingerprint";
import type { MessageVariant } from "@/lib/messageAlternates";
import { pickNextSummaryBatch } from "@/lib/memory/memory-rolling-summary";
import { expectedBatchStartsThrough } from "@/lib/memory/memory-summary-integrity";
import { ROLLING_SUMMARY_INTERVAL, type DialogueTurn } from "@/lib/hybridMemory";

const def: ServerMeterNumericStateDefinitionV1 = {
  version: 1,
  mode: "server_meter",
  min: 0,
  max: 100,
  initial: 20,
  integer: true,
  maxIncreasePerTurn: 50,
  maxDecreasePerTurn: 50,
};

const PILOT_WIDGET = {
  version: 1 as const,
  name: "B1-D2",
  placement: "bottom" as const,
  htmlTemplate: `<div>{{호감도}}</div><div>{{신뢰}}</div><div>{{오염도}}</div>`,
  fields: [
    {
      id: "affection",
      label: "호감도",
      instruction: "x",
      initialValue: "20",
      numericState: { ...def, initial: 20 },
    },
    {
      id: "trust",
      label: "신뢰",
      instruction: "x",
      initialValue: "30",
      numericState: { ...def, initial: 30 },
    },
    {
      id: "corruption",
      label: "오염도",
      instruction: "x",
      initialValue: "0",
      numericState: { ...def, initial: 0 },
    },
  ],
};

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      total_turns INTEGER NOT NULL DEFAULT 0,
      status_widget_json TEXT NOT NULL DEFAULT ''
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
      status_widget_values_json TEXT DEFAULT '',
      status_widget_turn_active INTEGER DEFAULT 0,
      generation_status TEXT DEFAULT 'completed',
      adult_route_meta_json TEXT DEFAULT '',
      status TEXT DEFAULT 'ok',
      is_refunded INTEGER DEFAULT 0,
      status_meta TEXT,
      deduction_slices TEXT,
      user_message_id INTEGER,
      updated_at TEXT
    );
    CREATE TABLE bookmarks (message_id INTEGER PRIMARY KEY);
    CREATE TABLE chat_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      pinned_facts TEXT NOT NULL DEFAULT '',
      recent_summary TEXT NOT NULL DEFAULT '',
      archive_summary TEXT NOT NULL DEFAULT '',
      membership_tier TEXT NOT NULL DEFAULT 'free',
      used_chars INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      summarized_turn_count INTEGER NOT NULL DEFAULT 0,
      last_compressed_at TEXT,
      memory_reset_after_message_id INTEGER,
      memory_epoch INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT INTO characters (id, total_turns, status_widget_json) VALUES (7, 10, ?)`
  ).run(serializeStatusWidget(PILOT_WIDGET));
  ensureRpNumericStateTables(db);
  ensureStatusWidgetTriggerTables(db);
  ensureEpisodicMemoryFactsTable(db);
  return db;
}

function insertMsg(
  db: Database.Database,
  id: number,
  chatId: number,
  role: "user" | "assistant",
  content: string,
  opts: {
    statusJson?: string;
    alternates?: string;
    activeVariant?: number;
    generationStatus?: string;
  } = {}
): void {
  db.prepare(
    `INSERT INTO messages
     (id, chat_id, role, content, model, status_widget_values_json, alternates, active_variant, generation_status)
     VALUES (?, ?, ?, ?, 'test', ?, ?, ?, ?)`
  ).run(
    id,
    chatId,
    role,
    content,
    opts.statusJson ?? "",
    opts.alternates ?? "[]",
    opts.activeVariant ?? 0,
    opts.generationStatus ?? "completed"
  );
}

function commitGen(
  db: Database.Database,
  opts: {
    chatId: number;
    stateKey: string;
    proposal: number;
    assistantMessageId: number;
    generationSequence: number;
    requestId: string;
    sourceTurn: number;
    characterId?: number;
  }
) {
  if (opts.generationSequence === 0) {
    return commitNumericStateProposalCore(db, {
      chatId: opts.chatId,
      characterId: opts.characterId ?? 7,
      stateKey: opts.stateKey,
      definition: def,
      proposal: opts.proposal,
      mutationId: `gen:${opts.assistantMessageId}:${opts.generationSequence}:${opts.requestId}`,
      sourceKind: "extractor",
      assistantMessageId: opts.assistantMessageId,
      generationSequence: opts.generationSequence,
      requestId: opts.requestId,
      sourceTurn: opts.sourceTurn,
    });
  }
  return commitNumericStateReplacementCore(db, {
    chatId: opts.chatId,
    characterId: opts.characterId ?? 7,
    stateKey: opts.stateKey,
    definition: def,
    proposal: opts.proposal,
    mutationId: `gen:${opts.assistantMessageId}:${opts.generationSequence}:${opts.requestId}`,
    sourceKind: "extractor",
    assistantMessageId: opts.assistantMessageId,
    generationSequence: opts.generationSequence,
    requestId: opts.requestId,
    sourceTurn: opts.sourceTurn,
  });
}

function fact(
  text: string,
  attribute: string,
  value: string
): {
  category: "relationship";
  subject: string;
  attribute: string;
  value: string;
  importance: "important";
  fact_text: string;
} {
  return {
    category: "relationship",
    subject: "user",
    attribute,
    value,
    importance: "important",
    fact_text: text,
  };
}

function makeVariants(
  specs: Array<{
    content: string;
    affection: number;
    trust?: number;
    corruption?: number;
    location?: string;
    mood?: string;
    /** Nonnumeric clock snapshot (must not be advanced on variant select). */
    time?: string;
    seq: number;
    requestId: string;
    facts?: ReturnType<typeof fact>[];
  }>
): MessageVariant[] {
  return specs.map((s) => ({
    content: s.content,
    model: "test",
    usage: null,
    created_at: new Date().toISOString(),
    statusWidgetValues: {
      character: {
        호감도: String(s.affection),
        ...(s.trust != null ? { 신뢰: String(s.trust) } : {}),
        ...(s.corruption != null ? { 오염도: String(s.corruption) } : {}),
        ...(s.location ? { location: s.location } : {}),
        ...(s.mood ? { mood: s.mood } : {}),
        ...(s.time ? { 시간: s.time } : {}),
      },
      user: null,
      ...(s.facts?.length ? { extracted_facts: s.facts } : {}),
    },
    statusWidgetTurnActive: true,
    generationSequence: s.seq,
    requestId: s.requestId,
  }));
}

function seedABCD(db: Database.Database) {
  bootstrapNumericStateCurrentCore(db, {
    chatId: 1,
    characterId: 7,
    stateKey: "affection",
    definition: def,
    baselineValue: 30,
    mutationId: "bootstrap:1:affection:definition_initial",
    sourceKind: "definition_initial",
  });
  insertMsg(db, 1, 1, "user", "u-prev");
  insertMsg(db, 2, 1, "assistant", "prev-a", {
    statusJson: JSON.stringify({ character: { 호감도: "30" } }),
  });
  // previous tip stays at bootstrap; latest turn:
  insertMsg(db, 3, 1, "user", "u-latest");
  const variants = makeVariants([
    {
      content: "A prose",
      affection: 35,
      location: "골목",
      mood: "경계",
      seq: 0,
      requestId: "req-a",
      facts: [fact("사용자는 골목에서 경계를 유지했다.", "scene_a", "alley")],
    },
    {
      content: "B prose",
      affection: 38,
      location: "창고",
      mood: "경계",
      seq: 1,
      requestId: "req-b",
      facts: [fact("사용자는 창고에서 경계를 유지했다.", "scene_b", "warehouse")],
    },
    {
      content: "C prose",
      affection: 32,
      location: "지붕",
      mood: "침묵",
      seq: 2,
      requestId: "req-c",
      facts: [],
    },
    {
      content: "D prose",
      affection: 41,
      location: "골목",
      mood: "분노",
      seq: 3,
      requestId: "req-d",
      facts: [fact("사용자는 골목에서 분노를 드러냈다.", "scene_d", "alley")],
    },
  ]);
  insertMsg(db, 4, 1, "assistant", "D prose", {
    statusJson: JSON.stringify(variants[3]!.statusWidgetValues),
    alternates: JSON.stringify(variants),
    activeVariant: 3,
  });
  commitGen(db, {
    chatId: 1,
    stateKey: "affection",
    proposal: 35,
    assistantMessageId: 4,
    generationSequence: 0,
    requestId: "req-a",
    sourceTurn: 2,
  });
  commitGen(db, {
    chatId: 1,
    stateKey: "affection",
    proposal: 38,
    assistantMessageId: 4,
    generationSequence: 1,
    requestId: "req-b",
    sourceTurn: 2,
  });
  commitGen(db, {
    chatId: 1,
    stateKey: "affection",
    proposal: 32,
    assistantMessageId: 4,
    generationSequence: 2,
    requestId: "req-c",
    sourceTurn: 2,
  });
  commitGen(db, {
    chatId: 1,
    stateKey: "affection",
    proposal: 41,
    assistantMessageId: 4,
    generationSequence: 3,
    requestId: "req-d",
    sourceTurn: 2,
  });
  db.prepare(
    `INSERT INTO episodic_memory_facts
     (chat_id, character_id, user_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
     VALUES (1, 7, 1, 2, 'relationship', 'user', 'scene_d', 'alley', 'important',
             '사용자는 골목에서 분노를 드러냈다.', '{"assistant_message_id":4,"request_id":"req-d"}')`
  ).run();
  return variants;
}

function widget() {
  return parseStatusWidgetJson(serializeStatusWidget(PILOT_WIDGET));
}

describe("Phase B1-D2 — numeric variant selection", () => {
  it("V1 D→B: selection event projects 38; revision monotonic; gens preserved", () => {
    const db = makeDb();
    const variants = seedABCD(db);
    const before = getNumericStateCurrent(db, 1, "affection")!;
    assert.equal(before.numericValue, 41);
    const revBefore = before.revision;

    const result = executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 4,
      variantIndex: 1,
      variants,
      content: "B prose",
      model: "test",
      usageJson: null,
      adultRouteMetaJson: "",
      sourceTurn: 2,
      characterWidget: widget(),
    });
    assert.equal(result.kind, "APPLIED");
    const cur = getNumericStateCurrent(db, 1, "affection")!;
    assert.equal(cur.numericValue, 38);
    assert.equal(cur.revision, revBefore + 1);
    const tip = getNumericStateEventById(db, cur.lastEventId!)!;
    assert.equal(tip.sourceKind, "variant_switch");
    assert.equal(tip.beforeValue, 30);
    assert.equal(tip.afterValue, 38);
    assert.equal(tip.replacesEventId, before.lastEventId);

    // Original generation events preserved
    for (const seq of [0, 1, 2, 3]) {
      const ev = resolveSelectedVariantGenerationEvent(db, {
        chatId: 1,
        stateKey: "affection",
        assistantMessageId: 4,
        generationSequence: seq,
        requestId: `req-${["a", "b", "c", "d"][seq]}`,
      });
      assert.ok(ev);
    }

    const msg = db
      .prepare(`SELECT content, active_variant, status_widget_values_json AS v FROM messages WHERE id=4`)
      .get() as { content: string; active_variant: number; v: string };
    assert.equal(msg.content, "B prose");
    assert.equal(msg.active_variant, 1);
    const status = parseStoredStatusWidgetValuesJson(msg.v)!;
    assert.equal(status.character?.호감도, "38");
    assert.equal(status.character?.location, "창고");

    const episodic = (
      db
        .prepare(
          `SELECT fact_text AS t FROM episodic_memory_facts WHERE chat_id=1 AND source_turn=2`
        )
        .all() as Array<{ t: string }>
    ).map((r) => r.t);
    assert.deepEqual(episodic, ["사용자는 창고에서 경계를 유지했다."]);
  });

  it("V3 reselection B→C→A→D→B keeps revision monotonic", () => {
    const db = makeDb();
    const variants = seedABCD(db);
    const order = [1, 2, 0, 3, 1];
    const values = [38, 32, 35, 41, 38];
    let prevRev = getNumericStateCurrent(db, 1, "affection")!.revision;
    for (let i = 0; i < order.length; i++) {
      executeAtomicNumericVariantSwitch(db, {
        chatId: 1,
        characterId: 7,
        userId: 1,
        messageId: 4,
        variantIndex: order[i]!,
        variants,
        content: variants[order[i]!]!.content,
        model: "test",
        usageJson: null,
        adultRouteMetaJson: "",
        sourceTurn: 2,
        characterWidget: widget(),
      });
      const cur = getNumericStateCurrent(db, 1, "affection")!;
      assert.equal(cur.numericValue, values[i]);
      assert.ok(cur.revision > prevRev);
      prevRev = cur.revision;
      const active = (
        db.prepare(`SELECT active_variant AS a FROM messages WHERE id=4`).get() as {
          a: number;
        }
      ).a;
      assert.equal(active, order[i]);
    }
  });

  it("V4 same-active idempotent noop inside txn", () => {
    const db = makeDb();
    const variants = seedABCD(db);
    executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 4,
      variantIndex: 1,
      variants,
      content: "B prose",
      model: "test",
      usageJson: null,
      adultRouteMetaJson: "",
      sourceTurn: 2,
      characterWidget: widget(),
    });
    const rev = getNumericStateCurrent(db, 1, "affection")!.revision;
    const eventsBefore = (
      db.prepare(`SELECT COUNT(*) AS c FROM rp_numeric_state_events`).get() as {
        c: number;
      }
    ).c;
    // Force active already B then call again
    const r = executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 4,
      variantIndex: 1,
      variants,
      content: "B prose",
      model: "test",
      usageJson: null,
      adultRouteMetaJson: "",
      sourceTurn: 2,
      characterWidget: widget(),
    });
    assert.equal(r.kind, "IDEMPOTENT_NOOP");
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.revision, rev);
    assert.equal(
      (
        db.prepare(`SELECT COUNT(*) AS c FROM rp_numeric_state_events`).get() as {
          c: number;
        }
      ).c,
      eventsBefore
    );
  });

  it("V7 multi-field atomic projection", () => {
    const db = makeDb();
    for (const key of ["affection", "trust", "corruption"] as const) {
      const initial = key === "affection" ? 30 : key === "trust" ? 70 : 15;
      bootstrapNumericStateCurrentCore(db, {
        chatId: 1,
        characterId: 7,
        stateKey: key,
        definition: def,
        baselineValue: initial,
        mutationId: `bootstrap:1:${key}:definition_initial`,
        sourceKind: "definition_initial",
      });
    }
    insertMsg(db, 1, 1, "user", "u");
    const variants = makeVariants([
      {
        content: "B",
        affection: 40,
        trust: 70,
        corruption: 15,
        seq: 0,
        requestId: "b",
      },
      {
        content: "D",
        affection: 55,
        trust: 60,
        corruption: 30,
        seq: 1,
        requestId: "d",
      },
    ]);
    insertMsg(db, 2, 1, "assistant", "D", {
      statusJson: JSON.stringify(variants[1]!.statusWidgetValues),
      alternates: JSON.stringify(variants),
      activeVariant: 1,
    });
    for (const [key, b, d] of [
      ["affection", 40, 55],
      ["trust", 70, 60],
      ["corruption", 15, 30],
    ] as const) {
      commitGen(db, {
        chatId: 1,
        stateKey: key,
        proposal: b,
        assistantMessageId: 2,
        generationSequence: 0,
        requestId: "b",
        sourceTurn: 1,
      });
      commitGen(db, {
        chatId: 1,
        stateKey: key,
        proposal: d,
        assistantMessageId: 2,
        generationSequence: 1,
        requestId: "d",
        sourceTurn: 1,
      });
    }
    executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 2,
      variantIndex: 0,
      variants,
      content: "B",
      model: "test",
      usageJson: null,
      adultRouteMetaJson: "",
      sourceTurn: 1,
      characterWidget: widget(),
    });
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 40);
    assert.equal(getNumericStateCurrent(db, 1, "trust")!.numericValue, 70);
    assert.equal(getNumericStateCurrent(db, 1, "corruption")!.numericValue, 15);
  });

  it("V10 missing generationSequence fail-closed", () => {
    const db = makeDb();
    const variants = seedABCD(db);
    // Must corrupt txn-local DB alternates — preload is ignored.
    const corrupted = variants.map((v, i) =>
      i === 1 ? { ...v, generationSequence: undefined } : v
    );
    db.prepare(`UPDATE messages SET alternates=? WHERE id=4`).run(
      JSON.stringify(corrupted)
    );
    assert.throws(
      () =>
        executeAtomicNumericVariantSwitch(db, {
          chatId: 1,
          characterId: 7,
          userId: 1,
          messageId: 4,
          variantIndex: 1,
          characterWidget: widget(),
        }),
      (e: unknown) => e instanceof NumericVariantSourceNotReadyError
    );
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 41);
  });

  it("V16/V17 trigger supersession + threshold on B", () => {
    const db = makeDb();
    const variants = seedABCD(db);
    insertStatusWidgetTriggerForTest(db, {
      character_id: 7,
      trigger_id: "aff_40",
      status_key: "호감도",
      operator: ">=",
      value: 40,
      fire_once: true,
      event_key: "aff_high",
      effect_text: "호감 임계",
    });
    // D tip 41 already — fire for D first
    evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      characterId: 7,
      sourceTurn: 2,
      statusValues: variants[3]!.statusWidgetValues!,
      sourceMessageId: 4,
      requestId: "req-d",
      generationSequence: 3,
    });
    assert.equal(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM status_trigger_events
             WHERE chat_id=1 AND is_superseded=0 AND trigger_id='aff_40'`
          )
          .get() as { c: number }
      ).c,
      1
    );

    const result = executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 4,
      variantIndex: 1,
      variants,
      content: "B prose",
      model: "test",
      usageJson: null,
      adultRouteMetaJson: "",
      sourceTurn: 2,
      characterWidget: widget(),
    });
    assert.equal(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM status_trigger_events
             WHERE chat_id=1 AND is_superseded=0`
          )
          .get() as { c: number }
      ).c,
      0
    );
    // Post-commit re-eval with FINAL canonical status (38) — should NOT fire gte 40
    evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      characterId: 7,
      sourceTurn: 2,
      statusValues: result.canonicalStatusForTriggers!,
      sourceMessageId: 4,
      requestId: "req-b",
      generationSequence: 1,
    });
    assert.equal(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM status_trigger_events
             WHERE chat_id=1 AND is_superseded=0 AND trigger_id='aff_40'`
          )
          .get() as { c: number }
      ).c,
      0
    );

    // Switch to D (41) — should fire again (superseded don't block)
    executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 4,
      variantIndex: 3,
      variants,
      content: "D prose",
      model: "test",
      usageJson: null,
      adultRouteMetaJson: "",
      sourceTurn: 2,
      characterWidget: widget(),
    });
    evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      characterId: 7,
      sourceTurn: 2,
      statusValues: {
        character: { 호감도: "41" },
        user: null,
      },
      sourceMessageId: 4,
      requestId: "req-d",
      generationSequence: 3,
    });
    assert.ok(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM status_trigger_events
             WHERE chat_id=1 AND is_superseded=0 AND trigger_id='aff_40'`
          )
          .get() as { c: number }
      ).c >= 1
    );
  });

  it("V18 frontier moved when later user exists", () => {
    const db = makeDb();
    const variants = seedABCD(db);
    insertMsg(db, 5, 1, "user", "next");
    assert.equal(isCanonicalFrontierAssistantMessage(db, 1, 4), false);
    assert.throws(
      () =>
        executeAtomicNumericVariantSwitch(db, {
          chatId: 1,
          characterId: 7,
          userId: 1,
          messageId: 4,
          variantIndex: 1,
          variants,
          content: "B prose",
          model: "test",
          usageJson: null,
          adultRouteMetaJson: "",
          sourceTurn: 2,
          characterWidget: widget(),
        }),
      (e: unknown) => e instanceof NumericVariantFrontierMovedError
    );
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 41);
    assert.equal(
      (
        db.prepare(`SELECT active_variant AS a FROM messages WHERE id=4`).get() as {
          a: number;
        }
      ).a,
      3
    );
  });

  it("V19 historical numeric variant blocked", () => {
    const db = makeDb();
    const variants = seedABCD(db);
    insertMsg(db, 5, 1, "user", "u2");
    insertMsg(db, 6, 1, "assistant", "later", {
      generationStatus: "completed",
    });
    assert.throws(
      () =>
        executeAtomicNumericVariantSwitch(db, {
          chatId: 1,
          characterId: 7,
          userId: 1,
          messageId: 4,
          variantIndex: 1,
          variants,
          content: "B prose",
          model: "test",
          usageJson: null,
          adultRouteMetaJson: "",
          sourceTurn: 2,
          characterWidget: widget(),
        }),
      (e: unknown) => e instanceof NumericHistoricalVariantReplayUnsupportedError
    );
  });

  it("V21 select→next normal baseline uses B.after", () => {
    const db = makeDb();
    const variants = seedABCD(db);
    executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 4,
      variantIndex: 1,
      variants,
      content: "B prose",
      model: "test",
      usageJson: null,
      adultRouteMetaJson: "",
      sourceTurn: 2,
      characterWidget: widget(),
    });
    insertMsg(db, 5, 1, "user", "u-next");
    insertMsg(db, 6, 1, "assistant", "next");
    const next = commitNumericStateProposalCore(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      proposal: 42,
      mutationId: "gen:6:0:next",
      sourceKind: "extractor",
      assistantMessageId: 6,
      generationSequence: 0,
      requestId: "next",
      sourceTurn: 3,
    });
    assert.equal(next.event?.beforeValue, 38);
    assert.equal(next.current.numericValue, 42);
  });

  it("V22 select→regen baseline uses original pre-turn 30 not 38", () => {
    const db = makeDb();
    const variants = seedABCD(db);
    executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 4,
      variantIndex: 1,
      variants,
      content: "B prose",
      model: "test",
      usageJson: null,
      adultRouteMetaJson: "",
      sourceTurn: 2,
      characterWidget: widget(),
    });
    const e = commitNumericStateReplacementCore(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      proposal: 36,
      mutationId: "gen:4:4:req-e",
      sourceKind: "extractor",
      assistantMessageId: 4,
      generationSequence: 4,
      requestId: "req-e",
      sourceTurn: 2,
    });
    assert.equal(e.event?.beforeValue, 30);
    assert.equal(e.current.numericValue, 36);
  });

  it("V23 select→D1 delete restores pre-turn 30", () => {
    const db = makeDb();
    const variants = seedABCD(db);
    executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 4,
      variantIndex: 1,
      variants,
      content: "B prose",
      model: "test",
      usageJson: null,
      adultRouteMetaJson: "",
      sourceTurn: 2,
      characterWidget: widget(),
    });
    executeLastTurnDeleteTransaction(db, {
      chatId: 1,
      characterId: 7,
      userMessageId: 3,
      assistantMessageId: 4,
      revertNumeric: true,
    });
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 30);
    assert.equal(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM rp_numeric_state_events WHERE assistant_message_id=4`
          )
          .get() as { c: number }
      ).c,
      0
    );
  });

  it("V24 next-turn history uses messages.content = B", () => {
    const db = makeDb();
    const variants = seedABCD(db);
    executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 4,
      variantIndex: 1,
      variants,
      content: "B prose",
      model: "test",
      usageJson: null,
      adultRouteMetaJson: "",
      sourceTurn: 2,
      characterWidget: widget(),
    });
    const history = db
      .prepare(`SELECT role, content FROM messages WHERE chat_id=1 ORDER BY id`)
      .all() as Array<{ role: string; content: string }>;
    const assistantContents = history
      .filter((m) => m.role === "assistant")
      .map((m) => m.content);
    assert.ok(assistantContents.includes("B prose"));
    assert.equal(assistantContents.includes("D prose"), false);
    assert.equal(assistantContents.includes("C prose"), false);
  });

  it("V26 forced numeric multi-field failure rolls back all", () => {
    const db = makeDb();
    for (const key of ["affection", "trust"] as const) {
      bootstrapNumericStateCurrentCore(db, {
        chatId: 1,
        characterId: 7,
        stateKey: key,
        definition: def,
        baselineValue: key === "affection" ? 30 : 50,
        mutationId: `bootstrap:1:${key}:definition_initial`,
        sourceKind: "definition_initial",
      });
    }
    insertMsg(db, 1, 1, "user", "u");
    const variants = makeVariants([
      { content: "B", affection: 40, trust: 55, seq: 0, requestId: "b" },
      { content: "D", affection: 45, trust: 60, seq: 1, requestId: "d" },
    ]);
    insertMsg(db, 2, 1, "assistant", "D", {
      statusJson: JSON.stringify(variants[1]!.statusWidgetValues),
      alternates: JSON.stringify(variants),
      activeVariant: 1,
    });
    for (const [key, b, d] of [
      ["affection", 40, 45],
      ["trust", 55, 60],
    ] as const) {
      commitGen(db, {
        chatId: 1,
        stateKey: key,
        proposal: b,
        assistantMessageId: 2,
        generationSequence: 0,
        requestId: "b",
        sourceTurn: 1,
      });
      commitGen(db, {
        chatId: 1,
        stateKey: key,
        proposal: d,
        assistantMessageId: 2,
        generationSequence: 1,
        requestId: "d",
        sourceTurn: 1,
      });
    }
    assert.throws(() =>
      executeAtomicNumericVariantSwitch(db, {
        chatId: 1,
        characterId: 7,
        userId: 1,
        messageId: 2,
        variantIndex: 0,
        variants,
        content: "B",
        model: "test",
        usageJson: null,
        adultRouteMetaJson: "",
        sourceTurn: 1,
        characterWidget: widget(),
        __testThrowAfterNumeric: true,
      })
    );
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 45);
    assert.equal(getNumericStateCurrent(db, 1, "trust")!.numericValue, 60);
    assert.equal(
      (
        db.prepare(`SELECT active_variant AS a FROM messages WHERE id=2`).get() as {
          a: number;
        }
      ).a,
      1
    );
  });

  it("V27/V28/V29 forced message/episodic/trigger failures roll back numeric", () => {
    for (const flag of [
      "__testThrowAfterMessageUpdate",
      "__testThrowAfterEpisodic",
      "__testThrowAfterTriggerSupersession",
    ] as const) {
      const db = makeDb();
      const variants = seedABCD(db);
      assert.throws(() =>
        executeAtomicNumericVariantSwitch(db, {
          chatId: 1,
          characterId: 7,
          userId: 1,
          messageId: 4,
          variantIndex: 1,
          variants,
          content: "B prose",
          model: "test",
          usageJson: null,
          adultRouteMetaJson: "",
          sourceTurn: 2,
          characterWidget: widget(),
          [flag]: true,
        })
      );
      assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 41);
      assert.equal(
        (
          db
            .prepare(`SELECT active_variant AS a, content AS c FROM messages WHERE id=4`)
            .get() as { a: number; c: string }
        ).a,
        3
      );
    }
  });

  it("V8 INVALID_HOLD selection restores hold result without reducer rerun", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:1:affection:definition_initial",
      sourceKind: "definition_initial",
    });
    insertMsg(db, 1, 1, "user", "u");
    const variants = makeVariants([
      { content: "hold", affection: 40, seq: 0, requestId: "h" },
      { content: "ok", affection: 45, seq: 1, requestId: "ok" },
    ]);
    insertMsg(db, 2, 1, "assistant", "ok", {
      statusJson: JSON.stringify(variants[1]!.statusWidgetValues),
      alternates: JSON.stringify(variants),
      activeVariant: 1,
    });
    const hold = commitNumericStateProposalCore(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      proposal: "not-a-number",
      mutationId: "gen:2:0:h",
      sourceKind: "extractor",
      assistantMessageId: 2,
      generationSequence: 0,
      requestId: "h",
      sourceTurn: 1,
    });
    assert.equal(hold.kind, "INVALID_HOLD");
    commitGen(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: 45,
      assistantMessageId: 2,
      generationSequence: 1,
      requestId: "ok",
      sourceTurn: 1,
    });
    executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 2,
      variantIndex: 0,
      variants,
      content: "hold",
      model: "test",
      usageJson: null,
      adultRouteMetaJson: "",
      sourceTurn: 1,
      characterWidget: widget(),
    });
    const cur = getNumericStateCurrent(db, 1, "affection")!;
    assert.equal(cur.numericValue, 40);
    const tip = getNumericStateEventById(db, cur.lastEventId!)!;
    assert.equal(tip.outcome, "INVALID_HOLD");
    assert.equal(tip.sourceKind, "variant_switch");
  });

  it("nonnumeric variant switch still works via mutation core wrapper", () => {
    const db = makeDb();
    insertMsg(db, 1, 1, "user", "u");
    const variants = makeVariants([
      { content: "A", affection: 1, seq: 0, requestId: "a" },
      { content: "B", affection: 2, seq: 1, requestId: "b" },
    ]);
    insertMsg(db, 2, 1, "assistant", "A", {
      alternates: JSON.stringify(variants),
      activeVariant: 0,
      statusJson: JSON.stringify(variants[0]!.statusWidgetValues),
    });
    executeAtomicVariantSwitchCore(db, {
      chatId: 1,
      messageId: 2,
      content: "B",
      model: "test",
      usageJson: null,
      adultRouteMetaJson: "",
      variantsJson: JSON.stringify(variants),
      variantIndex: 1,
      statusWidgetValuesJson: JSON.stringify(variants[1]!.statusWidgetValues),
      statusWidgetTurnActive: true,
      sourceTurn: 1,
      characterId: 7,
      userId: 1,
      selectedFacts: [],
      selectedRequestId: "b",
      selectedGenerationSequence: 1,
    });
    assert.equal(
      (
        db.prepare(`SELECT content AS c FROM messages WHERE id=2`).get() as {
          c: string;
        }
      ).c,
      "B"
    );
  });

  it("eligible fields listed for pilot widget", () => {
    const fields = listCanonicalEligibleNumericFields(widget());
    assert.equal(fields.length, 3);
  });

  it("core projection alone copies source without reducer", () => {
    const db = makeDb();
    seedABCD(db);
    const fields = listCanonicalEligibleNumericFields(widget()).filter(
      (f) => f.stateKey === "affection"
    );
    const projected = projectNumericStateToSelectedVariantCore(db, {
      chatId: 1,
      characterId: 7,
      assistantMessageId: 4,
      selectedGenerationSequence: 1,
      selectedRequestId: "req-b",
      sourceTurn: 2,
      fields,
    });
    assert.equal(projected.afterByStateKey.affection, 38);
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 38);
  });
});

// ─── B1-D2 FINAL HARDENING ───────────────────────────────────────────

function ensureMemoryTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY,
      current_summary TEXT NOT NULL DEFAULT '',
      memory TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS chat_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      pinned_facts TEXT NOT NULL DEFAULT '',
      recent_summary TEXT NOT NULL DEFAULT '',
      archive_summary TEXT NOT NULL DEFAULT '',
      membership_tier TEXT NOT NULL DEFAULT 'free',
      used_chars INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      summarized_turn_count INTEGER NOT NULL DEFAULT 0,
      last_compressed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_turn_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      turn_number INTEGER NOT NULL,
      assistant_message_id INTEGER,
      summary TEXT NOT NULL DEFAULT '',
      summary_kind TEXT NOT NULL DEFAULT 'narrative',
      scope_payload TEXT,
      branch_id TEXT,
      branch_status TEXT,
      promoted_by TEXT,
      promoted_at TEXT,
      inactive INTEGER NOT NULL DEFAULT 0,
      user_edited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(chat_id, turn_number)
    );
  `);
}

function seedTwelveTurnChatWithSummaries(db: Database.Database): {
  variants: MessageVariant[];
  assistantMessageId: number;
} {
  ensureMemoryTables(db);
  db.prepare(`INSERT OR REPLACE INTO chats (id, current_summary, memory) VALUES (1, '', '')`).run();

  // 12 playable assistant turns; latest (turn 12) holds A/B/C/D with D active.
  for (let t = 1; t <= 11; t++) {
    insertMsg(db, t * 2 - 1, 1, "user", `u${t}`);
    insertMsg(db, t * 2, 1, "assistant", `a${t}-prose`);
  }
  bootstrapNumericStateCurrentCore(db, {
    chatId: 1,
    characterId: 7,
    stateKey: "affection",
    definition: def,
    baselineValue: 30,
    mutationId: "bootstrap:1:affection:definition_initial",
    sourceKind: "definition_initial",
  });
  insertMsg(db, 23, 1, "user", "u12");
  const variants = makeVariants([
    {
      content: "A prose",
      affection: 35,
      seq: 0,
      requestId: "req-a",
    },
    {
      content: "B prose",
      affection: 38,
      seq: 1,
      requestId: "req-b",
    },
    {
      content: "C prose",
      affection: 32,
      seq: 2,
      requestId: "req-c",
    },
    {
      content: "D REJECTED WORLDLINE SUMMARY CONTAMINATION",
      affection: 41,
      seq: 3,
      requestId: "req-d",
    },
  ]);
  const assistantMessageId = 24;
  insertMsg(db, assistantMessageId, 1, "assistant", variants[3]!.content, {
    statusJson: JSON.stringify(variants[3]!.statusWidgetValues),
    alternates: JSON.stringify(variants),
    activeVariant: 3,
  });
  for (const [seq, proposal, req] of [
    [0, 35, "req-a"],
    [1, 38, "req-b"],
    [2, 32, "req-c"],
    [3, 41, "req-d"],
  ] as const) {
    commitGen(db, {
      chatId: 1,
      stateKey: "affection",
      proposal,
      assistantMessageId,
      generationSequence: seq,
      requestId: req,
      sourceTurn: 12,
    });
  }

  const summaryA =
    "VALID BATCH T1-T6 summary — prior worldline without D contamination.";
  const summaryB =
    "CONTAMINATED BATCH T7-T12 includes D REJECTED WORLDLINE SUMMARY CONTAMINATION.";
  db.prepare(
    `INSERT INTO chat_turn_summaries
     (chat_id, turn_number, assistant_message_id, summary, summary_kind, inactive, user_edited)
     VALUES (1, 1, 12, ?, 'narrative', 0, 0)`
  ).run(summaryA);
  db.prepare(
    `INSERT INTO chat_turn_summaries
     (chat_id, turn_number, assistant_message_id, summary, summary_kind, inactive, user_edited)
     VALUES (1, 7, ?, ?, 'narrative', 0, 0)`
  ).run(assistantMessageId, summaryB);
  db.prepare(
    `INSERT INTO chat_memories
     (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary,
      membership_tier, used_chars, summarized_turn_count)
     VALUES (1, 1, 7, '', ?, '', 'free', ?, 12)`
  ).run(`${summaryA}\n\n${summaryB}`, summaryA.length + summaryB.length + 2);
  db.prepare(`UPDATE chats SET current_summary=?, memory=? WHERE id=1`).run(
    `${summaryA}\n\n${summaryB}`,
    `${summaryA}\n\n${summaryB}`
  );

  return { variants, assistantMessageId };
}

describe("Phase B1-D2 FINAL HARDENING", () => {
  it("M1/M2/M5: LTM suppresses rejected D; prior batch preserved; LLM=0", () => {
    const db = makeDb();
    const { assistantMessageId } = seedTwelveTurnChatWithSummaries(db);

    const result = executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: assistantMessageId,
      variantIndex: 1,
      characterWidget: widget(),
      memory: { enabled: true, tier: "free", memoryCapacity: 8000 },
    });
    assert.equal(result.kind, "APPLIED");
    assert.equal(result.memoryReconciled, true);

    const batches = db
      .prepare(
        `SELECT turn_number AS t, inactive AS i, summary AS s FROM chat_turn_summaries
         WHERE chat_id=1 ORDER BY turn_number`
      )
      .all() as Array<{ t: number; i: number; s: string }>;
    assert.equal(batches[0]!.i, 0);
    assert.equal(batches[1]!.i, 1);
    assert.match(batches[0]!.s, /VALID BATCH/);
    assert.match(batches[1]!.s, /CONTAMINATED/);

    const mem = db
      .prepare(
        `SELECT recent_summary AS r, summarized_turn_count AS c FROM chat_memories WHERE chat_id=1`
      )
      .get() as { r: string; c: number };
    assert.equal(mem.c, 6);
    assert.doesNotMatch(mem.r, /REJECTED WORLDLINE/);
    assert.match(mem.r, /VALID BATCH/);

    const chat = db
      .prepare(`SELECT current_summary AS c, memory AS m FROM chats WHERE id=1`)
      .get() as { c: string; m: string };
    assert.doesNotMatch(chat.c, /REJECTED WORLDLINE/);
    assert.doesNotMatch(chat.m, /REJECTED WORLDLINE/);
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 38);
  });

  it("M3: forced LTM failure rolls back full worldline", () => {
    for (const flag of [
      "__testThrowAfterLtmInvalidate",
      "__testThrowAfterLtmRebuild",
    ] as const) {
      const db = makeDb();
      const { assistantMessageId } = seedTwelveTurnChatWithSummaries(db);
      assert.throws(() =>
        executeAtomicNumericVariantSwitch(db, {
          chatId: 1,
          characterId: 7,
          userId: 1,
          messageId: assistantMessageId,
          variantIndex: 1,
          characterWidget: widget(),
          memory: { enabled: true, tier: "free", memoryCapacity: 8000 },
          [flag]: true,
        })
      );
      assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 41);
      const msg = db
        .prepare(
          `SELECT active_variant AS a, content AS c FROM messages WHERE id=?`
        )
        .get(assistantMessageId) as { a: number; c: string };
      assert.equal(msg.a, 3);
      assert.match(msg.c, /REJECTED WORLDLINE/);
      const batches = db
        .prepare(
          `SELECT inactive AS i FROM chat_turn_summaries WHERE chat_id=1 ORDER BY turn_number`
        )
        .all() as Array<{ i: number }>;
      assert.deepEqual(
        batches.map((b) => b.i),
        [0, 0]
      );
      const mem = db
        .prepare(`SELECT summarized_turn_count AS c FROM chat_memories WHERE chat_id=1`)
        .get() as { c: number };
      assert.equal(mem.c, 12);
    }
  });

  it("M4: memory disabled leaves LTM untouched", () => {
    const db = makeDb();
    const { assistantMessageId } = seedTwelveTurnChatWithSummaries(db);
    executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: assistantMessageId,
      variantIndex: 1,
      characterWidget: widget(),
      memory: { enabled: false, tier: "free", memoryCapacity: 8000 },
    });
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 38);
    const batches = db
      .prepare(
        `SELECT inactive AS i FROM chat_turn_summaries WHERE chat_id=1 ORDER BY turn_number`
      )
      .all() as Array<{ i: number }>;
    assert.deepEqual(
      batches.map((b) => b.i),
      [0, 0]
    );
    const mem = db
      .prepare(`SELECT summarized_turn_count AS c FROM chat_memories WHERE chat_id=1`)
      .get() as { c: number };
    assert.equal(mem.c, 12);
  });

  it("LTM re-summary eligibility after rewind (API=0)", () => {
    const db = makeDb();
    const { assistantMessageId } = seedTwelveTurnChatWithSummaries(db);
    executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: assistantMessageId,
      variantIndex: 1,
      characterWidget: widget(),
      memory: { enabled: true, tier: "free", memoryCapacity: 8000 },
    });
    const summarized = (
      db
        .prepare(`SELECT summarized_turn_count AS c FROM chat_memories WHERE chat_id=1`)
        .get() as { c: number }
    ).c;
    assert.equal(summarized, 6);
    const playable = 12;
    const expected = expectedBatchStartsThrough(playable);
    assert.deepEqual(expected, [1, 7]);
    const activeStarts = (
      db
        .prepare(
          `SELECT turn_number AS t FROM chat_turn_summaries
           WHERE chat_id=1 AND inactive=0 ORDER BY turn_number`
        )
        .all() as Array<{ t: number }>
    ).map((r) => r.t);
    assert.deepEqual(activeStarts, [1]);
    assert.equal(summarized + 1, 7);

    // Core eligibility: with 12 playable turns and summarized=6, next batch is T7~T12.
    const turns: DialogueTurn[] = Array.from({ length: playable }, (_, i) => ({
      user: `u${i + 1}`,
      assistant: `a${i + 1}`,
    }));
    const nextBatch = pickNextSummaryBatch(turns, summarized);
    assert.equal(nextBatch.length, ROLLING_SUMMARY_INTERVAL);
    assert.equal(nextBatch[0]!.assistant, "a7");
    assert.equal(nextBatch[5]!.assistant, "a12");
  });

  it("R1: stale preload / concurrent regen E preserved on B select", () => {
    const db = makeDb();
    const variants = seedABCD(db);
    // Concurrent regen appends E and makes it active/canonical after a stale A/B/C/D view.
    const eVariant: MessageVariant = {
      content: "E prose",
      model: "test",
      usage: null,
      created_at: new Date().toISOString(),
      statusWidgetValues: {
        character: { 호감도: "36", location: "정원" },
        user: null,
      },
      statusWidgetTurnActive: true,
      generationSequence: 4,
      requestId: "req-e",
    };
    const withE = [...variants, eVariant];
    db.prepare(
      `UPDATE messages SET content=?, alternates=?, active_variant=?, status_widget_values_json=? WHERE id=4`
    ).run(
      eVariant.content,
      JSON.stringify(withE),
      4,
      JSON.stringify(eVariant.statusWidgetValues)
    );
    commitGen(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: 36,
      assistantMessageId: 4,
      generationSequence: 4,
      requestId: "req-e",
      sourceTurn: 2,
    });
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 36);

    // Call site still conceptually holds stale A/B/C/D preload — ignored.
    const result = executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 4,
      variantIndex: 1,
      variants, // stale preload intentionally passed
      content: "B prose",
      characterWidget: widget(),
    });
    assert.equal(result.kind, "APPLIED");
    assert.equal(result.canonicalVariants.length, 5);
    assert.equal(result.activeVariant, 1);
    assert.equal(result.canonicalVariants[4]!.content, "E prose");
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 38);

    const stored = JSON.parse(
      (
        db.prepare(`SELECT alternates AS a FROM messages WHERE id=4`).get() as {
          a: string;
        }
      ).a
    ) as MessageVariant[];
    assert.equal(stored.length, 5);
    assert.equal(stored[4]!.requestId, "req-e");

    const eGen = resolveSelectedVariantGenerationEvent(db, {
      chatId: 1,
      stateKey: "affection",
      assistantMessageId: 4,
      generationSequence: 4,
      requestId: "req-e",
    });
    assert.equal(eGen.afterValue, 36);
    assert.equal(eGen.sourceKind, "extractor");
  });

  it("R2: select B then regen E keeps pre-turn baseline 30", () => {
    const db = makeDb();
    seedABCD(db);
    executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 4,
      variantIndex: 1,
      characterWidget: widget(),
    });
    const e = commitNumericStateReplacementCore(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      proposal: 36,
      mutationId: "gen:4:4:req-e-r2",
      sourceKind: "extractor",
      assistantMessageId: 4,
      generationSequence: 4,
      requestId: "req-e-r2",
      sourceTurn: 2,
    });
    assert.equal(e.event?.beforeValue, 30);
    assert.equal(e.current.numericValue, 36);
  });

  it("HTTP/DB canonical: raw snapshot 80 mirrors to 38", () => {
    const db = makeDb();
    const variants = seedABCD(db);
    // Poison B's raw status snapshot to 80 while numeric event remains 38.
    variants[1] = {
      ...variants[1]!,
      statusWidgetValues: {
        character: {
          ...(variants[1]!.statusWidgetValues?.character ?? {}),
          호감도: "80",
        },
        user: null,
        extracted_facts: variants[1]!.statusWidgetValues?.extracted_facts,
      },
    };
    db.prepare(`UPDATE messages SET alternates=? WHERE id=4`).run(JSON.stringify(variants));

    const result = executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 4,
      variantIndex: 1,
      characterWidget: widget(),
    });
    assert.equal(result.kind, "APPLIED");
    assert.equal(result.canonicalStatusForTriggers?.character?.호감도, "38");
    assert.equal(
      result.canonicalVariants[1]!.statusWidgetValues?.character?.호감도,
      "38"
    );
    assert.notEqual(
      result.canonicalVariants[1]!.statusWidgetValues?.character?.호감도,
      "80"
    );

    const msg = db
      .prepare(`SELECT status_widget_values_json AS v FROM messages WHERE id=4`)
      .get() as { v: string };
    assert.equal(parseStoredStatusWidgetValuesJson(msg.v)?.character?.호감도, "38");
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 38);
  });

  it("concurrent B/C: last serialized selection wins; no half-state", () => {
    const db = makeDb();
    seedABCD(db);
    // Deterministic serialized equivalent of concurrent B then C.
    executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 4,
      variantIndex: 1,
      characterWidget: widget(),
    });
    executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 4,
      variantIndex: 2,
      characterWidget: widget(),
    });
    const msg = db
      .prepare(
        `SELECT active_variant AS a, content AS c, status_widget_values_json AS v, alternates AS al
         FROM messages WHERE id=4`
      )
      .get() as { a: number; c: string; v: string; al: string };
    assert.equal(msg.a, 2);
    assert.equal(msg.c, "C prose");
    assert.equal(parseStoredStatusWidgetValuesJson(msg.v)?.character?.호감도, "32");
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 32);
    assert.equal((JSON.parse(msg.al) as MessageVariant[]).length, 4);
    const tip = getNumericStateEventById(
      db,
      getNumericStateCurrent(db, 1, "affection")!.lastEventId!
    )!;
    assert.equal(tip.sourceKind, "variant_switch");
    assert.equal(tip.afterValue, 32);
  });

  it("selection provenance preserves source definition hash H1 after def→H2", () => {
    const db = makeDb();
    seedABCD(db);
    const sourceB = resolveSelectedVariantGenerationEvent(db, {
      chatId: 1,
      stateKey: "affection",
      assistantMessageId: 4,
      generationSequence: 1,
      requestId: "req-b",
    });
    const h1 = sourceB.definitionHash;
    assert.ok(h1);

    // Mutate character numeric definition → H2 (different maxIncreasePerTurn).
    const mutated = {
      ...PILOT_WIDGET,
      fields: PILOT_WIDGET.fields.map((f) =>
        f.id === "affection"
          ? {
              ...f,
              numericState: { ...def, maxIncreasePerTurn: 49 },
            }
          : f
      ),
    };
    db.prepare(`UPDATE characters SET status_widget_json=? WHERE id=7`).run(
      serializeStatusWidget(mutated)
    );
    const h2 = fingerprintNumericStateDefinition({
      ...def,
      maxIncreasePerTurn: 49,
    });
    assert.notEqual(h1, h2);

    const result = executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 4,
      variantIndex: 1,
      characterWidget: parseStatusWidgetJson(serializeStatusWidget(mutated)),
    });
    assert.equal(result.kind, "APPLIED");
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 38);
    const tip = getNumericStateEventById(
      db,
      getNumericStateCurrent(db, 1, "affection")!.lastEventId!
    )!;
    assert.equal(tip.sourceKind, "variant_switch");
    assert.equal(tip.definitionHash, h1);
    assert.equal(tip.policyVersion, sourceB.policyVersion);
    assert.notEqual(tip.definitionHash, h2);
  });

  it("nonnumeric clock snapshot: C 10:30 → B 10:15 restore; no turn clock advance", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      baselineValue: 30,
      mutationId: "bootstrap:1:affection:definition_initial",
      sourceKind: "definition_initial",
    });
    insertMsg(db, 1, 1, "user", "u");
    const variants = makeVariants([
      {
        content: "A prose",
        affection: 35,
        time: "10:00",
        seq: 0,
        requestId: "req-a",
      },
      {
        content: "B prose",
        affection: 38,
        time: "10:15",
        seq: 1,
        requestId: "req-b",
      },
      {
        content: "C prose",
        affection: 32,
        time: "10:30",
        seq: 2,
        requestId: "req-c",
      },
    ]);
    insertMsg(db, 2, 1, "assistant", "C prose", {
      statusJson: JSON.stringify(variants[2]!.statusWidgetValues),
      alternates: JSON.stringify(variants),
      activeVariant: 2,
    });
    for (const [seq, proposal, req] of [
      [0, 35, "req-a"],
      [1, 38, "req-b"],
      [2, 32, "req-c"],
    ] as const) {
      commitGen(db, {
        chatId: 1,
        stateKey: "affection",
        proposal,
        assistantMessageId: 2,
        generationSequence: seq,
        requestId: req,
        sourceTurn: 1,
      });
    }
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 32);

    const result = executeAtomicNumericVariantSwitch(db, {
      chatId: 1,
      characterId: 7,
      userId: 1,
      messageId: 2,
      variantIndex: 1,
      characterWidget: widget(),
    });
    assert.equal(result.kind, "APPLIED");

    // Numeric follows B canonical event; clock restores B snapshot (not advanced).
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 38);
    assert.equal(
      result.canonicalStatusForTriggers?.character?.호감도,
      "38"
    );
    assert.equal(result.canonicalStatusForTriggers?.character?.시간, "10:15");
    assert.notEqual(result.canonicalStatusForTriggers?.character?.시간, "10:16");
    assert.notEqual(result.canonicalStatusForTriggers?.character?.시간, "10:30");

    const msg = db
      .prepare(
        `SELECT active_variant AS a, status_widget_values_json AS v, alternates AS al
         FROM messages WHERE id=2`
      )
      .get() as { a: number; v: string; al: string };
    assert.equal(msg.a, 1);
    const status = parseStoredStatusWidgetValuesJson(msg.v)!;
    assert.equal(status.character?.시간, "10:15");
    assert.equal(status.character?.호감도, "38");

    const stored = JSON.parse(msg.al) as MessageVariant[];
    assert.equal(stored[1]!.statusWidgetValues?.character?.시간, "10:15");
    assert.equal(stored[2]!.statusWidgetValues?.character?.시간, "10:30");
  });
});
