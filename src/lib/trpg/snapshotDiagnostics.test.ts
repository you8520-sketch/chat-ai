import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { createTrpgCampaign, saveTrpgSheet, EVEN_STATS } from "./engineCreate";
import { advanceTrpgCampaign } from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { ensureTrpgTables } from "./schema";
import { executeTrpgCampaignSnapshotGet } from "./snapshotGetTrace";
import {
  beginActiveSnapshotRequest,
  collectSnapshotScaleCounts,
  createAdvanceDiagState,
  endActiveSnapshotRequest,
  getActiveSnapshotRequests,
  isTrpgSnapshotDiagnosticsEnabled,
  resetActiveSnapshotRequestsForTest,
  runWithAdvanceDiag,
  setTrpgSnapshotDiagLogForTest,
  withActiveSnapshotRequest,
} from "./snapshotDiagnostics";

const SECRET_NARRATION = "SECRET_NARRATION_TOKEN_XYZ_DO_NOT_LOG";
const SECRET_ACTION = "SECRET_ACTION_BODY_TOKEN_ABC_DO_NOT_LOG";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function setDiag(on: boolean): void {
  if (on) process.env.TRPG_SNAPSHOT_DIAGNOSTICS = "1";
  else delete process.env.TRPG_SNAPSHOT_DIAGNOSTICS;
}

function seedLobby(db: Database.Database): number {
  const campaignId = createTrpgCampaign(db, {
    hostUserId: 1,
    hostNickname: "렌",
    viewerUserId: 1,
  });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  return campaignId;
}

function seedRoundWithSecrets(db: Database.Database, campaignId: number): void {
  const participant = db
    .prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND kind='human'`)
    .get(campaignId) as { id: number };
  const roundId = Number(
    db
      .prepare(
        `INSERT INTO trpg_rounds (campaign_id, round_number, phase, billed, billed_points)
         VALUES (?, 1, 'ACTION_INPUT', 1, 50)`
      )
      .run(campaignId).lastInsertRowid
  );
  db.prepare(`INSERT INTO trpg_gm_messages (round_id, narration) VALUES (?,?)`).run(roundId, SECRET_NARRATION);
  const subId = Number(
    db
      .prepare(
        `INSERT INTO trpg_action_submissions (round_id, participant_id, body, action_type, locked, source)
         VALUES (?,?,?,?,1,'manual')`
      )
      .run(roundId, participant.id, SECRET_ACTION, "free").lastInsertRowid
  );
  db.prepare(
    `INSERT INTO trpg_dice_rolls (round_id, submission_id, d20, stat_key, stat_modifier, final_score, dc, tier)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(roundId, subId, 12, "body", 2, 14, 12, "SUCCESS");
}

function topKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.keys(value as object).sort();
}

function responsePayload(campaign: unknown) {
  return { campaign };
}

afterEach(() => {
  setDiag(false);
  resetActiveSnapshotRequestsForTest();
});

describe("TRPG snapshot diagnostics", () => {
  it("DIAGNOSTICS_OFF_NO_LOG=true", () => {
    setDiag(false);
    assert.equal(isTrpgSnapshotDiagnosticsEnabled(), false);
    const lines: unknown[] = [];
    const restore = setTrpgSnapshotDiagLogForTest((line) => {
      lines.push(line);
    });
    const db = memoryDb();
    const campaignId = seedLobby(db);
    const result = executeTrpgCampaignSnapshotGet({ db, userId: 1, campaignId });
    restore();
    db.close();
    assert.ok(result.campaign);
    assert.equal(lines.length, 0);
    assert.equal(getActiveSnapshotRequests(), 0);
  });

  it("DIAGNOSTICS_ON_SAME_RESPONSE=true and NO_RESPONSE_SCHEMA_CHANGE=true", () => {
    const db = memoryDb();
    const campaignId = seedLobby(db);
    seedRoundWithSecrets(db, campaignId);

    setDiag(false);
    const off = executeTrpgCampaignSnapshotGet({ db, userId: 1, campaignId });
    const offJson = JSON.stringify(responsePayload(off.campaign));
    const offKeys = topKeys(off.campaign);

    const lines: Record<string, unknown>[] = [];
    const restore = setTrpgSnapshotDiagLogForTest((line) => {
      lines.push(line);
    });
    setDiag(true);
    const on = executeTrpgCampaignSnapshotGet({ db, userId: 1, campaignId });
    restore();
    const onJson = JSON.stringify(responsePayload(on.campaign));
    const onKeys = topKeys(on.campaign);

    db.close();
    assert.deepEqual(onKeys, offKeys);
    assert.equal(onJson, offJson);
    assert.ok(off.campaign && !("diagnostics" in off.campaign));
    assert.ok(on.campaign && !("requestId" in on.campaign));
    assert.ok(lines.some((line) => line.event === "trpg_snapshot_start"));
    assert.ok(lines.some((line) => line.event === "trpg_snapshot_end"));
    assert.ok(lines.some((line) => line.event === "trpg_snapshot_profile"));
    const dumped = JSON.stringify(lines);
    assert.equal(dumped.includes(SECRET_NARRATION), false);
    assert.equal(dumped.includes(SECRET_ACTION), false);
  });

  it("ACTIVE_COUNTER_FINALLY_RELEASED=true", () => {
    assert.equal(getActiveSnapshotRequests(), 0);
    const inner = withActiveSnapshotRequest(() => {
      assert.equal(getActiveSnapshotRequests(), 1);
      return "ok";
    });
    assert.equal(inner, "ok");
    assert.equal(getActiveSnapshotRequests(), 0);
  });

  it("ERROR_PATH_COUNTER_RELEASED=true", () => {
    setDiag(true);
    const restore = setTrpgSnapshotDiagLogForTest(() => undefined);
    const db = new Database(":memory:");
    assert.throws(() => executeTrpgCampaignSnapshotGet({ db, userId: 1, campaignId: 1 }));
    restore();
    db.close();
    assert.equal(getActiveSnapshotRequests(), 0);

    assert.throws(() =>
      withActiveSnapshotRequest(() => {
        throw new Error("boom");
      })
    );
    assert.equal(getActiveSnapshotRequests(), 0);
  });

  it("overlapping start increments then finally returns to zero", () => {
    beginActiveSnapshotRequest();
    beginActiveSnapshotRequest();
    assert.equal(getActiveSnapshotRequests(), 2);
    endActiveSnapshotRequest();
    endActiveSnapshotRequest();
    assert.equal(getActiveSnapshotRequests(), 0);
  });

  it("404 still releases the active counter and does not change the payload shape", () => {
    setDiag(true);
    const lines: Record<string, unknown>[] = [];
    const restore = setTrpgSnapshotDiagLogForTest((line) => {
      lines.push(line);
    });
    const db = memoryDb();
    const result = executeTrpgCampaignSnapshotGet({ db, userId: 1, campaignId: 999 });
    restore();
    db.close();
    assert.equal(result.campaign, null);
    assert.equal(getActiveSnapshotRequests(), 0);
    const end = lines.find((line) => line.event === "trpg_snapshot_end");
    assert.equal(end?.status, 404);
  });

  it("scale counts stay numeric and omit bodies", () => {
    const db = memoryDb();
    const campaignId = seedLobby(db);
    seedRoundWithSecrets(db, campaignId);
    const snap = loadTrpgSnapshot(db, campaignId, 1);
    db.close();
    assert.ok(snap);
    const counts = collectSnapshotScaleCounts(snap);
    assert.equal(counts.roundCount >= 1, true);
    assert.equal(counts.logActionCount >= 1, true);
    assert.equal(counts.logRollCount >= 1, true);
    assert.equal(counts.totalNarrations >= 1, true);
    assert.equal(counts.estimatedTextChars >= SECRET_NARRATION.length, true);
    assert.equal("narration" in counts, false);
  });

  it("advance diagnostics do not change lobby snapshot or call a provider", async () => {
    const db = memoryDb();
    const campaignId = seedLobby(db);
    setDiag(false);
    const off = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: { skipBilling: true } });
    const lines: Record<string, unknown>[] = [];
    const restore = setTrpgSnapshotDiagLogForTest((line) => {
      lines.push(line);
    });
    setDiag(true);
    const meta = createAdvanceDiagState();
    const on = await runWithAdvanceDiag(meta, () =>
      advanceTrpgCampaign(db, { campaignId, userId: 1, deps: { skipBilling: true } })
    );
    restore();
    db.close();
    assert.equal(JSON.stringify(on), JSON.stringify(off));
    assert.equal(meta.phaseBefore, "NONE");
    assert.equal(meta.workTypeBefore, "idle");
    assert.equal(lines.length, 0);
  });

  it("does not change client polling or expose the flag to browser JS", () => {
    const client = readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.match(client, /const POLL_MS = 1500/);
    assert.equal(client.includes("AbortController"), false);
    assert.equal(client.includes("TRPG_SNAPSHOT_DIAGNOSTICS"), false);
    const getRoute = readFileSync("src/app/api/trpg/campaigns/[id]/route.ts", "utf8");
    assert.match(getRoute, /NextResponse\.json\(\{ campaign \}\)/);
    assert.equal(getRoute.includes("NEXT_PUBLIC_TRPG_SNAPSHOT"), false);
  });
});
