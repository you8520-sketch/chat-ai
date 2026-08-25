import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  nextTrpgRoundWork,
  tryAcquireGmLock,
  tryBeginGmGeneration,
  trpgLlmBoundary,
} from "./roundLock";
import { ensureTrpgTables } from "./schema";
import type { TrpgActorReady } from "./roundLock";

function human(id: number, submitted: boolean, canAct = true): TrpgActorReady {
  return { id, kind: "human", canAct, submitted };
}
function bot(id: number, submitted: boolean, canAct = true): TrpgActorReady {
  return { id, kind: "ai_character", canAct, submitted };
}

describe("TRPG round work", () => {
  it("waits for humans before any bot or GM work", () => {
    const work = nextTrpgRoundWork({
      phase: "ACTION_INPUT",
      humans: [human(1, true), human(2, false)],
      bots: [bot(3, false)],
    });
    assert.deepEqual(work, { type: "wait_humans", pendingIds: [2] });
  });

  it("starts bot generation only after every acting human has submitted", () => {
    const work = nextTrpgRoundWork({
      phase: "ACTION_INPUT",
      humans: [human(1, true)],
      bots: [bot(3, false)],
    });
    assert.deepEqual(work, { type: "generate_bots", botIds: [3] });
  });

  it("skips incapacitated humans and does not wait on them", () => {
    const work = nextTrpgRoundWork({
      phase: "ACTION_INPUT",
      humans: [human(1, true), human(2, false, false)],
      bots: [],
    });
    assert.deepEqual(work, { type: "acquire_gm_lock" });
  });

  it("asks the host to fill a bot when generation failed and recovery is exhausted", () => {
    const work = nextTrpgRoundWork({
      phase: "BOT_ACTION",
      humans: [human(1, true)],
      bots: [bot(3, false)],
      botGenerateFailed: true,
      botRecoveryEligible: false,
    });
    assert.deepEqual(work, { type: "wait_host_fill", botIds: [3] });
  });

  it("auto-recovers pending bots once when generation failed but recovery remains", () => {
    const work = nextTrpgRoundWork({
      phase: "BOT_ACTION",
      humans: [human(1, true)],
      bots: [bot(3, false)],
      botGenerateFailed: true,
      botRecoveryEligible: true,
    });
    assert.deepEqual(work, { type: "generate_bots", botIds: [3] });
  });

  it("lets a solo human acquire the GM lock immediately", () => {
    const work = nextTrpgRoundWork({
      phase: "ACTION_INPUT",
      humans: [human(1, true)],
      bots: [],
    });
    assert.deepEqual(work, { type: "acquire_gm_lock" });
  });
});

describe("TRPG GM lock", () => {
  it("lets only one concurrent submitter start the GM call", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    db.prepare(
      `INSERT INTO trpg_campaigns (id, host_user_id) VALUES (1, 9)`
    ).run();
    db.prepare(
      `INSERT INTO trpg_rounds (id, campaign_id, round_number, phase)
       VALUES (10, 1, 1, 'ACTION_INPUT')`
    ).run();

    assert.equal(tryAcquireGmLock(db, 10, "req-a"), true);
    assert.equal(tryAcquireGmLock(db, 10, "req-b"), false);

    const row = db.prepare("SELECT phase, lock_holder_request_id, gm_generation_id FROM trpg_rounds WHERE id=10").get() as {
      phase: string;
      lock_holder_request_id: string;
      gm_generation_id: string | null;
    };
    assert.equal(row.phase, "LOCKING_ACTIONS");
    assert.equal(row.lock_holder_request_id, "req-a");
    assert.equal(row.gm_generation_id, null);

    db.prepare("UPDATE trpg_rounds SET phase='ROLLING' WHERE id=10").run();
    assert.equal(tryBeginGmGeneration(db, 10, "req-b"), false);
    assert.equal(tryBeginGmGeneration(db, 10, "req-a"), true);
    assert.equal(tryBeginGmGeneration(db, 10, "req-a"), false);
    db.close();
  });

  it("forbids calling the LLM while a SQLite apply transaction would be open", () => {
    assert.equal(trpgLlmBoundary("ACTION_INPUT").mayCallLlm, false);
    assert.equal(trpgLlmBoundary("BOT_ACTION").mayCallLlm, false);
    assert.equal(trpgLlmBoundary("APPLYING_STATE").mayCallLlm, false);
    assert.equal(trpgLlmBoundary("ROLLING").mayCallLlm, true);
    assert.equal(trpgLlmBoundary("GENERATING_NARRATION").mayCallLlm, true);
  });
});
