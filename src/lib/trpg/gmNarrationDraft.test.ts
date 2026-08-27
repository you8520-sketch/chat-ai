import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { ensureTrpgTables } from "./schema";
import {
  clearGmNarrationDraft,
  loadGmNarrationDraft,
  saveGmNarrationDraftForGeneration,
} from "./gmNarrationDraft";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

describe("gmNarrationDraft", () => {
  it("persists token-scoped draft and rejects stale owner", () => {
    const db = memoryDb();
    ensureTrpgTables(db);
    const roundId = Number(
      db
        .prepare(
          `INSERT INTO trpg_rounds (campaign_id, round_number, phase, gm_generation_id) VALUES (1,1,'GENERATING_NARRATION','token-a')`
        )
        .run().lastInsertRowid
    );
    assert.equal(
      saveGmNarrationDraftForGeneration(db, roundId, "token-a", {
        text: "streaming",
        updatedAtMs: Date.now(),
      }),
      true
    );
    assert.equal(
      saveGmNarrationDraftForGeneration(db, roundId, "token-b", {
        text: "stale",
        updatedAtMs: Date.now(),
      }),
      false
    );
    const draft = loadGmNarrationDraft(db, roundId);
    assert.equal(draft?.text, "streaming");
    assert.equal(draft?.generationId, "token-a");
    db.close();
  });

  it("refresh restores draft for current generation token", () => {
    const db = memoryDb();
    ensureTrpgTables(db);
    const roundId = Number(
      db
        .prepare(
          `INSERT INTO trpg_rounds (campaign_id, round_number, phase, gm_generation_id) VALUES (1,1,'GENERATING_NARRATION','token-a')`
        )
        .run().lastInsertRowid
    );
    saveGmNarrationDraftForGeneration(db, roundId, "token-a", {
      text: "partial narration",
      updatedAtMs: 100,
      providerTimings: { startAtMs: 10, firstChunkAtMs: 20, completeAtMs: null },
    });
    const reloaded = loadGmNarrationDraft(db, roundId);
    assert.equal(reloaded?.text, "partial narration");
    assert.equal(reloaded?.providerTimings?.firstChunkAtMs, 20);
    db.close();
  });

  it("returns null when gm_generation_id is absent", () => {
    const db = memoryDb();
    const roundId = Number(
      db
        .prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (1,1,'GENERATING_NARRATION')`)
        .run().lastInsertRowid
    );
    db.prepare(
      `UPDATE trpg_rounds SET gm_narration_draft_json=? WHERE id=?`
    ).run(
      JSON.stringify({
        generationId: "token-a",
        text: "orphan",
        updatedAtMs: Date.now(),
      }),
      roundId
    );
    assert.equal(loadGmNarrationDraft(db, roundId), null);
    db.close();
  });

  it("clears draft on commit path helper", () => {
    const db = memoryDb();
    ensureTrpgTables(db);
    const roundId = Number(
      db
        .prepare(
          `INSERT INTO trpg_rounds (campaign_id, round_number, phase, gm_generation_id) VALUES (1,1,'GENERATING_NARRATION','token-a')`
        )
        .run().lastInsertRowid
    );
    saveGmNarrationDraftForGeneration(db, roundId, "token-a", {
      text: "x",
      updatedAtMs: Date.now(),
    });
    clearGmNarrationDraft(db, roundId);
    assert.equal(loadGmNarrationDraft(db, roundId), null);
    db.close();
  });
});
