import assert from "node:assert/strict";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  EVEN_STATS,
  createTrpgCampaign,
  saveTrpgSheet,
  writeSheet,
} from "./engineCreate";
import {
  advanceTrpgCampaign,
  startTrpgCampaign,
  submitTrpgAction,
} from "./engineAdvance";
import { insertOngoingEffect, loadOngoingEffects } from "./mechanicsStore";
import { loadPendingGmResult } from "./pendingGmResult";
import {
  applyPostGmOngoingSeeds,
  LEGACY_FULL_PROMOTION_READ_AS_SEED_ONLY,
  parsePostGmOngoingSeeds,
} from "./postGmOngoing";
import { ensureTrpgTables } from "./schema";
import { insertParticipant } from "./store";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function gmText(participantId?: number, conditions?: string[]): string {
  return buildTrpgGmStructuredWireText(participantId?: number, conditions?[], {
    players: [],
    location: "문턱",
    next_round_context: "다음",
    campaign_finished: false,
  });
}

async function setupSolo(
  db: Database.Database,
  hostUserId = 1
): Promise<{ campaignId: number; participantId: number }> {
  const campaignId = createTrpgCampaign(db, {
    hostUserId,
    hostNickname: `유저${hostUserId}`,
    viewerUserId: hostUserId,
  });
  saveTrpgSheet(db, {
    campaignId,
    userId: hostUserId,
    name: `PC${hostUserId}`,
    stats: EVEN_STATS,
  });
  await startTrpgCampaign(db, {
    campaignId,
    userId: hostUserId,
    deps: {
      skipBilling: true,
      gmCall: async () => ({ text: gmText() }),
    },
  });
  const row = db
    .prepare(
      `SELECT participant_id AS id FROM trpg_character_sheets WHERE campaign_id=?`
    )
    .get(campaignId) as { id: number };
  return { campaignId, participantId: row.id };
}

function addEffect(opts: {
  db: Database.Database;
  campaignId: number;
  participantId: number;
  stackKey: "poison" | "bleed";
  remainingTicks?: number;
}): number {
  const poison = opts.stackKey === "poison";
  return insertOngoingEffect(opts.db, {
    campaignId: opts.campaignId,
    participantId: opts.participantId,
    label: poison ? "중독" : "출혈",
    kind: "periodic_harm",
    severity: poison ? "MEDIUM" : "LIGHT",
    stackKey: opts.stackKey,
    stackPolicy: "refresh",
    sourceRound: 1,
    appliedRound: 1,
    startsRound: 2,
    tickClass: poison ? "MEDIUM" : "LIGHT",
    remainingTicks: opts.remainingTicks ?? 3,
    lastTickRound: null,
    recoveryMode: "save_or_treatment",
    recoveryStat: "res",
    treatmentMode: poison ? "specific_item" : "item_or_support",
    requiredItem: poison ? "특수해독제" : null,
    actionModifier: 0,
    metadata: {},
  });
}

function maliciousLegacy(participantId: number, effectId = 999) {
  return {
    participantId,
    family: "POISON",
    deduped: true,
    existingEffectId: effectId,
    existingUpdate: {
      id: effectId,
      severity: "CRITICAL",
      tickClass: "MEDIUM",
      remainingTicks: -1,
      recoveryMode: "persistent",
      recoveryStat: "cha",
      treatmentMode: "specific_item",
      requiredItem: "특수해독제",
      stackPolicy: "upgrade",
    },
    effect: {
      campaignId: 999,
      participantId,
      label: "임의",
      kind: "control",
      severity: "CRITICAL",
      stackKey: "poison",
      stackPolicy: "upgrade",
      sourceRound: 0,
      appliedRound: 0,
      startsRound: 0,
      tickClass: "MEDIUM",
      remainingTicks: -1,
      recoveryMode: "persistent",
      recoveryStat: "cha",
      treatmentMode: "specific_item",
      requiredItem: "특수해독제",
      actionModifier: -99,
      metadata: { injected: true },
    },
  };
}

describe("TRPG post-GM pending seed trust boundary", () => {
  it("A. drops a seed for a participant outside the current campaign", async () => {
    const db = memoryDb();
    const current = await setupSolo(db, 1);
    const other = await setupSolo(db, 2);
    const result = applyPostGmOngoingSeeds(db, {
      campaignId: current.campaignId,
      roundNumber: 7,
      seeds: [{ participantId: other.participantId, family: "POISON" }],
    });
    assert.equal(result.promoted, 0);
    assert.deepEqual(loadOngoingEffects(db, current.campaignId), []);
    assert.deepEqual(loadOngoingEffects(db, other.campaignId), []);
    db.close();
  });

  it("B. ignores every legacy mechanics field and rebuilds canonical current context", async () => {
    const db = memoryDb();
    const current = await setupSolo(db);
    const seeds = parsePostGmOngoingSeeds([
      maliciousLegacy(current.participantId),
    ]);
    applyPostGmOngoingSeeds(db, {
      campaignId: current.campaignId,
      roundNumber: 7,
      seeds,
    });
    const effect = loadOngoingEffects(db, current.campaignId)[0];
    assert.equal(effect?.campaignId, current.campaignId);
    assert.equal(effect?.participantId, current.participantId);
    assert.equal(effect?.label, "중독");
    assert.equal(effect?.kind, "periodic_harm");
    assert.equal(effect?.severity, "LIGHT");
    assert.equal(effect?.tickClass, "LIGHT");
    assert.equal(effect?.remainingTicks, 2);
    assert.equal(effect?.sourceRound, 7);
    assert.equal(effect?.appliedRound, 7);
    assert.equal(effect?.startsRound, 8);
    assert.equal(effect?.recoveryMode, "save_or_treatment");
    assert.equal(effect?.recoveryStat, "res");
    assert.equal(effect?.treatmentMode, "item_or_support");
    assert.equal(effect?.requiredItem, null);
    assert.equal(effect?.stackPolicy, "refresh");
    db.close();
  });

  it("C. cannot mutate an existingUpdate row owned by another participant", async () => {
    const db = memoryDb();
    const current = await setupSolo(db);
    const otherParticipant = insertParticipant(db, {
      campaignId: current.campaignId,
      slotIndex: 1,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "동료",
    });
    writeSheet(db, current.campaignId, otherParticipant, "동료", EVEN_STATS, "");
    const unrelatedId = addEffect({
      db,
      campaignId: current.campaignId,
      participantId: otherParticipant,
      stackKey: "bleed",
    });
    applyPostGmOngoingSeeds(db, {
      campaignId: current.campaignId,
      roundNumber: 7,
      seeds: parsePostGmOngoingSeeds([
        maliciousLegacy(current.participantId, unrelatedId),
      ]),
    });
    const unrelated = loadOngoingEffects(db, current.campaignId).find(
      (effect) => effect.id === unrelatedId
    );
    assert.equal(unrelated?.stackKey, "bleed");
    assert.equal(unrelated?.remainingTicks, 3);
    assert.equal(unrelated?.severity, "LIGHT");
    db.close();
  });

  it("D. cannot mutate an existingUpdate row owned by another campaign", async () => {
    const db = memoryDb();
    const current = await setupSolo(db, 1);
    const other = await setupSolo(db, 2);
    const unrelatedId = addEffect({
      db,
      campaignId: other.campaignId,
      participantId: other.participantId,
      stackKey: "bleed",
    });
    applyPostGmOngoingSeeds(db, {
      campaignId: current.campaignId,
      roundNumber: 7,
      seeds: parsePostGmOngoingSeeds([
        maliciousLegacy(current.participantId, unrelatedId),
      ]),
    });
    const unrelated = loadOngoingEffects(db, other.campaignId).find(
      (effect) => effect.id === unrelatedId
    );
    assert.equal(unrelated?.stackKey, "bleed");
    assert.equal(unrelated?.remainingTicks, 3);
    db.close();
  });

  it("E. persisted deduped=true cannot suppress a canonical new effect", async () => {
    const db = memoryDb();
    const current = await setupSolo(db);
    applyPostGmOngoingSeeds(db, {
      campaignId: current.campaignId,
      roundNumber: 7,
      seeds: parsePostGmOngoingSeeds([
        { ...maliciousLegacy(current.participantId), deduped: true },
      ]),
    });
    assert.equal(loadOngoingEffects(db, current.campaignId).length, 1);
    db.close();
  });

  it("F. current DB stack wins when persisted deduped=false", async () => {
    const db = memoryDb();
    const current = await setupSolo(db);
    const poisonId = addEffect({
      db,
      campaignId: current.campaignId,
      participantId: current.participantId,
      stackKey: "poison",
      remainingTicks: 1,
    });
    applyPostGmOngoingSeeds(db, {
      campaignId: current.campaignId,
      roundNumber: 7,
      seeds: parsePostGmOngoingSeeds([
        { ...maliciousLegacy(current.participantId), deduped: false },
      ]),
    });
    const poisons = loadOngoingEffects(db, current.campaignId).filter(
      (effect) => effect.stackKey === "poison"
    );
    assert.equal(poisons.length, 1);
    assert.equal(poisons[0]?.id, poisonId);
    assert.equal(poisons[0]?.remainingTicks, 2);
    assert.equal(poisons[0]?.severity, "MEDIUM");
    assert.equal(poisons[0]?.tickClass, "MEDIUM");
    assert.equal(poisons[0]?.treatmentMode, "specific_item");
    assert.equal(poisons[0]?.requiredItem, "특수해독제");
    db.close();
  });

  it("G. canonicalizes duplicate participant/family seeds to one operation", async () => {
    const db = memoryDb();
    const current = await setupSolo(db);
    const seeds = parsePostGmOngoingSeeds([
      { participantId: current.participantId, family: "POISON" },
      { participantId: current.participantId, family: "POISON" },
    ]);
    assert.equal(seeds.length, 1);
    applyPostGmOngoingSeeds(db, {
      campaignId: current.campaignId,
      roundNumber: 7,
      seeds,
    });
    assert.equal(loadOngoingEffects(db, current.campaignId).length, 1);
    db.close();
  });

  it("H. ignores invalid families", () => {
    assert.deepEqual(
      parsePostGmOngoingSeeds([
        { participantId: 1, family: "CURSE" },
        { participantId: 1, family: "" },
      ]),
      []
    );
  });

  it("I. reads legacy #523 full promotion as a minimal seed only", () => {
    assert.equal(LEGACY_FULL_PROMOTION_READ_AS_SEED_ONLY, true);
    assert.deepEqual(parsePostGmOngoingSeeds([maliciousLegacy(3, 99)]), [
      { participantId: 3, family: "POISON" },
    ]);
  });

  it("J. billing retry with malicious legacy pending uses canonical mechanics once", async () => {
    const db = memoryDb();
    const current = await setupSolo(db);
    let gmCalls = 0;
    submitTrpgAction(db, {
      campaignId: current.campaignId,
      userId: 1,
      body: "독성 구역을 통과한다.",
      actionType: "free",
    });
    await advanceTrpgCampaign(db, {
      campaignId: current.campaignId,
      userId: 1,
      deps: {
        skipBilling: false,
        billingFault: "pricing_quote",
        rollD20: () => 6,
        gmCall: async () => {
          gmCalls += 1;
          return { text: gmText(current.participantId, ["중독"]) };
        },
      },
    });
    const failedRound = db
      .prepare(
        `SELECT id, pending_gm_result_json AS pending
         FROM trpg_rounds WHERE campaign_id=? AND phase='ERROR_RECOVERY'`
      )
      .get(current.campaignId) as { id: number; pending: string };
    const pending = JSON.parse(failedRound.pending) as Record<string, unknown>;
    delete pending.postGmOngoingSeeds;
    pending.postGmOngoingPromotions = [
      maliciousLegacy(current.participantId, 999),
      maliciousLegacy(current.participantId, 998),
    ];
    db.prepare(
      `UPDATE trpg_rounds SET pending_gm_result_json=? WHERE id=?`
    ).run(JSON.stringify(pending), failedRound.id);
    const callsAfterFailure = gmCalls;

    await advanceTrpgCampaign(db, {
      campaignId: current.campaignId,
      userId: 1,
      deps: {
        skipBilling: true,
        gmCall: async () => {
          gmCalls += 1;
          throw new Error("must reuse pending result");
        },
      },
    });
    assert.equal(gmCalls, callsAfterFailure);
    const effects = loadOngoingEffects(db, current.campaignId);
    assert.equal(effects.length, 1);
    assert.equal(effects[0]?.campaignId, current.campaignId);
    assert.equal(effects[0]?.severity, "LIGHT");
    assert.equal(effects[0]?.remainingTicks, 2);
    assert.equal(effects[0]?.startsRound, 2);
    assert.equal(effects[0]?.requiredItem, null);
    assert.equal(loadPendingGmResult(db, failedRound.id), null);
    db.close();
  });
});
