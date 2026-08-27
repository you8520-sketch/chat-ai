import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { ensureTrpgTables } from "./schema";
import { loadGmNarrationDraft, saveGmNarrationDraftForGeneration } from "./gmNarrationDraft";
import {
  GM_NARRATION_DRAFT_COALESCE_MS,
  GM_NARRATION_DRAFT_GROWTH_CHARS,
  GmNarrationDraftCoalescer,
} from "./gmNarrationDraftCoalescer";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function insertRound(db: Database.Database, generationId: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO trpg_rounds (campaign_id, round_number, phase, gm_generation_id)
         VALUES (1, 1, 'GENERATING_NARRATION', ?)`
      )
      .run(generationId).lastInsertRowid
  );
}

describe("gmNarrationDraftCoalescer", () => {
  it("coalesces many provider chunks into bounded DB writes and flushes latest text", () => {
    const db = memoryDb();
    const roundId = insertRound(db, "token-a");
    let staleLogs = 0;
    const coalescer = new GmNarrationDraftCoalescer({
      db,
      roundId,
      generationId: "token-a",
      onStaleDiscard: () => {
        staleLogs += 1;
      },
    });
    for (let i = 1; i <= 100; i += 1) {
      coalescer.noteNarration("a".repeat(i));
    }
    assert.ok(coalescer.writeCount < 100, `PROVIDER_CHUNK_DB_WRITE=false writes=${coalescer.writeCount}`);
    assert.ok(coalescer.writeCount <= 3, `GM_DRAFT_WRITE_COALESCED=true writes=${coalescer.writeCount}`);
    coalescer.flush();
    assert.equal(coalescer.text, "a".repeat(100));
    assert.equal(staleLogs, 0);
    db.close();
  });

  it("force flush persists final monotonic narration", () => {
    const db = memoryDb();
    const roundId = insertRound(db, "token-a");
    const coalescer = new GmNarrationDraftCoalescer({
      db,
      roundId,
      generationId: "token-a",
    });
    coalescer.noteNarration("부분");
    assert.equal(coalescer.writeCount, 0);
    coalescer.flush();
    assert.equal(coalescer.writeCount, 1, "GM_DRAFT_FINAL_FLUSH=true");
    const row = db
      .prepare(`SELECT gm_narration_draft_json FROM trpg_rounds WHERE id=?`)
      .get(roundId) as { gm_narration_draft_json: string };
    assert.match(row.gm_narration_draft_json, /부분/);
    db.close();
  });

  it("latches stale owner and logs once without spamming writes", () => {
    const db = memoryDb();
    const roundId = insertRound(db, "token-a");
    let staleLogs = 0;
    const coalescer = new GmNarrationDraftCoalescer({
      db,
      roundId,
      generationId: "stale-token",
      onStaleDiscard: () => {
        staleLogs += 1;
      },
    });
    coalescer.noteNarration("one");
    coalescer.flush();
    coalescer.noteNarration("one two");
    coalescer.flush();
    coalescer.noteNarration("one two three");
    coalescer.flush();
    assert.equal(staleLogs, 1, "STALE_DRAFT_LOG_ONCE=true");
    assert.equal(coalescer.isStaleLatched, true, "STALE_DRAFT_WRITE_LATCHED=true");
    assert.equal(coalescer.writeCount, 0);
    db.close();
  });

  it("growth threshold triggers a mid-stream flush before coalesce window elapses", () => {
    const db = memoryDb();
    const roundId = insertRound(db, "token-a");
    const coalescer = new GmNarrationDraftCoalescer({
      db,
      roundId,
      generationId: "token-a",
    });
    coalescer.noteNarration("x".repeat(GM_NARRATION_DRAFT_GROWTH_CHARS + 1));
    assert.equal(coalescer.writeCount, 1);
    db.close();
  });
});
