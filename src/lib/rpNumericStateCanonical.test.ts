/**
 * Phase B1-C — Canonical numeric authority integration tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { ServerMeterNumericStateDefinitionV1, StatusWidget } from "@/lib/statusWidget/types";
import {
  ensureStatusWidgetTriggerTables,
  insertStatusWidgetTriggerForTest,
  evaluateStatusWidgetTriggers,
} from "@/lib/statusWidgetTriggers";
import { parseStoredStatusWidgetValuesJson } from "@/lib/statusWidget/parseValues";
import {
  RP_NUMERIC_STATE_ALLOWLIST_CHARACTERS_ENV,
  RP_NUMERIC_STATE_ALLOWLIST_USERS_ENV,
  RP_NUMERIC_STATE_ENABLED_ENV,
  RP_NUMERIC_STATE_KILL_SWITCH_ENV,
  bootstrapNumericStateCurrentCore,
  commitNumericStateProposalCore,
  commitNumericStateReplacementCore,
  deleteNumericStateForChat,
  ensureRpNumericStateTables,
  executeAtomicNumericAssistantFinalize,
  getNumericStateCurrent,
  getNumericStateEventById,
  listCanonicalEligibleNumericFields,
  resolveNumericCanonicalEligibility,
} from "@/lib/rpNumericState";

const def: ServerMeterNumericStateDefinitionV1 = {
  version: 1,
  mode: "server_meter",
  min: 0,
  max: 100,
  initial: 20,
  integer: true,
  maxIncreasePerTurn: 5,
  maxDecreasePerTurn: 5,
};

function meterWidget(keys: string[] = ["affection", "trust", "corruption"]): StatusWidget {
  return {
    version: 1,
    name: "pilot",
    htmlTemplate: keys.map((k) => `{{${k}}}`).join(" "),
    placement: "bottom",
    fields: keys.map((id) => ({
      id,
      label: id,
      instruction: id,
      numericState: { ...def, initial: id === "affection" ? 40 : 20 },
    })),
  };
}

function makeDb(): Database.Database {
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
      status_widget_values_json TEXT DEFAULT '',
      status_widget_turn_active INTEGER DEFAULT 0,
      generation_status TEXT DEFAULT 'generating',
      status TEXT DEFAULT 'ok',
      is_refunded INTEGER DEFAULT 0,
      status_meta TEXT,
      deduction_slices TEXT,
      updated_at TEXT
    );
  `);
  ensureRpNumericStateTables(db);
  ensureStatusWidgetTriggerTables(db);
  return db;
}

function insertGeneratingAssistant(
  db: Database.Database,
  id: number,
  chatId = 1
): void {
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, model, generation_status, alternates, active_variant)
     VALUES (?, ?, 'assistant', '', 'test', 'generating', '[]', 0)`
  ).run(id, chatId);
}

function countEvents(db: Database.Database, chatId = 1, stateKey = "affection"): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM rp_numeric_state_events WHERE chat_id=? AND state_key=?`
      )
      .get(chatId, stateKey) as { c: number }
  ).c;
}

function messageStatus(db: Database.Database, messageId: number): string {
  return (
    db
      .prepare(`SELECT status_widget_values_json AS v FROM messages WHERE id=?`)
      .get(messageId) as { v: string }
  ).v;
}

function activeVariantStatus(
  db: Database.Database,
  messageId: number
): Record<string, string> | null | undefined {
  const row = db
    .prepare(`SELECT alternates, active_variant FROM messages WHERE id=?`)
    .get(messageId) as { alternates: string; active_variant: number };
  const variants = JSON.parse(row.alternates || "[]") as Array<{
    statusWidgetValues?: { character?: Record<string, string> };
  }>;
  return variants[row.active_variant]?.statusWidgetValues?.character;
}

describe("Phase B1-C — flags (F1-F6)", () => {
  it("F1 ENABLED=0 → not eligible", () => {
    const r = resolveNumericCanonicalEligibility({
      userId: 1,
      characterId: 2,
      env: { [RP_NUMERIC_STATE_ENABLED_ENV]: "0" },
    });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "flag_off");
  });

  it("F2 ENABLED=1 + empty allowlist → OFF", () => {
    const r = resolveNumericCanonicalEligibility({
      userId: 1,
      env: {
        [RP_NUMERIC_STATE_ENABLED_ENV]: "1",
        [RP_NUMERIC_STATE_ALLOWLIST_USERS_ENV]: "",
      },
    });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "empty_user_allowlist");
  });

  it("F3 allowlisted admin + character → ON", () => {
    const r = resolveNumericCanonicalEligibility({
      userId: 5,
      characterId: 19,
      env: {
        [RP_NUMERIC_STATE_ENABLED_ENV]: "1",
        [RP_NUMERIC_STATE_ALLOWLIST_USERS_ENV]: "5",
        [RP_NUMERIC_STATE_ALLOWLIST_CHARACTERS_ENV]: "19",
      },
    });
    assert.equal(r.eligible, true);
  });

  it("F4 user not allowlisted → OFF", () => {
    const r = resolveNumericCanonicalEligibility({
      userId: 9,
      env: {
        [RP_NUMERIC_STATE_ENABLED_ENV]: "1",
        [RP_NUMERIC_STATE_ALLOWLIST_USERS_ENV]: "5",
      },
    });
    assert.equal(r.reason, "user_not_allowlisted");
  });

  it("F5 KILL_SWITCH=1 → OFF", () => {
    const r = resolveNumericCanonicalEligibility({
      userId: 5,
      env: {
        [RP_NUMERIC_STATE_ENABLED_ENV]: "1",
        [RP_NUMERIC_STATE_ALLOWLIST_USERS_ENV]: "5",
        [RP_NUMERIC_STATE_KILL_SWITCH_ENV]: "1",
      },
    });
    assert.equal(r.reason, "kill_switch");
  });

  it("F6 field without numericState → not listed", () => {
    const widget: StatusWidget = {
      version: 1,
      name: "x",
      htmlTemplate: "{{affection}}",
      placement: "bottom",
      fields: [{ id: "affection", label: "affection", instruction: "x" }],
    };
    assert.equal(listCanonicalEligibleNumericFields(widget).length, 0);
  });
});

describe("Phase B1-C — replacement core (R1-R4)", () => {
  it("R1 basic replacement uses A.before, keeps A", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      baselineValue: 35,
      mutationId: "bootstrap:1",
      sourceKind: "definition_initial",
    });
    const a = commitNumericStateProposalCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 38,
      mutationId: "gen:50:0:r1",
      sourceKind: "extractor",
      assistantMessageId: 50,
      generationSequence: 0,
      requestId: "r1",
    });
    assert.equal(a.current.numericValue, 38);
    const b = commitNumericStateReplacementCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 36,
      mutationId: "gen:50:1:r2",
      sourceKind: "extractor",
      assistantMessageId: 50,
      generationSequence: 1,
      requestId: "r2",
    });
    assert.equal(b.event?.beforeValue, 35);
    assert.equal(b.event?.afterValue, 36);
    assert.equal(b.event?.replacesEventId, a.event?.id);
    assert.equal(b.current.numericValue, 36);
    assert.ok(getNumericStateEventById(db, a.event!.id));
    assert.equal(countEvents(db), 3); // INIT + A + B
  });

  it("R2 repeated regen always baselines pre-turn", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      baselineValue: 35,
      mutationId: "bootstrap:1",
      sourceKind: "definition_initial",
    });
    const a = commitNumericStateProposalCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 38,
      mutationId: "gen:50:0:r1",
      sourceKind: "extractor",
      assistantMessageId: 50,
    });
    const b = commitNumericStateReplacementCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 36,
      mutationId: "gen:50:1:r2",
      sourceKind: "extractor",
      assistantMessageId: 50,
    });
    const c = commitNumericStateReplacementCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 40,
      mutationId: "gen:50:2:r3",
      sourceKind: "extractor",
      assistantMessageId: 50,
    });
    assert.equal(c.event?.beforeValue, 35);
    assert.equal(c.event?.afterValue, 40);
    assert.equal(c.event?.replacesEventId, b.event?.id);
    assert.notEqual(c.event?.replacesEventId, a.event?.id);
  });

  it("R3 clamp under regen uses pre-turn baseline", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      baselineValue: 35,
      mutationId: "bootstrap:1",
      sourceKind: "definition_initial",
    });
    commitNumericStateProposalCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 38,
      mutationId: "gen:50:0:r1",
      sourceKind: "extractor",
      assistantMessageId: 50,
    });
    const b = commitNumericStateReplacementCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 80,
      mutationId: "gen:50:1:r2",
      sourceKind: "extractor",
      assistantMessageId: 50,
    });
    assert.equal(b.event?.beforeValue, 35);
    assert.equal(b.event?.afterValue, 40);
    assert.ok(b.event?.adjustments.includes("DELTA_LIMITED_UP"));
  });

  it("R4 idempotent regen replay", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      baselineValue: 35,
      mutationId: "bootstrap:1",
      sourceKind: "definition_initial",
    });
    commitNumericStateProposalCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 38,
      mutationId: "gen:50:0:r1",
      sourceKind: "extractor",
      assistantMessageId: 50,
    });
    const b1 = commitNumericStateReplacementCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 36,
      mutationId: "gen:50:1:r2",
      sourceKind: "extractor",
      assistantMessageId: 50,
      requestId: "r2",
      generationSequence: 1,
    });
    const beforeCount = countEvents(db);
    const b2 = commitNumericStateReplacementCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 99,
      mutationId: "gen:50:1:r2",
      sourceKind: "extractor",
      assistantMessageId: 50,
      requestId: "r2",
      generationSequence: 1,
    });
    assert.equal(b2.kind, "IDEMPOTENT_NOOP");
    assert.equal(b2.current.revision, b1.current.revision);
    assert.equal(countEvents(db), beforeCount);
  });
});

describe("Phase B1-C — atomic finalize (NC1-NC47)", () => {
  it("NC1 normal canonical parity", () => {
    const db = makeDb();
    insertGeneratingAssistant(db, 50);
    const widget = meterWidget(["affection"]);
    const result = executeAtomicNumericAssistantFinalize(db, {
      assistantMessageId: 50,
      chatId: 1,
      characterId: 7,
      content: "본문",
      model: "test",
      usageJson: "{}",
      variants: [
        {
          content: "본문",
          model: "test",
          usage: null,
          created_at: "",
          statusWidgetValues: { character: { affection: "43" } },
        },
      ],
      activeVariant: 0,
      statusWidgetValues: { character: { affection: "43" } },
      characterWidget: widget,
      previousCanonicalStatus: { character: { affection: "40" } },
      generationSequence: 0,
      isRegeneration: false,
      requestId: "r1",
      sourceTurn: 1,
    });
    assert.equal(result.wrote, true);
    assert.equal(getNumericStateCurrent(db, 1, "affection")?.numericValue, 43);
    const stored = parseStoredStatusWidgetValuesJson(messageStatus(db, 50));
    assert.equal(stored.character?.affection, "43");
    assert.equal(activeVariantStatus(db, 50)?.affection, "43");
    const events = db
      .prepare(
        `SELECT outcome, before_value, after_value FROM rp_numeric_state_events
         WHERE chat_id=1 AND state_key='affection' AND outcome!='INITIALIZED'`
      )
      .all() as Array<{ outcome: string; before_value: number; after_value: number }>;
    assert.equal(events.length, 1);
    assert.equal(events[0].before_value, 40);
    assert.equal(events[0].after_value, 43);
  });

  it("NC2 clamp + trigger authority (raw 80 → after 45, threshold 50 no fire)", () => {
    const db = makeDb();
    insertGeneratingAssistant(db, 50);
    insertStatusWidgetTriggerForTest(db, {
      character_id: 7,
      trigger_id: "aff_50",
      status_key: "affection",
      operator: ">=",
      value: 50,
      fire_once: true,
      event_key: "aff_ge_50",
      effect_text: "fired",
      visibility: "engine_only",
      character_knowledge: "unknown",
      is_enabled: true,
    });
    const widget = meterWidget(["affection"]);
    const result = executeAtomicNumericAssistantFinalize(db, {
      assistantMessageId: 50,
      chatId: 1,
      characterId: 7,
      content: "본문",
      model: "test",
      usageJson: "{}",
      variants: [
        {
          content: "본문",
          model: "test",
          usage: null,
          created_at: "",
          statusWidgetValues: { character: { affection: "80" } },
        },
      ],
      activeVariant: 0,
      statusWidgetValues: { character: { affection: "80" } },
      characterWidget: widget,
      previousCanonicalStatus: { character: { affection: "40" } },
      generationSequence: 0,
      isRegeneration: false,
      requestId: "r1",
      sourceTurn: 1,
    });
    assert.equal(result.statusWidgetValues?.character?.affection, "45");
    assert.equal(getNumericStateCurrent(db, 1, "affection")?.numericValue, 45);
    const ev = result.fieldCommits[0]?.result.event;
    assert.equal(ev?.proposedValue, 80);
    assert.equal(ev?.proposedDelta, 40);
    assert.equal(ev?.appliedDelta, 5);
    assert.ok(ev?.adjustments.includes("DELTA_LIMITED_UP"));

    const fired = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      characterId: 7,
      sourceTurn: 1,
      statusValues: result.statusWidgetValues!,
      sourceMessageId: 50,
      requestId: "r1",
      generationSequence: 0,
    });
    assert.equal(fired.firedEvents.length, 0, "must not fire on raw 80");
  });

  it("NC2b trigger fires at canonical 45 when threshold=45", () => {
    const db = makeDb();
    insertGeneratingAssistant(db, 50);
    insertStatusWidgetTriggerForTest(db, {
      character_id: 7,
      trigger_id: "aff_45",
      status_key: "affection",
      operator: ">=",
      value: 45,
      fire_once: true,
      event_key: "aff_ge_45",
      effect_text: "fired",
      visibility: "engine_only",
      character_knowledge: "unknown",
      is_enabled: true,
    });
    const result = executeAtomicNumericAssistantFinalize(db, {
      assistantMessageId: 50,
      chatId: 1,
      characterId: 7,
      content: "본문",
      model: "test",
      usageJson: "{}",
      variants: [
        {
          content: "본문",
          model: "test",
          usage: null,
          created_at: "",
          statusWidgetValues: { character: { affection: "80" } },
        },
      ],
      activeVariant: 0,
      statusWidgetValues: { character: { affection: "80" } },
      characterWidget: meterWidget(["affection"]),
      previousCanonicalStatus: { character: { affection: "40" } },
      generationSequence: 0,
      isRegeneration: false,
      requestId: "r1",
      sourceTurn: 1,
    });
    const fired = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      characterId: 7,
      sourceTurn: 1,
      statusValues: result.statusWidgetValues!,
      sourceMessageId: 50,
      requestId: "r1",
      generationSequence: 0,
    });
    assert.equal(fired.firedEvents.length, 1);
  });

  it("NC3 INVALID_HOLD mirrors before value", () => {
    const db = makeDb();
    insertGeneratingAssistant(db, 50);
    const result = executeAtomicNumericAssistantFinalize(db, {
      assistantMessageId: 50,
      chatId: 1,
      characterId: 7,
      content: "본문",
      model: "test",
      usageJson: "{}",
      variants: [
        {
          content: "본문",
          model: "test",
          usage: null,
          created_at: "",
          statusWidgetValues: { character: { affection: "약 44" } },
        },
      ],
      activeVariant: 0,
      statusWidgetValues: { character: { affection: "약 44" } },
      characterWidget: meterWidget(["affection"]),
      previousCanonicalStatus: { character: { affection: "40" } },
      generationSequence: 0,
      isRegeneration: false,
      requestId: "r1",
      sourceTurn: 1,
    });
    assert.equal(result.statusWidgetValues?.character?.affection, "40");
    assert.equal(getNumericStateCurrent(db, 1, "affection")?.numericValue, 40);
    assert.equal(result.fieldCommits[0]?.result.kind, "INVALID_HOLD");
  });

  it("NC4/5 bootstrap legacy + definition initial in same transaction", () => {
    const db = makeDb();
    insertGeneratingAssistant(db, 50);
    const result = executeAtomicNumericAssistantFinalize(db, {
      assistantMessageId: 50,
      chatId: 1,
      characterId: 7,
      content: "본문",
      model: "test",
      usageJson: "{}",
      variants: [
        {
          content: "본문",
          model: "test",
          usage: null,
          created_at: "",
          statusWidgetValues: { character: { affection: "40", trust: "23" } },
        },
      ],
      activeVariant: 0,
      statusWidgetValues: { character: { affection: "40", trust: "23" } },
      characterWidget: meterWidget(["affection", "trust"]),
      previousCanonicalStatus: { character: { affection: "37" } },
      generationSequence: 0,
      isRegeneration: false,
      requestId: "r1",
      sourceTurn: 1,
    });
    assert.equal(getNumericStateCurrent(db, 1, "affection")?.numericValue, 40);
    assert.equal(getNumericStateCurrent(db, 1, "trust")?.numericValue, 23);
    const affInit = db
      .prepare(
        `SELECT after_value, source_kind FROM rp_numeric_state_events
         WHERE chat_id=1 AND state_key='affection' AND outcome='INITIALIZED'`
      )
      .get() as { after_value: number; source_kind: string };
    assert.equal(affInit.after_value, 37);
    assert.equal(affInit.source_kind, "legacy_bootstrap");
    const trustInit = db
      .prepare(
        `SELECT after_value, source_kind FROM rp_numeric_state_events
         WHERE chat_id=1 AND state_key='trust' AND outcome='INITIALIZED'`
      )
      .get() as { after_value: number; source_kind: string };
    assert.equal(trustInit.after_value, 20);
    assert.equal(trustInit.source_kind, "definition_initial");
    assert.equal(result.statusWidgetValues?.character?.affection, "40");
    assert.equal(result.statusWidgetValues?.character?.trust, "23");
  });

  it("NC6 multi-field single transaction forced field2 failure rolls back all", () => {
    const db = makeDb();
    insertGeneratingAssistant(db, 50);
    // Fail only the second non-INITIALIZED event insert (trust mutation).
    db.exec(`
      CREATE TRIGGER fail_second_mutation BEFORE INSERT ON rp_numeric_state_events
      WHEN NEW.outcome != 'INITIALIZED' AND NEW.state_key = 'trust'
      BEGIN
        SELECT RAISE(ABORT, 'forced field2 failure');
      END;
    `);
    assert.throws(
      () =>
        executeAtomicNumericAssistantFinalize(db, {
          assistantMessageId: 50,
          chatId: 1,
          characterId: 7,
          content: "본문",
          model: "test",
          usageJson: "{}",
          variants: [
            {
              content: "본문",
              model: "test",
              usage: null,
              created_at: "",
              statusWidgetValues: {
                character: { affection: "43", trust: "24", corruption: "22" },
              },
            },
          ],
          activeVariant: 0,
          statusWidgetValues: {
            character: { affection: "43", trust: "24", corruption: "22" },
          },
          characterWidget: meterWidget(),
          previousCanonicalStatus: {
            character: { affection: "40", trust: "20", corruption: "20" },
          },
          generationSequence: 0,
          isRegeneration: false,
          requestId: "r1",
          sourceTurn: 1,
        }),
      /forced field2 failure/
    );
    assert.equal(getNumericStateCurrent(db, 1, "affection"), null);
    assert.equal(getNumericStateCurrent(db, 1, "trust"), null);
    assert.equal(getNumericStateCurrent(db, 1, "corruption"), null);
    const gen = db
      .prepare(`SELECT generation_status AS s FROM messages WHERE id=50`)
      .get() as { s: string };
    assert.equal(gen.s, "generating");
    assert.equal(countEvents(db, 1, "affection"), 0);
  });

  it("NC7 message finalize forced failure rolls back numeric", () => {
    const db = makeDb();
    insertGeneratingAssistant(db, 50);
    db.exec(`
      CREATE TRIGGER fail_message_update BEFORE UPDATE ON messages
      BEGIN
        SELECT RAISE(ABORT, 'forced message failure');
      END;
    `);
    assert.throws(
      () =>
        executeAtomicNumericAssistantFinalize(db, {
          assistantMessageId: 50,
          chatId: 1,
          characterId: 7,
          content: "본문",
          model: "test",
          usageJson: "{}",
          variants: [
            {
              content: "본문",
              model: "test",
              usage: null,
              created_at: "",
              statusWidgetValues: { character: { affection: "43" } },
            },
          ],
          activeVariant: 0,
          statusWidgetValues: { character: { affection: "43" } },
          characterWidget: meterWidget(["affection"]),
          previousCanonicalStatus: { character: { affection: "40" } },
          generationSequence: 0,
          isRegeneration: false,
          requestId: "r1",
          sourceTurn: 1,
        }),
      /forced message failure/
    );
    assert.equal(getNumericStateCurrent(db, 1, "affection"), null);
    assert.equal(countEvents(db), 0);
  });

  it("idempotent duplicate finalize → numeric +0", () => {
    const db = makeDb();
    insertGeneratingAssistant(db, 50);
    const input = {
      assistantMessageId: 50,
      chatId: 1,
      characterId: 7,
      content: "본문",
      model: "test",
      usageJson: "{}",
      variants: [
        {
          content: "본문",
          model: "test",
          usage: null,
          created_at: "",
          statusWidgetValues: { character: { affection: "43" } },
        },
      ],
      activeVariant: 0,
      statusWidgetValues: { character: { affection: "43" } },
      characterWidget: meterWidget(["affection"]),
      previousCanonicalStatus: { character: { affection: "40" } },
      generationSequence: 0,
      isRegeneration: false,
      requestId: "r1",
      sourceTurn: 1,
    };
    const a = executeAtomicNumericAssistantFinalize(db, input);
    assert.equal(a.wrote, true);
    const rev = getNumericStateCurrent(db, 1, "affection")!.revision;
    const events = countEvents(db);
    const b = executeAtomicNumericAssistantFinalize(db, {
      ...input,
      statusWidgetValues: { character: { affection: "99" } },
    });
    assert.equal(b.kind, "IDEMPOTENT_FINALIZE_NOOP");
    assert.equal(b.wrote, false);
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.revision, rev);
    assert.equal(countEvents(db), events);
  });

  it("atomic regen finalize mirrors replacement", () => {
    const db = makeDb();
    insertGeneratingAssistant(db, 50);
    const widget = meterWidget(["affection"]);
    executeAtomicNumericAssistantFinalize(db, {
      assistantMessageId: 50,
      chatId: 1,
      characterId: 7,
      content: "A",
      model: "test",
      usageJson: "{}",
      variants: [
        {
          content: "A",
          model: "test",
          usage: null,
          created_at: "",
          statusWidgetValues: { character: { affection: "38" } },
        },
      ],
      activeVariant: 0,
      statusWidgetValues: { character: { affection: "38" } },
      characterWidget: widget,
      previousCanonicalStatus: { character: { affection: "35" } },
      generationSequence: 0,
      isRegeneration: false,
      requestId: "r1",
      sourceTurn: 1,
    });
    // Simulate regen placeholder: set generating again (bootstrapStreamingTurn pattern).
    db.prepare(
      `UPDATE messages SET generation_status='generating', status_widget_values_json='' WHERE id=50`
    ).run();
    const aEvent = getNumericStateCurrent(db, 1, "affection")!.lastEventId!;
    const b = executeAtomicNumericAssistantFinalize(db, {
      assistantMessageId: 50,
      chatId: 1,
      characterId: 7,
      content: "B",
      model: "test",
      usageJson: "{}",
      variants: [
        {
          content: "A",
          model: "test",
          usage: null,
          created_at: "",
          statusWidgetValues: { character: { affection: "38" } },
        },
        {
          content: "B",
          model: "test",
          usage: null,
          created_at: "",
          statusWidgetValues: { character: { affection: "36" } },
        },
      ],
      activeVariant: 1,
      statusWidgetValues: { character: { affection: "36" } },
      characterWidget: widget,
      previousCanonicalStatus: { character: { affection: "35" } },
      generationSequence: 1,
      isRegeneration: true,
      requestId: "r2",
      sourceTurn: 1,
    });
    assert.equal(b.statusWidgetValues?.character?.affection, "36");
    assert.equal(getNumericStateCurrent(db, 1, "affection")?.numericValue, 36);
    const bEvent = getNumericStateEventById(
      db,
      getNumericStateCurrent(db, 1, "affection")!.lastEventId!
    )!;
    assert.equal(bEvent.beforeValue, 35);
    assert.equal(bEvent.replacesEventId, aEvent);
    assert.equal(activeVariantStatus(db, 50)?.affection, "36");
  });

  it("whole chat delete cleanup", () => {
    const db = makeDb();
    insertGeneratingAssistant(db, 50);
    executeAtomicNumericAssistantFinalize(db, {
      assistantMessageId: 50,
      chatId: 1,
      characterId: 7,
      content: "본문",
      model: "test",
      usageJson: "{}",
      variants: [
        {
          content: "본문",
          model: "test",
          usage: null,
          created_at: "",
          statusWidgetValues: { character: { affection: "43" } },
        },
      ],
      activeVariant: 0,
      statusWidgetValues: { character: { affection: "43" } },
      characterWidget: meterWidget(["affection"]),
      previousCanonicalStatus: { character: { affection: "40" } },
      generationSequence: 0,
      isRegeneration: false,
      requestId: "r1",
      sourceTurn: 1,
    });
    assert.ok(getNumericStateCurrent(db, 1, "affection"));
    db.transaction(() => {
      deleteNumericStateForChat(db, 1);
      db.prepare(`DELETE FROM messages WHERE chat_id=?`).run(1);
    })();
    assert.equal(getNumericStateCurrent(db, 1, "affection"), null);
    assert.equal(countEvents(db), 0);
  });

  it("cores do not own nested BEGIN when outer transaction wraps them", () => {
    const sql: string[] = [];
    const verboseDb = new Database(":memory:", {
      verbose: (s: string) => sql.push(s),
    });
    verboseDb.exec(`
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
        generation_status TEXT DEFAULT 'generating',
        status TEXT DEFAULT 'ok',
        is_refunded INTEGER DEFAULT 0,
        status_meta TEXT,
        deduction_slices TEXT,
        updated_at TEXT
      );
    `);
    ensureRpNumericStateTables(verboseDb);
    insertGeneratingAssistant(verboseDb, 50);
    sql.length = 0;
    executeAtomicNumericAssistantFinalize(verboseDb, {
      assistantMessageId: 50,
      chatId: 1,
      characterId: 7,
      content: "본문",
      model: "test",
      usageJson: "{}",
      variants: [
        {
          content: "본문",
          model: "test",
          usage: null,
          created_at: "",
          statusWidgetValues: { character: { affection: "43" } },
        },
      ],
      activeVariant: 0,
      statusWidgetValues: { character: { affection: "43" } },
      characterWidget: meterWidget(["affection"]),
      previousCanonicalStatus: { character: { affection: "40" } },
      generationSequence: 0,
      isRegeneration: false,
      requestId: "r1",
      sourceTurn: 1,
    });
    const begins = sql.filter((s) => /BEGIN/i.test(s));
    assert.equal(begins.length, 1, "exactly one outer BEGIN for atomic finalize");
  });
});
