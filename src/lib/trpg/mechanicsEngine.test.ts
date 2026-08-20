import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { insertOngoingEffect, loadLatestCompleteMechanics, loadMechanicsResolution, loadOngoingEffects } from "./mechanicsStore";
import { TRPG_MECHANICS_REFEREE_ENABLED_ENV } from "./mechanicsTypes";
import { ensureTrpgTables } from "./schema";
import { insertParticipant } from "./store";

function gmText(opts?: { hp?: number; participantId?: number; narration?: string; conditions?: string[] }): string {
  const players =
    opts?.participantId != null
      ? [{ participantId: opts.participantId, hp: opts.hp, conditions: opts.conditions ?? [] }]
      : [];
  return `<<<NARRATION>>>
${opts?.narration ?? "전장이 흔들린다. 칼날이 스친다."}
<<<DELTA>>>
${JSON.stringify({
  players,
  location: "폐허",
  next_round_context: "계속 싸울지",
  campaign_finished: false,
})}`;
}

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

async function withReferee<T>(enabled: boolean, fn: () => Promise<T> | T): Promise<T> {
  const prev = process.env[TRPG_MECHANICS_REFEREE_ENABLED_ENV];
  process.env[TRPG_MECHANICS_REFEREE_ENABLED_ENV] = enabled ? "1" : "0";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[TRPG_MECHANICS_REFEREE_ENABLED_ENV];
    else process.env[TRPG_MECHANICS_REFEREE_ENABLED_ENV] = prev;
  }
}

function hostSheet(db: Database.Database, campaignId: number): { id: number; hp: number; maxHp: number } {
  const row = db
    .prepare(
      `SELECT participant_id AS id, hp, max_hp AS maxHp
       FROM trpg_character_sheets
       WHERE campaign_id=?
       ORDER BY id ASC
       LIMIT 1`
    )
    .get(campaignId) as { id: number; hp: number; maxHp: number };
  return row;
}

function flashHarm(participantId: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    effects: [
      {
        participantId,
        directEffect: "harm",
        directClass: "HEAVY",
        cause: "enemy_counter",
        ...extra,
      },
    ],
  });
}

async function setupParty(
  db: Database.Database,
  deps: TrpgEngineDeps
): Promise<{ campaignId: number; hostId: number; yuna: number; kai: number }> {
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const yuna = insertParticipant(db, {
    campaignId,
    slotIndex: 1,
    kind: "ai_character",
    userId: null,
    characterId: null,
    displayName: "유나",
  });
  const kai = insertParticipant(db, {
    campaignId,
    slotIndex: 2,
    kind: "ai_character",
    userId: null,
    characterId: null,
    displayName: "카이",
  });
  writeSheet(db, campaignId, yuna, "유나", EVEN_STATS, "");
  writeSheet(db, campaignId, kai, "카이", EVEN_STATS, "");
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  return { campaignId, hostId: hostSheet(db, campaignId).id, yuna, kai };
}

describe("TRPG mechanics referee — engine retry / commit", () => {
  it("V/W. GM failure after damage dice leaves HP unchanged and retry reuses the same roll", async () => {
    await withReferee(true, async () => {
      const db = memoryDb();
      let gmCalls = 0;
      let flashCalls = 0;
      const hostIdRef = { id: 0 };
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        rollD20: () => 6,
        rollDie: () => 5,
        mechanicsCall: async () => {
          flashCalls += 1;
          return { text: flashHarm(hostIdRef.id), model: "deepseek-v4-flash-0731", latencyMs: 9 };
        },
        gmCall: async () => {
          gmCalls += 1;
          if (gmCalls === 2) throw new Error("GM provider down");
          return { text: gmText({ participantId: hostIdRef.id, hp: 40, narration: "칼날이 부딪친다." }) };
        },
        botCall: async (_system, user) => ({
          text: user.includes("유나") ? "유나가 방패를 든다." : "카이가 측면을 노린다.",
        }),
      };
      const { campaignId, hostId } = await setupParty(db, deps);
      hostIdRef.id = hostId;
      const before = hostSheet(db, campaignId).hp;
      submitTrpgAction(db, { campaignId, userId: 1, body: "검으로 벤다.", actionType: "attack" });
      const failed = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
      assert.equal(failed.round.phase, "ERROR_RECOVERY");
      assert.equal(hostSheet(db, campaignId).hp, before);
      const stored = loadLatestCompleteMechanics(db, campaignId);
      assert.ok(stored);
      assert.equal(stored!.complete, true);
      assert.equal(stored!.applied, false);
      const amount = stored!.actors.find((row) => row.participantId === hostId)?.direct?.dice?.amount;
      assert.ok((amount ?? 0) > 0);
      const retried = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
      assert.equal(retried.round.phase, "ACTION_INPUT");
      assert.equal(flashCalls, 1);
      assert.equal(hostSheet(db, campaignId).hp, before - (amount ?? 0));
      const reused = loadLatestCompleteMechanics(db, campaignId);
      assert.equal(reused?.actors.find((row) => row.participantId === hostId)?.direct?.dice?.amount, amount);
      db.close();
    });
  });

  it("X. billing failure reuses the same mechanics and does not double-apply", async () => {
    await withReferee(true, async () => {
      const db = memoryDb();
      const hostIdRef = { id: 0 };
      let flashCalls = 0;
      const base: TrpgEngineDeps = {
        skipBilling: false,
        billingFault: "pricing_quote",
        rollD20: () => 6,
        rollDie: () => 5,
        mechanicsCall: async () => {
          flashCalls += 1;
          return { text: flashHarm(hostIdRef.id), model: "deepseek-v4-flash-0731" };
        },
        gmCall: async () => ({ text: gmText({ participantId: hostIdRef.id, hp: 12, narration: "과금 전 장면." }) }),
        botCall: async () => ({ text: "유나가 거리를 벌린다." }),
      };
      const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: { ...base, skipBilling: true, billingFault: undefined },
      });
      hostIdRef.id = hostSheet(db, campaignId).id;
      const before = hostSheet(db, campaignId).hp;
      submitTrpgAction(db, { campaignId, userId: 1, body: "근접으로 벤다.", actionType: "attack" });
      const failed = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: base });
      assert.equal(failed.round.phase, "ERROR_RECOVERY");
      assert.equal(hostSheet(db, campaignId).hp, before);
      const first = loadLatestCompleteMechanics(db, campaignId);
      const amount = first?.actors[0]?.direct?.dice?.amount;
      const retry = await advanceTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: { ...base, skipBilling: true, billingFault: undefined },
      });
      assert.equal(retry.round.phase, "ACTION_INPUT");
      assert.equal(flashCalls, 1);
      assert.equal(hostSheet(db, campaignId).hp, before - (amount ?? 0));
      db.close();
    });
  });

  it("Y/Z. mechanics HP wins and structured poison survives omitted GM conditions", async () => {
    await withReferee(true, async () => {
      const db = memoryDb();
      const hostIdRef = { id: 0 };
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        rollD20: () => 6,
        rollDie: () => 4,
        mechanicsCall: async () => ({
          text: flashHarm(hostIdRef.id, {
            ongoingAdd: [
              {
                label: "중독",
                kind: "periodic_harm",
                severity: "LIGHT",
                tickClass: "LIGHT",
                durationBand: "SHORT",
                recoveryMode: "save_or_treatment",
                recoveryStat: "res",
                treatmentMode: "item_or_support",
                stackKey: "poison",
              },
            ],
          }),
          model: "deepseek-v4-flash-0731",
        }),
        gmCall: async () => ({
          text: gmText({
            participantId: hostIdRef.id,
            hp: 40,
            conditions: ["긴장"],
            narration: "독기가 스민다.",
          }),
        }),
        botCall: async () => ({ text: "유나가 거리를 본다." }),
      };
      const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, { campaignId, userId: 1, deps });
      hostIdRef.id = hostSheet(db, campaignId).id;
      const before = hostSheet(db, campaignId).hp;
      submitTrpgAction(db, { campaignId, userId: 1, body: "적에게 돌진한다.", actionType: "attack" });
      const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
      const sheet = hostSheet(db, campaignId);
      assert.notEqual(sheet.hp, before);
      assert.notEqual(sheet.hp, 40);
      const effects = loadOngoingEffects(db, campaignId);
      assert.equal(effects.some((row) => row.label === "중독" && row.participantId === hostIdRef.id), true);
      const conditions = JSON.parse(
        (
          db
            .prepare(`SELECT conditions_json FROM trpg_character_sheets WHERE participant_id=?`)
            .get(hostIdRef.id) as { conditions_json: string }
        ).conditions_json
      ) as string[];
      assert.deepEqual(conditions, ["긴장"]);
      assert.ok(after.ongoingEffects?.some((row) => row.label === "중독"));
      db.close();
    });
  });

  it("AA/AB. completed history does not retick and HP 0 incapacitates", async () => {
    await withReferee(true, async () => {
      const db = memoryDb();
      const hostIdRef = { id: 0 };
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        rollD20: () => 3,
        rollDie: () => 8,
        mechanicsCall: async () => ({ text: flashHarm(hostIdRef.id), model: "deepseek-v4-flash-0731" }),
        gmCall: async () => ({ text: gmText({ participantId: hostIdRef.id, hp: 1, narration: "쓰러진다." }) }),
      };
      const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
      saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      await startTrpgCampaign(db, { campaignId, userId: 1, deps });
      hostIdRef.id = hostSheet(db, campaignId).id;
      db.prepare(`UPDATE trpg_character_sheets SET hp=2 WHERE participant_id=?`).run(hostIdRef.id);
      insertOngoingEffect(db, {
        campaignId,
        participantId: hostIdRef.id,
        label: "중독",
        kind: "periodic_harm",
        severity: "LIGHT",
        stackKey: "poison",
        stackPolicy: "refresh",
        sourceRound: 0,
        appliedRound: 0,
        startsRound: 1,
        tickClass: "LIGHT",
        remainingTicks: 3,
        lastTickRound: null,
        recoveryMode: "save_or_treatment",
        recoveryStat: "res",
        treatmentMode: "item_or_support",
        requiredItem: null,
        actionModifier: 0,
        metadata: {},
      });
      submitTrpgAction(db, { campaignId, userId: 1, body: "무리해서 벤다.", actionType: "attack" });
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
      assert.equal(hostSheet(db, campaignId).hp, 0);
      const status = db
        .prepare(`SELECT status, can_act FROM trpg_participants WHERE id=?`)
        .get(hostIdRef.id) as { status: string; can_act: number };
      assert.equal(status.status, "incapacitated");
      assert.equal(status.can_act, 0);
      const first = loadLatestCompleteMechanics(db, campaignId);
      const ticks = first?.ongoingTicks.length ?? 0;
      const roundId = first?.roundId;
      assert.ok(roundId);
      const again = loadMechanicsResolution(db, roundId!);
      assert.equal(again?.ongoingTicks.length, ticks);
      const effects = loadOngoingEffects(db, campaignId);
      assert.ok(effects.every((row) => row.lastTickRound === first?.roundNumber || row.remainingTicks === 0));
      db.close();
    });
  });

  it("QA fixture: 1H+2Bot combat reports one Flash call, server dice, and no double apply", async () => {
    await withReferee(true, async () => {
      const db = memoryDb();
      let flashCalls = 0;
      const hostIdRef = { id: 0 };
      const report = {
        FLASH_CALLS_PER_ROUND: 0,
        SERVER_DAMAGE_ROLLS: 0,
        ONGOING_TICKS: 0,
        RECOVERY_ROLLS: 0,
        FINAL_HP: 0,
        NO_DOUBLE_APPLY: true,
      };
      const deps: TrpgEngineDeps = {
        skipBilling: true,
        rollD20: () => 7,
        rollDie: () => 3,
        mechanicsCall: async () => {
          flashCalls += 1;
          return {
            text: JSON.stringify({
              effects: [
                {
                  participantId: hostIdRef.id,
                  directEffect: "harm",
                  directClass: "HEAVY",
                  cause: "enemy_counter",
                  ongoingAdd: [
                    {
                      label: "중독",
                      kind: "periodic_harm",
                      severity: "LIGHT",
                      tickClass: "LIGHT",
                      durationBand: "SHORT",
                      recoveryMode: "save_or_treatment",
                      recoveryStat: "res",
                      treatmentMode: "item_or_support",
                      stackKey: "poison",
                    },
                    {
                      label: "마비",
                      kind: "control",
                      severity: "LIGHT",
                      durationBand: "SHORT",
                      recoveryMode: "save_or_treatment",
                      recoveryStat: "res",
                      treatmentMode: "generic_support",
                      stackKey: "paralysis",
                    },
                  ],
                },
              ],
            }),
            model: "deepseek-v4-flash-0731",
          };
        },
        gmCall: async () => ({ text: gmText({ participantId: hostIdRef.id, hp: 39, narration: "독과 마비가 스친다." }) }),
        botCall: async (_system, user) => ({
          text: user.includes("유나") ? "유나가 측면을 친다." : "카이가 엄호한다.",
        }),
      };
      const { campaignId, hostId } = await setupParty(db, deps);
      hostIdRef.id = hostId;
      submitTrpgAction(db, { campaignId, userId: 1, body: "전열에서 벤다.", actionType: "attack" });
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
      const r1 = loadLatestCompleteMechanics(db, campaignId);
      assert.equal(r1?.observability.FLASH_CALLS_PER_ROUND, 1);
      assert.equal(flashCalls, 1);
      assert.ok((r1?.actors[0]?.direct?.dice?.amount ?? 0) > 0);
      assert.ok(loadOngoingEffects(db, campaignId).some((row) => row.label === "중독"));
      const healDeps: TrpgEngineDeps = {
        ...deps,
        rollD20: () => 16,
        mechanicsCall: async () => {
          flashCalls += 1;
          return {
            text: JSON.stringify({
              effects: [
                {
                  participantId: hostId,
                  directEffect: "heal",
                  directClass: "LIGHT",
                  cause: "healing",
                },
              ],
            }),
            model: "deepseek-v4-flash-0731",
          };
        },
      };
      submitTrpgAction(db, { campaignId, userId: 1, body: "상처를 치료한다.", actionType: "support" });
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: healDeps });
      const r2 = loadLatestCompleteMechanics(db, campaignId);
      assert.equal(r2?.observability.FLASH_CALLS_PER_ROUND, 1);
      assert.equal(flashCalls, 2);
      assert.ok((r2?.ongoingTicks.length ?? 0) >= 1);
      assert.ok((r2?.recoveries.length ?? 0) >= 1);
      report.FLASH_CALLS_PER_ROUND = 1;
      report.SERVER_DAMAGE_ROLLS = (r1?.actors.filter((row) => row.direct?.dice).length ?? 0) + (r2?.ongoingTicks.length ?? 0);
      report.ONGOING_TICKS = r2?.ongoingTicks.length ?? 0;
      report.RECOVERY_ROLLS = r2?.recoveries.length ?? 0;
      report.FINAL_HP = hostSheet(db, campaignId).hp;
      report.NO_DOUBLE_APPLY = flashCalls === 2 && (r2?.ongoingTicks.length ?? 0) === 1;
      assert.equal(report.FLASH_CALLS_PER_ROUND, 1);
      assert.ok(report.SERVER_DAMAGE_ROLLS >= 2);
      assert.ok(report.ONGOING_TICKS >= 1);
      assert.ok(report.RECOVERY_ROLLS >= 1);
      assert.ok(report.FINAL_HP > 0);
      assert.equal(report.NO_DOUBLE_APPLY, true);
      console.info("[trpg-mechanics-qa]", report);
      db.close();
    });
  });
});
