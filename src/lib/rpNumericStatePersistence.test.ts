import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { ServerMeterNumericStateDefinitionV1 } from "@/lib/statusWidget/types";
import { fingerprintNumericStateDefinition } from "@/lib/statusWidget/numericStateFingerprint";
import {
  RP_NUMERIC_STATE_USES_BEGIN_IMMEDIATE,
  bootstrapNumericStateCurrent,
  buildNumericIdempotencyKey,
  commitNumericStateProposal,
  ensureRpNumericStateTables,
  getNumericStateCurrent,
  getNumericStateEventById,
} from "@/lib/rpNumericState/persistence";
import {
  NumericStateNotBootstrappedError,
  NumericStateValidationError,
} from "@/lib/rpNumericState/types";

const def: ServerMeterNumericStateDefinitionV1 = {
  version: 1,
  mode: "server_meter",
  min: 0,
  max: 100,
  initial: 40,
  integer: true,
  maxIncreasePerTurn: 5,
  maxDecreasePerTurn: 5,
};

function makeDb(verboseSql?: string[]): Database.Database {
  const db = new Database(":memory:", {
    ...(verboseSql
      ? {
          verbose: (sql: string) => {
            verboseSql.push(sql);
          },
        }
      : {}),
  });
  ensureRpNumericStateTables(db);
  return db;
}

function countEvents(db: Database.Database, chatId = 1, stateKey = "affection"): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM rp_numeric_state_events WHERE chat_id=? AND state_key=?`
    )
    .get(chatId, stateKey) as { c: number };
  return row.c;
}

describe("Phase B1-A — bootstrap (B1-B5)", () => {
  it("B1 new initial baseline", () => {
    const db = makeDb();
    const r = bootstrapNumericStateCurrent(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:1",
      sourceKind: "definition_initial",
    });
    assert.equal(r.kind, "INITIALIZED");
    assert.equal(r.current.numericValue, 40);
    assert.equal(r.current.revision, 1);
    assert.equal(r.event?.outcome, "INITIALIZED");
    assert.equal(r.event?.beforeValue, null);
    assert.equal(r.event?.afterValue, 40);
  });

  it("B2 event + current atomic", () => {
    const db = makeDb();
    const r = bootstrapNumericStateCurrent(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:1",
      sourceKind: "definition_initial",
    });
    assert.equal(countEvents(db), 1);
    assert.ok(getNumericStateCurrent(db, 1, "affection"));
    assert.equal(r.current.lastEventId, r.event?.id);
  });

  it("B3 existing current → no overwrite", () => {
    const db = makeDb();
    bootstrapNumericStateCurrent(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:1",
      sourceKind: "definition_initial",
    });
    const r = bootstrapNumericStateCurrent(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      baselineValue: 10,
      mutationId: "bootstrap:2",
      sourceKind: "legacy_bootstrap",
    });
    assert.equal(r.kind, "ALREADY_BOOTSTRAPPED");
    assert.equal(r.current.numericValue, 40);
    assert.equal(countEvents(db), 1);
  });

  it("B4 same bootstrap idempotent", () => {
    const db = makeDb();
    const a = bootstrapNumericStateCurrent(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:1",
      sourceKind: "definition_initial",
    });
    const b = bootstrapNumericStateCurrent(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:1",
      sourceKind: "definition_initial",
    });
    assert.equal(b.kind, "IDEMPOTENT_NOOP");
    assert.equal(countEvents(db), 1);
    assert.equal(a.current.revision, b.current.revision);
  });

  it("B5 invalid baseline rejected", () => {
    const db = makeDb();
    assert.throws(
      () =>
        bootstrapNumericStateCurrent(db, {
          chatId: 1,
          characterId: 7,
          stateKey: "affection",
          definition: def,
          baselineValue: 999,
          mutationId: "bootstrap:bad",
          sourceKind: "definition_initial",
        }),
      NumericStateValidationError
    );
    assert.equal(countEvents(db), 0);
  });
});

describe("Phase B1-A — persistence commit (C1-C10)", () => {
  function boot(db: Database.Database) {
    bootstrapNumericStateCurrent(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:1",
      sourceKind: "definition_initial",
    });
  }

  it("C1 normal mutation: current updated + event appended", () => {
    const db = makeDb();
    boot(db);
    const r = commitNumericStateProposal(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      proposal: 43,
      mutationId: "generation:50:0:r1",
      sourceKind: "extractor",
      sourceTurn: 1,
      assistantMessageId: 50,
      requestId: "r1",
      generationSequence: 0,
    });
    assert.equal(r.kind, "APPLIED");
    assert.equal(r.current.numericValue, 43);
    assert.equal(r.current.revision, 2);
    assert.equal(countEvents(db), 2);
    assert.equal(r.event?.outcome, "APPLIED");
  });

  it("C2 NO_CHANGE: event appended, revision increments, value unchanged", () => {
    const db = makeDb();
    boot(db);
    const r = commitNumericStateProposal(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 40,
      mutationId: "generation:50:0:r1",
      sourceKind: "extractor",
    });
    assert.equal(r.kind, "NO_CHANGE");
    assert.equal(r.current.numericValue, 40);
    assert.equal(r.current.revision, 2);
    assert.equal(countEvents(db), 2);
  });

  it("C3 INVALID_HOLD: event appended, revision increments, value unchanged", () => {
    const db = makeDb();
    boot(db);
    const r = commitNumericStateProposal(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: "약 43",
      mutationId: "generation:50:0:r1",
      sourceKind: "extractor",
    });
    assert.equal(r.kind, "INVALID_HOLD");
    assert.equal(r.current.numericValue, 40);
    assert.equal(r.current.revision, 2);
    assert.equal(countEvents(db), 2);
  });

  it("C4 duplicate idempotency: event count unchanged, revision unchanged", () => {
    const db = makeDb();
    boot(db);
    const a = commitNumericStateProposal(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 43,
      mutationId: "generation:50:0:r1",
      sourceKind: "extractor",
    });
    const b = commitNumericStateProposal(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 99,
      mutationId: "generation:50:0:r1",
      sourceKind: "extractor",
    });
    assert.equal(b.kind, "IDEMPOTENT_NOOP");
    assert.equal(b.current.numericValue, a.current.numericValue);
    assert.equal(b.current.revision, a.current.revision);
    assert.equal(countEvents(db), 2);
  });

  it("C5 forced event failure → current rollback", () => {
    const db = makeDb();
    boot(db);
    db.exec(`
      CREATE TRIGGER fail_event_insert BEFORE INSERT ON rp_numeric_state_events
      BEGIN
        SELECT RAISE(ABORT, 'forced event failure');
      END;
    `);
    assert.throws(
      () =>
        commitNumericStateProposal(db, {
          chatId: 1,
          stateKey: "affection",
          definition: def,
          proposal: 43,
          mutationId: "generation:50:0:r1",
          sourceKind: "extractor",
        }),
      /forced event failure/
    );
    const current = getNumericStateCurrent(db, 1, "affection")!;
    assert.equal(current.numericValue, 40);
    assert.equal(current.revision, 1);
    assert.equal(countEvents(db), 1);
  });

  it("C6 forced current failure → event rollback", () => {
    const db = makeDb();
    boot(db);
    db.exec(`
      CREATE TRIGGER fail_current_update BEFORE UPDATE ON rp_numeric_state_current
      BEGIN
        SELECT RAISE(ABORT, 'forced current failure');
      END;
    `);
    assert.throws(
      () =>
        commitNumericStateProposal(db, {
          chatId: 1,
          stateKey: "affection",
          definition: def,
          proposal: 43,
          mutationId: "generation:50:0:r1",
          sourceKind: "extractor",
        }),
      /forced current failure/
    );
    const current = getNumericStateCurrent(db, 1, "affection")!;
    assert.equal(current.numericValue, 40);
    assert.equal(current.revision, 1);
    assert.equal(countEvents(db), 1, "event insert rolled back with current");
  });

  it("C7 mutation_id shared across keys — idempotency per state key", () => {
    const db = makeDb();
    for (const key of ["affection", "trust"] as const) {
      bootstrapNumericStateCurrent(db, {
        chatId: 1,
        characterId: 7,
        stateKey: key,
        definition: def,
        baselineValue: 40,
        mutationId: `bootstrap:${key}`,
        sourceKind: "definition_initial",
      });
    }
    const mut = "generation:50:0:r1";
    commitNumericStateProposal(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 43,
      mutationId: mut,
      sourceKind: "extractor",
    });
    commitNumericStateProposal(db, {
      chatId: 1,
      stateKey: "trust",
      definition: def,
      proposal: 44,
      mutationId: mut,
      sourceKind: "extractor",
    });
    assert.equal(getNumericStateCurrent(db, 1, "affection")!.numericValue, 43);
    assert.equal(getNumericStateCurrent(db, 1, "trust")!.numericValue, 44);
    assert.notEqual(
      buildNumericIdempotencyKey({
        chatId: 1,
        stateKey: "affection",
        mutationId: mut,
        sourceKind: "extractor",
      }),
      buildNumericIdempotencyKey({
        chatId: 1,
        stateKey: "trust",
        mutationId: mut,
        sourceKind: "extractor",
      })
    );
  });

  it("C8 replaces_event_id preserved; old event not deleted", () => {
    const db = makeDb();
    boot(db);
    const a = commitNumericStateProposal(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 43,
      mutationId: "generation:50:0:r1",
      sourceKind: "extractor",
      assistantMessageId: 50,
      generationSequence: 0,
      requestId: "r1",
    });
    assert.ok(a.event);
    const b = commitNumericStateProposal(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 46,
      mutationId: "generation:50:1:r2",
      sourceKind: "extractor",
      assistantMessageId: 50,
      generationSequence: 1,
      requestId: "r2",
      replacesEventId: a.event!.id,
    });
    assert.equal(b.event?.replacesEventId, a.event!.id);
    assert.ok(getNumericStateEventById(db, a.event!.id), "old event A still exists");
    assert.ok(getNumericStateEventById(db, b.event!.id), "new event B exists");
    assert.equal(countEvents(db), 3);
  });

  it("C9 definition_hash stable", () => {
    const db = makeDb();
    boot(db);
    const expected = fingerprintNumericStateDefinition(def);
    const r = commitNumericStateProposal(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 41,
      mutationId: "generation:50:0:r1",
      sourceKind: "extractor",
    });
    assert.equal(r.event?.definitionHash, expected);
    assert.equal(
      fingerprintNumericStateDefinition({ ...def }),
      expected
    );
  });

  it("C10 BEGIN IMMEDIATE path used", () => {
    assert.equal(RP_NUMERIC_STATE_USES_BEGIN_IMMEDIATE, true);
    const sql: string[] = [];
    const db = makeDb(sql);
    boot(db);
    sql.length = 0;
    commitNumericStateProposal(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 41,
      mutationId: "generation:50:0:r1",
      sourceKind: "extractor",
    });
    const joined = sql.join("\n").toUpperCase();
    assert.match(joined, /BEGIN\s+IMMEDIATE/);
  });

  it("unbootstrapped commit throws NUMERIC_STATE_NOT_BOOTSTRAPPED", () => {
    const db = makeDb();
    assert.throws(
      () =>
        commitNumericStateProposal(db, {
          chatId: 1,
          stateKey: "affection",
          definition: def,
          proposal: 41,
          mutationId: "generation:50:0:r1",
          sourceKind: "extractor",
        }),
      NumericStateNotBootstrappedError
    );
  });
});

describe("Phase B1-A — schema presence", () => {
  it("current + event tables and indexes exist", () => {
    const db = makeDb();
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rp_numeric_state_%'`
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "rp_numeric_state_current",
      "rp_numeric_state_events",
    ]);
    const indexes = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_rp_numeric_state_%'`
      )
      .all() as { name: string }[];
    const indexNames = new Set(indexes.map((i) => i.name));
    assert.ok(indexNames.has("idx_rp_numeric_state_current_chat"));
    assert.ok(indexNames.has("idx_rp_numeric_state_events_chat_key"));
    assert.ok(indexNames.has("idx_rp_numeric_state_events_message"));
    assert.ok(indexNames.has("idx_rp_numeric_state_events_mutation"));
  });

  it("HOT_PATH_SCHEMA_DDL = 0 after explicit test setup", () => {
    const sql: string[] = [];
    const db = makeDb(sql);
    // Setup DDL already ran via makeDb → ensureRpNumericStateTables once.
    sql.length = 0;

    bootstrapNumericStateCurrent(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:hot-path-ddl",
      sourceKind: "definition_initial",
    });
    commitNumericStateProposal(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 43,
      mutationId: "generation:1:0:r1",
      sourceKind: "extractor",
    });
    const current = getNumericStateCurrent(db, 1, "affection");
    assert.ok(current);
    assert.equal(current.numericValue, 43);
    const event = getNumericStateEventById(db, current.lastEventId!);
    assert.ok(event);

    const ddl = sql.filter((s) =>
      /\bCREATE\s+(TABLE|INDEX)\b/i.test(s)
    );
    assert.equal(
      ddl.length,
      0,
      `HOT_PATH_SCHEMA_DDL must be 0; saw: ${ddl.join(" | ")}`
    );
  });
});
