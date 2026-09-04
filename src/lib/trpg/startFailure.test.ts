import assert from "node:assert/strict";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import fs from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL } from "@/lib/chatModels";
import { createTrpgCampaign, saveTrpgSheet, EVEN_STATS } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { ensureTrpgTables } from "./schema";
import { loadCampaignContext } from "./campaignContext";
import { isTrpgSandboxDirectorEnabled } from "./sandboxDirector";
import { attachTrpgCallFailureMeta, buildTrpgRoundErrorJson, classifyTrpgStartFailure, parseTrpgStartFailureJson, sanitizeTrpgFailureHint } from "./startFailure";
import {
  TRPG_GM_MODEL,
  TRPG_HOST_INSUFFICIENT_POINTS_MESSAGE,
  TRPG_PLAYER_INSUFFICIENT_POINTS_MESSAGE,
} from "./types";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function gmText(narration = "문이 열린다."): string {
  return buildTrpgGmStructuredWireText(narration, {"players":[],"location":"문턱","next_round_context":"들어갈지","campaign_finished":false});
}

const playablePlan = {
  startingSituation: "폐도시에 들어간다",
  centralConflict: "코어와 인간 세력",
  goal: "원인을 밝힌다",
  secret: "지휘관대체SECRETPLAN",
  endingConditions: ["코어를 봉쇄한다"],
  clues: ["통신 기록"],
  endingCandidates: ["봉쇄"],
  gmDirection: "탐험",
};

describe("TRPG start failure classification", () => {
  it("classifies API/setup failures as A before an opening round exists", () => {
    assert.equal(
      classifyTrpgStartFailure({ error: new Error("모든 참가자의 시트를 만들어야 합니다.") }).class,
      "A"
    );
    assert.equal(
      classifyTrpgStartFailure({ error: new Error("TRPG는 관리자만 사용할 수 있습니다.") }).class,
      "A"
    );
    assert.equal(classifyTrpgStartFailure({ error: new Error("로그인이 필요합니다.") }).class, "A");
  });

  it("reuses the A/B/C classifier for timeout, HTTP, empty, and parse/state kinds", () => {
    const timeout = buildTrpgRoundErrorJson({
      error: attachTrpgCallFailureMeta(new Error("The operation was aborted due to timeout"), {
        elapsedMs: 180123,
      }),
      reachedOpeningRound: true,
      model: TRPG_GM_MODEL,
    });
    assert.equal(timeout.class, "B");
    assert.equal(timeout.kind, "provider_timeout");
    assert.equal(timeout.elapsedMs, 180123);
    assert.equal(timeout.trueOffRequested, true);
    assert.equal(timeout.httpStatus, null);
    assert.equal(timeout.reasoningTokens, "unavailable");
    assert.equal(sanitizeTrpgFailureHint(timeout), "GM 생성 실패 · Provider timeout (180초)");

    const http = buildTrpgRoundErrorJson({
      error: attachTrpgCallFailureMeta(new Error("[TRPG] 502: provider down"), { httpStatus: 502 }),
      reachedOpeningRound: true,
    });
    assert.equal(http.class, "B");
    assert.equal(http.kind, "provider_http");
    assert.equal(http.httpStatus, 502);
    assert.equal(sanitizeTrpgFailureHint(http), "GM 생성 실패 · Provider HTTP 5xx");

    const empty = buildTrpgRoundErrorJson({
      error: new Error("[TRPG] empty completion"),
      reachedOpeningRound: true,
    });
    assert.equal(empty.class, "B");
    assert.equal(empty.kind, "empty_completion");
    assert.equal(sanitizeTrpgFailureHint(empty), "GM 생성 실패 · Empty completion");

    const persist = buildTrpgRoundErrorJson({
      error: new Error("no such table: trpg_gm_messages"),
      reachedOpeningRound: true,
      gmUsageCount: 1,
    });
    assert.equal(persist.class, "C");
    assert.equal(persist.kind, "persist_error");
    assert.notEqual(persist.kind, "parse_state");
    assert.equal(sanitizeTrpgFailureHint(persist), "GM 생성 실패 · Persist error");
    assert.doesNotMatch(sanitizeTrpgFailureHint(persist), /trpg_gm_messages|sk-|SECRET/);
  });

  it("does not classify post-GM billing or parse failures as parse_state", () => {
    const billing = buildTrpgRoundErrorJson({
      error: attachTrpgCallFailureMeta(new Error(TRPG_PLAYER_INSUFFICIENT_POINTS_MESSAGE), {
        stage: "billing",
      }),
      reachedOpeningRound: true,
      gmUsageCount: 1,
    });
    assert.equal(billing.class, "C");
    assert.equal(billing.kind, "billing_insufficient");
    assert.equal(billing.stage, "billing");
    assert.notEqual(billing.kind, "parse_state");
    assert.equal(sanitizeTrpgFailureHint(billing), TRPG_PLAYER_INSUFFICIENT_POINTS_MESSAGE);
    assert.doesNotMatch(sanitizeTrpgFailureHint(billing), /Parse\/state|GM 생성 실패/);

    const hostBilling = buildTrpgRoundErrorJson({
      error: attachTrpgCallFailureMeta(new Error(TRPG_HOST_INSUFFICIENT_POINTS_MESSAGE), {
        stage: "billing",
      }),
      reachedOpeningRound: true,
      gmUsageCount: 1,
    });
    assert.equal(hostBilling.kind, "billing_insufficient");
    assert.equal(sanitizeTrpgFailureHint(hostBilling), TRPG_HOST_INSUFFICIENT_POINTS_MESSAGE);

    const billingError = buildTrpgRoundErrorJson({
      error: attachTrpgCallFailureMeta(new Error("UNIQUE constraint failed: trpg_creator_earnings"), {
        stage: "billing",
        billingSubstage: "creator_reward",
        billingErrorCode: "SQLITE_CONSTRAINT",
      }),
      reachedOpeningRound: true,
      gmUsageCount: 1,
    });
    assert.equal(billingError.kind, "billing_error");
    assert.equal(billingError.stage, "billing");
    assert.equal(billingError.billingSubstage, "creator_reward");
    assert.equal(billingError.billingErrorCode, "SQLITE_CONSTRAINT");
    assert.equal(sanitizeTrpgFailureHint(billingError), "라운드 과금 실패 · 제작자 정산 단계");
    assert.doesNotMatch(sanitizeTrpgFailureHint(billingError), /UNIQUE|trpg_creator_earnings|sk-/);

    const parse = buildTrpgRoundErrorJson({
      error: attachTrpgCallFailureMeta(new Error("GM output parse failed"), {
        stage: "gm_output_parse",
      }),
      reachedOpeningRound: true,
      gmUsageCount: 1,
    });
    assert.equal(parse.kind, "gm_output_parse");
    assert.equal(parse.stage, "gm_output_parse");
    assert.equal(sanitizeTrpgFailureHint(parse), "GM 생성 실패 · GM output parse");
  });

  it("classifies provider failures as B and post-GM persist failures as C", () => {
    assert.equal(
      classifyTrpgStartFailure({
        error: new Error("[TRPG] 401: OPENROUTER"),
        reachedOpeningRound: true,
      }).class,
      "B"
    );
    assert.equal(
      classifyTrpgStartFailure({
        error: new Error("The operation was aborted due to timeout"),
        reachedOpeningRound: true,
      }).class,
      "B"
    );
    assert.equal(
      classifyTrpgStartFailure({
        error: new Error("no such table: trpg_gm_messages"),
        reachedOpeningRound: true,
        gmUsageCount: 1,
      }).class,
      "C"
    );
  });

  it("starts a world-only campaign and an authored scenario campaign", async () => {
    const db = memoryDb();
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => {
        gmCalls += 1;
        return { text: gmText(`장면 ${gmCalls}`) };
      },
    };
    const worldId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId: worldId, userId: 1, name: "렌", stats: EVEN_STATS });
    const world = await startTrpgCampaign(db, { campaignId: worldId, userId: 1, deps });
    assert.equal(world.round.phase, "ACTION_INPUT");
    assert.equal(loadCampaignContext(db, worldId)?.directorPlan, null);

    const templateId = insertScenarioTemplate(db, 7, {
      title: "폐역",
      summary: "유령 기차를 기다리는 공포 TRPG",
      content: "유령 기차를 기다린다.",
      visibility: "public",
      scenarioPlan: playablePlan,
    });
    const authoredId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      templateId,
    });
    saveTrpgSheet(db, { campaignId: authoredId, userId: 1, name: "렌", stats: EVEN_STATS });
    const authored = await startTrpgCampaign(db, { campaignId: authoredId, userId: 1, deps });
    assert.equal(authored.round.phase, "ACTION_INPUT");
    assert.equal(gmCalls, 2);
    assert.equal(loadCampaignContext(db, authoredId)?.directorPlan?.secret, "지휘관대체SECRETPLAN");
    db.close();
  });

  it("keeps missing sheets as class A and does not insert round 0", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    await assert.rejects(
      () => startTrpgCampaign(db, { campaignId, userId: 1, deps: { skipBilling: true } }),
      /시트를 만들어야/
    );
    const rounds = db.prepare(`SELECT COUNT(*) AS n FROM trpg_rounds WHERE campaign_id=?`).get(campaignId) as {
      n: number;
    };
    assert.equal(rounds.n, 0);
    db.close();
  });

  it("records opening GM provider failure as ERROR_RECOVERY class B", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await assert.rejects(
      () =>
        startTrpgCampaign(db, {
          campaignId,
          userId: 1,
          deps: {
            skipBilling: true,
            gmCall: async () => {
              throw new Error("[TRPG] 502: provider down");
            },
          },
        }),
      /provider down/
    );
    const row = db
      .prepare(`SELECT phase, error_json, usage_json FROM trpg_rounds WHERE campaign_id=? AND round_number=0`)
      .get(campaignId) as { phase: string; error_json: string; usage_json: string | null };
    assert.equal(row.phase, "ERROR_RECOVERY");
    const failure = parseTrpgStartFailureJson(row.error_json);
    assert.equal(failure?.class, "B");
    assert.equal(failure?.kind, "provider_http");
    assert.match(failure?.error ?? "", /provider down/);
    assert.equal(row.usage_json, null);
    db.close();
  });

  it("records a mid-round provider timeout as ERROR_RECOVERY with a sanitized host hint", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 16,
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 1) return { text: gmText() };
        if (gmCalls === 2) {
          throw attachTrpgCallFailureMeta(new Error("The operation was aborted due to timeout"), {
            elapsedMs: 180123,
          });
        }
        return { text: gmText("다시 진행한다.") };
      },
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "문을 민다." });
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(snap.round.phase, "ERROR_RECOVERY");
    assert.equal(snap.gmFailureHint, "GM 생성 실패 · Provider timeout (180초)");
    assert.doesNotMatch(snap.gmFailureHint ?? "", /aborted|sk-|SECRET|<<<NARRATION>>>/);
    const row = db
      .prepare(`SELECT error_json FROM trpg_rounds WHERE campaign_id=? AND round_number=1`)
      .get(campaignId) as { error_json: string };
    const failure = parseTrpgStartFailureJson(row.error_json);
    assert.equal(failure?.class, "B");
    assert.equal(failure?.kind, "provider_timeout");
    assert.equal(failure?.elapsedMs, 180123);
    assert.equal(failure?.trueOffRequested, true);
    const retried = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(gmCalls, 3);
    assert.equal(retried.round.phase, "ACTION_INPUT");
    db.close();
  });

  it("keeps stored parse_state JSON as a compatibility hint only", () => {
    assert.equal(
      sanitizeTrpgFailureHint({ class: "C", error: "legacy", kind: "parse_state" }),
      "GM 생성 실패 · Parse/state error"
    );
  });

  it("hides GM retry on billing failures and only recalls GM when no pending result exists", () => {
    const advance = fs.readFileSync("src/lib/trpg/engineAdvance.ts", "utf8");
    assert.match(advance, /hasPendingGmResult\(db, reconciledRound\.id\)/);
    assert.match(advance, /applyPendingGmResult/);
    assert.match(advance, /phase === "ERROR_RECOVERY"[\s\S]*runGmForRound/);
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /gmFailureKind === "billing_insufficient" \|\| snap.gmFailureKind === "billing_error"/);
    assert.match(room, /과금 다시 시도/);
    assert.match(room, /GM 다시 시도/);
    const billingStart = room.indexOf('gmFailureKind === "billing_insufficient"');
    const gmRetry = room.indexOf("GM 다시 시도");
    assert.ok(billingStart >= 0 && gmRetry > billingStart);
    const billingBlock = room.slice(billingStart, gmRetry);
    assert.match(billingBlock, /과금 다시 시도/);
    assert.match(billingBlock, /hasPendingGmResult/);
    assert.doesNotMatch(billingBlock, /disabled=\{busy \|\| !snap\.hasPendingGmResult\}/);
    assert.doesNotMatch(billingBlock, /GM 다시 시도/);
  });

  it("records post-GM persist failure as ERROR_RECOVERY class C", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const origPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string, ...rest: unknown[]) => {
      if (sql.includes("INSERT INTO trpg_gm_messages")) {
        throw new Error("no such table: trpg_gm_messages");
      }
      return origPrepare(sql, ...(rest as []));
    }) as typeof db.prepare;
    await assert.rejects(
      () =>
        startTrpgCampaign(db, {
          campaignId,
          userId: 1,
          deps: {
            skipBilling: true,
            gmCall: async () => ({ text: gmText() }),
          },
        }),
      /trpg_gm_messages/
    );
    const row = db
      .prepare(`SELECT phase, error_json, usage_json FROM trpg_rounds WHERE campaign_id=? AND round_number=0`)
      .get(campaignId) as { phase: string; error_json: string; usage_json: string | null };
    assert.equal(row.phase, "ERROR_RECOVERY");
    assert.equal(parseTrpgStartFailureJson(row.error_json)?.class, "C");
    assert.equal(parseTrpgStartFailureJson(row.error_json)?.kind, "persist_error");
    assert.equal(parseTrpgStartFailureJson(row.error_json)?.stage, "gm_persist");
    assert.match(row.usage_json ?? "", /deepseek-v4-pro|modelId/);
    db.close();
  });

  it("retries an ERROR_RECOVERY opening start without a second round 0", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 1) throw new Error("[TRPG] 503: busy");
        return { text: gmText("다시 시작했다.") };
      },
    };
    await assert.rejects(() => startTrpgCampaign(db, { campaignId, userId: 1, deps }), /busy/);
    const snap = await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(gmCalls, 2);
    assert.equal(snap.round.phase, "ACTION_INPUT");
    assert.match(snap.currentNarration ?? "", /다시 시작했다/);
    const rounds = db
      .prepare(`SELECT round_number, phase, error_json FROM trpg_rounds WHERE campaign_id=? ORDER BY round_number`)
      .all(campaignId) as Array<{ round_number: number; phase: string; error_json: string | null }>;
    assert.equal(rounds.filter((row) => row.round_number === 0).length, 1);
    assert.equal(rounds[0]?.phase, "ROUND_COMPLETE");
    assert.equal(rounds[0]?.error_json, null);
    db.close();
  });

  it("does not call flash 0731 when Sandbox Director is disabled", async () => {
    const prev = process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
    delete process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
    const db = memoryDb();
    db.exec(`
      CREATE TABLE worlds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        trpg_enabled INTEGER NOT NULL DEFAULT 0,
        trpg_visibility TEXT NOT NULL DEFAULT 'private',
        genres TEXT NOT NULL DEFAULT '[]',
        cover_url TEXT NOT NULL DEFAULT '',
        shared_from_nickname TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare(
      `INSERT INTO worlds (creator_id, name, content, trpg_enabled, trpg_visibility)
       VALUES (2, '북부', '얼음 마법', 1, 'public')`
    ).run();
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => ({ text: gmText() }),
    };
    try {
      assert.equal(isTrpgSandboxDirectorEnabled(), false);
      const campaignId = createTrpgCampaign(db, {
        hostUserId: 1,
        hostNickname: "렌",
        viewerUserId: 1,
        worldId: 1,
      });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, { campaignId, userId: 1, deps });
      assert.equal(loadCampaignContext(db, campaignId)?.directorPlan, null);
    } finally {
      if (prev === undefined) delete process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
      else process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = prev;
      db.close();
    }
  });
});
