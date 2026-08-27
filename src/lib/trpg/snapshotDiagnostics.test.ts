import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { createTrpgCampaign, saveTrpgSheet, EVEN_STATS, writeSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction } from "./engineAdvance";
import { insertParticipant } from "./store";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { ensureTrpgTables } from "./schema";
import { loadTrpgCampaignSnapshotForGet } from "./snapshotGetTrace";
import {
  beginActiveCampaignGetRequest,
  collectSnapshotScaleCounts,
  endActiveCampaignGetRequest,
  getActiveCampaignGetRequests,
  isTrpgSnapshotDiagnosticsEnabled,
  newTrpgDiagRequestId,
  resetActiveCampaignGetRequestsForTest,
  setTrpgSnapshotDiagLogForTest,
  withActiveCampaignGetRequest,
} from "./snapshotDiagnostics";

function gmText(narration = "장면"): string {
  return `<<<NARRATION>>>\n${narration}\n<<<DELTA>>>\n${JSON.stringify({
    players: [],
    location: "문턱",
    next_round_context: "다음",
    questsAdd: [],
    flagsAdd: [],
    campaign_finished: false,
  })}`;
}

function collectDiagLines(fn: () => Promise<void> | void): Promise<Record<string, unknown>[]> {
  const lines: Record<string, unknown>[] = [];
  const restore = setTrpgSnapshotDiagLogForTest((line) => {
    lines.push(line);
  });
  return Promise.resolve(fn()).then(
    () => {
      restore();
      return lines;
    },
    (error) => {
      restore();
      return Promise.reject(error);
    }
  );
}

function advanceEvents(lines: Record<string, unknown>[]) {
  return lines.filter((line) => {
    const event = line.event;
    return event === "trpg_advance_start" || event === "trpg_advance_end";
  });
}

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
  resetActiveCampaignGetRequestsForTest();
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
    const result = loadTrpgCampaignSnapshotForGet({
      db,
      userId: 1,
      campaignId,
      requestId: "test",
    });
    restore();
    db.close();
    assert.ok(result.campaign);
    assert.equal(result.profile, null);
    assert.equal(lines.length, 0);
    assert.equal(getActiveCampaignGetRequests(), 0);
  });

  it("DIAGNOSTICS_OFF_SAME_RESPONSE=true and DIAGNOSTICS_ON_SAME_RESPONSE=true", () => {
    const db = memoryDb();
    const campaignId = seedLobby(db);
    seedRoundWithSecrets(db, campaignId);

    setDiag(false);
    const off = loadTrpgCampaignSnapshotForGet({
      db,
      userId: 1,
      campaignId,
      requestId: "off",
    });
    const offJson = JSON.stringify(responsePayload(off.campaign));
    const offKeys = topKeys(off.campaign);

    setDiag(true);
    const on = loadTrpgCampaignSnapshotForGet({
      db,
      userId: 1,
      campaignId,
      requestId: "on",
    });
    const onJson = JSON.stringify(responsePayload(on.campaign));
    const onKeys = topKeys(on.campaign);

    db.close();
    assert.deepEqual(onKeys, offKeys);
    assert.equal(onJson, offJson);
    assert.ok(off.campaign && !("diagnostics" in off.campaign));
    assert.ok(on.campaign && !("requestId" in on.campaign));
  });

  it("RESPONSE_SCHEMA_UNCHANGED=true", () => {
    const db = memoryDb();
    const campaignId = seedLobby(db);
    const snap = loadTrpgSnapshot(db, campaignId, 1);
    db.close();
    assert.ok(snap);
    const keys = topKeys(snap);
    assert.equal(keys.includes("diagnostics"), false);
    assert.equal(keys.includes("requestId"), false);
  });

  it("NO_EXTRA_FULL_JSON_SERIALIZATION=true", () => {
    const trace = readFileSync("src/lib/trpg/snapshotGetTrace.ts", "utf8");
    const route = readFileSync("src/app/api/trpg/campaigns/[id]/route.ts", "utf8");
    assert.equal(trace.includes("JSON.stringify"), false);
    assert.equal(route.includes('JSON.stringify({ campaign })'), false);
    assert.equal(route.includes("snapshotBytes"), false);
    assert.equal(route.includes("serializeMs"), false);
  });

  it("ROUTE_COUNTER_STARTS_BEFORE_AUTH=true", () => {
    const route = readFileSync("src/app/api/trpg/campaigns/[id]/route.ts", "utf8");
    const startIdx = route.indexOf("beginActiveCampaignGetRequest()");
    const authIdx = route.indexOf("await requireTrpgApi()", startIdx);
    assert.ok(startIdx >= 0);
    assert.ok(authIdx > startIdx);
    assert.equal(route.includes("activeSnapshotRequests"), false);
    assert.match(route, /activeCampaignGetRequests/);
  });

  it("ROUTE_COUNTER_RELEASES_AFTER_RESPONSE_BUILD=true", () => {
    const route = readFileSync("src/app/api/trpg/campaigns/[id]/route.ts", "utf8");
    const responseBuildIdx = route.indexOf("responseBuildMs = roundDiagMs");
    const finallyIdx = route.indexOf("} finally {");
    const releaseIdx = route.indexOf("endActiveCampaignGetRequest()");
    assert.ok(responseBuildIdx >= 0);
    assert.ok(finallyIdx > responseBuildIdx);
    assert.ok(releaseIdx > finallyIdx);
    assert.match(route, /responseBuildMs/);
    assert.match(route, /totalRouteMs/);
  });

  it("ACTIVE_COUNTER_FINALLY_RELEASED=true", () => {
    assert.equal(getActiveCampaignGetRequests(), 0);
    const inner = withActiveCampaignGetRequest(() => {
      assert.equal(getActiveCampaignGetRequests(), 1);
      return "ok";
    });
    assert.equal(inner, "ok");
    assert.equal(getActiveCampaignGetRequests(), 0);
  });

  it("ASYNC_AUTH_OVERLAP_CAN_REPORT_ACTIVE_2=true", async () => {
    resetActiveCampaignGetRequestsForTest();
    let peak = 0;
    const hold = async () => {
      beginActiveCampaignGetRequest();
      try {
        await new Promise((resolve) => setTimeout(resolve, 20));
        peak = Math.max(peak, getActiveCampaignGetRequests());
      } finally {
        endActiveCampaignGetRequest();
      }
    };
    await Promise.all([hold(), hold()]);
    assert.equal(peak, 2);
    assert.equal(getActiveCampaignGetRequests(), 0);
  });

  it("SNAPSHOT_FAILURE_RELEASES_COUNTER=true", () => {
    setDiag(true);
    const restore = setTrpgSnapshotDiagLogForTest(() => undefined);
    const db = new Database(":memory:");
    assert.throws(() =>
      loadTrpgCampaignSnapshotForGet({
        db,
        userId: 1,
        campaignId: 1,
        requestId: newTrpgDiagRequestId(),
      })
    );
    restore();
    db.close();
    assert.throws(() =>
      withActiveCampaignGetRequest(() => {
        throw new Error("boom");
      })
    );
    assert.equal(getActiveCampaignGetRequests(), 0);
  });

  it("AUTH_FAILURE_RELEASES_COUNTER=true and 404_RELEASES_COUNTER=true", () => {
    const route = readFileSync("src/app/api/trpg/campaigns/[id]/route.ts", "utf8");
    assert.match(route, /beginActiveCampaignGetRequest\(\)/);
    assert.match(route, /endActiveCampaignGetRequest\(\)/);
    assert.match(route, /if \("error" in gate\)/);
    assert.match(route, /status = authError\.status/);
    assert.match(route, /status = 404/);
    assert.match(route, /activeCampaignGetRequestsAfterRelease/);
  });

  it("404 path uses null campaign without extra serialization in trace loader", () => {
    setDiag(true);
    const db = memoryDb();
    const result = loadTrpgCampaignSnapshotForGet({
      db,
      userId: 1,
      campaignId: 999,
      requestId: newTrpgDiagRequestId(),
    });
    db.close();
    assert.equal(result.campaign, null);
    assert.ok(result.profile);
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
    assert.equal("snapshotBytes" in counts, false);
  });

  it("DIAGNOSTICS_OFF_ADVANCE_BEHAVIOR_IDENTICAL: lobby advance unchanged when flag off", async () => {
    const db = memoryDb();
    const campaignId = seedLobby(db);
    setDiag(false);
    const off = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: { skipBilling: true } });
    setDiag(true);
    const lines = await collectDiagLines(async () => {
      setDiag(false);
      const again = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: { skipBilling: true } });
      assert.equal(JSON.stringify(again), JSON.stringify(off));
    });
    db.close();
    assert.equal(advanceEvents(lines).length, 0);
  });

  it("DIRECT_ADVANCE_CALL_DIAGNOSED: engine owner emits one start/end pair", async () => {
    const db = memoryDb();
    const campaignId = seedLobby(db);
    setDiag(true);
    const lines = await collectDiagLines(async () => {
      await advanceTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: { skipBilling: true },
        source: "direct_test",
      });
    });
    db.close();
    const events = advanceEvents(lines);
    assert.equal(events.filter((e) => e.event === "trpg_advance_start").length, 1);
    assert.equal(events.filter((e) => e.event === "trpg_advance_end").length, 1);
    assert.equal(events[0]?.source, "direct_test");
    assert.equal(events[1]?.success, true);
    assert.equal(events[1]?.workTypeBefore, "idle");
    assert.equal(events[1]?.phaseBefore, "NONE");
  });

  it("POST_ACTION_AFTER_ADVANCE_DIAGNOSED: post_action_after source is observable", async () => {
    const db = memoryDb();
    const campaignId = seedLobby(db);
    setDiag(true);
    const lines = await collectDiagLines(async () => {
      await advanceTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: { skipBilling: true },
        source: "post_action_after",
      });
    });
    db.close();
    const start = advanceEvents(lines).find((e) => e.event === "trpg_advance_start");
    assert.equal(start?.source, "post_action_after");
  });

  it("ADVANCE_ROUTE_CALL_DIAGNOSED: poll_advance source wired from advance route", () => {
    const route = readFileSync("src/app/api/trpg/campaigns/[id]/advance/route.ts", "utf8");
    assert.match(route, /source:\s*"poll_advance"/);
    assert.equal(route.includes("trpg_advance_start"), false);
    assert.equal(route.includes("logTrpgSnapshotDiag"), false);
  });

  it("NO_DUPLICATE_ROUTE_AND_ENGINE_LOGGING: advance route has no route-level advance logs", () => {
    const route = readFileSync("src/app/api/trpg/campaigns/[id]/advance/route.ts", "utf8");
    assert.equal(route.includes("runWithAdvanceDiag"), false);
    assert.equal(route.includes("createAdvanceDiagState"), false);
    assert.equal(route.includes("trpg_advance_end"), false);
  });

  it("ONE_ADVANCE_CALL_ONE_START_END_PAIR: bot recursion stays inside one outer pair", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const botId = insertParticipant(db, {
      campaignId,
      slotIndex: 1,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "유나",
    });
    writeSheet(db, campaignId, botId, "유나", EVEN_STATS, "");
    const deps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async () => ({ text: gmText("오프닝") }),
      botCall: async () => ({ text: "유나는 창틀을 본다.\n\n<<<INTENT>>>\n창틀을 본다." }),
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "창문을 연다." });
    setDiag(true);
    const lines = await collectDiagLines(async () => {
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps, source: "post_action_after" });
    });
    db.close();
    const events = advanceEvents(lines);
    assert.equal(events.filter((e) => e.event === "trpg_advance_start").length, 1);
    assert.equal(events.filter((e) => e.event === "trpg_advance_end").length, 1);
    const end = events.find((e) => e.event === "trpg_advance_end");
    assert.equal(end?.success, true);
    assert.equal(typeof end?.totalMs, "number");
  });

  it("ADVANCE_SUCCESS_END_LOG includes safe phase/work fields", async () => {
    const db = memoryDb();
    const campaignId = seedLobby(db);
    setDiag(true);
    const lines = await collectDiagLines(async () => {
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: { skipBilling: true } });
    });
    db.close();
    const end = advanceEvents(lines).find((e) => e.event === "trpg_advance_end");
    assert.equal(end?.success, true);
    assert.equal(end?.errorClass, null);
    assert.equal(end?.workTypeAfter, "idle");
    assert.equal(end?.phaseAfter, "NONE");
    assert.equal("body" in (end ?? {}), false);
    assert.equal("narration" in (end ?? {}), false);
  });

  it("ADVANCE_ERROR_END_LOG records safe errorClass only", async () => {
    const db = memoryDb();
    const campaignId = seedLobby(db);
    setDiag(true);
    const lines = await collectDiagLines(async () => {
      await assert.rejects(
        advanceTrpgCampaign(db, { campaignId, userId: 999, deps: { skipBilling: true } }),
        /참가자/
      );
    });
    db.close();
    const end = advanceEvents(lines).find((e) => e.event === "trpg_advance_end");
    assert.equal(end?.success, false);
    assert.equal(end?.errorClass, "Error");
    assert.equal(end?.workTypeAfter, null);
  });

  it("post-action route keeps after() and labels source without route-level advance logs", () => {
    const route = readFileSync("src/app/api/trpg/campaigns/[id]/action/route.ts", "utf8");
    assert.match(route, /after\(async \(\) => \{/);
    assert.match(route, /source:\s*"post_action_after"/);
    assert.equal(route.includes("trpg_advance_start"), false);
    assert.equal(route.includes("logTrpgSnapshotDiag"), false);
  });

  it("does not change client polling or expose the flag to browser JS", () => {
    const client = readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.match(client, /const POLL_MS = 1500/);
    assert.equal(client.includes("AbortController"), false);
    assert.equal(client.includes("TRPG_SNAPSHOT_DIAGNOSTICS"), false);
    const getRoute = readFileSync("src/app/api/trpg/campaigns/[id]/route.ts", "utf8");
    assert.match(getRoute, /NextResponse\.json\(\{ campaign: loaded\.campaign \}\)/);
    assert.equal(getRoute.includes("NEXT_PUBLIC_TRPG_SNAPSHOT"), false);
  });
});
