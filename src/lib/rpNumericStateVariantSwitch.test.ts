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
import type { MessageVariant } from "@/lib/messageAlternates";

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
      updated_at TEXT
    );
    CREATE TABLE bookmarks (message_id INTEGER PRIMARY KEY);
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
    variants[1] = { ...variants[1]!, generationSequence: undefined };
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
