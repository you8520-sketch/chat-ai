import assert from "node:assert/strict";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import {
  insertOngoingEffect,
  loadOngoingEffects,
} from "./mechanicsStore";
import { loadPendingGmResult } from "./pendingGmResult";
import {
  EXTRA_PROVIDER_CALLS,
  GM_OMISSION_CANNOT_CLEAR_ONGOING,
  NEW_ONGOING_STARTS_NEXT_ROUND,
  POST_GM_ONGOING_OWNER,
} from "./postGmOngoing";
import { ensureTrpgTables } from "./schema";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function gmText(opts: {
  participantId?: number;
  conditions?: string[];
  narration?: string;
} = {}): string {
  const players =
    opts.participantId == null
      ? []
      : [
          {
            participantId: opts.participantId,
            ...(opts.conditions == null ? {} : { conditions: opts.conditions }),
          },
        ];
  return buildTrpgGmStructuredWireText(opts.narration ?? "행동의 결과가 장면에 남는다.", {
  players,
  location: "폐허",
  next_round_context: "다음 선택",
  campaign_finished: false,
});
}

async function setupSolo(db: Database.Database): Promise<{
  campaignId: number;
  participantId: number;
}> {
  const campaignId = createTrpgCampaign(db, {
    hostUserId: 1,
    hostNickname: "렌",
    viewerUserId: 1,
  });
  saveTrpgSheet(db, {
    campaignId,
    userId: 1,
    name: "렌",
    stats: EVEN_STATS,
  });
  await startTrpgCampaign(db, {
    campaignId,
    userId: 1,
    deps: {
      skipBilling: true,
      gmCall: async () => ({ text: gmText({ narration: "시작 장면." }) }),
    },
  });
  const participant = db
    .prepare(
      `SELECT participant_id AS id FROM trpg_character_sheets WHERE campaign_id=?`
    )
    .get(campaignId) as { id: number };
  return { campaignId, participantId: participant.id };
}

async function playRound(
  db: Database.Database,
  opts: {
    campaignId: number;
    gmText: string;
    deps?: Partial<TrpgEngineDeps>;
    body?: string;
    actionType?: "attack" | "defend" | "investigate" | "support" | "use_item" | "free";
  }
) {
  submitTrpgAction(db, {
    campaignId: opts.campaignId,
    userId: 1,
    body: opts.body ?? "주변 상황에 대응한다.",
    actionType: opts.actionType ?? "investigate",
  });
  return advanceTrpgCampaign(db, {
    campaignId: opts.campaignId,
    userId: 1,
    deps: {
      skipBilling: true,
      rollD20: () => 6,
      rollDie: () => 3,
      gmCall: async () => ({ text: opts.gmText }),
      ...opts.deps,
    },
  });
}

function addExistingPoison(
  db: Database.Database,
  campaignId: number,
  participantId: number
): number {
  return insertOngoingEffect(db, {
    campaignId,
    participantId,
    label: "중독",
    kind: "periodic_harm",
    severity: "LIGHT",
    stackKey: "poison",
    stackPolicy: "refresh",
    sourceRound: 0,
    appliedRound: 0,
    startsRound: 99,
    tickClass: "LIGHT",
    remainingTicks: 2,
    lastTickRound: null,
    recoveryMode: "save_or_treatment",
    recoveryStat: "res",
    treatmentMode: "item_or_support",
    requiredItem: null,
    actionModifier: 0,
    metadata: {},
  });
}

describe("TRPG post-GM structured ongoing promotion V1", () => {
  it("exports server ownership and no-extra-call contracts", () => {
    assert.equal(POST_GM_ONGOING_OWNER, "SERVER");
    assert.equal(EXTRA_PROVIDER_CALLS, 0);
    assert.equal(NEW_ONGOING_STARTS_NEXT_ROUND, true);
    assert.equal(GM_OMISSION_CANNOT_CLEAR_ONGOING, true);
  });

  it("documents synthetic resolved-outcome QA separately from PRE_GM_RUNTIME_QA", () => {
    const resolvedQa = readFileSync(
      "scripts/trpg-mechanics-referee-effectiveness-qa.ts",
      "utf8"
    );
    const preGmQa = readFileSync(
      "scripts/trpg-mechanics-referee-pre-gm-runtime-qa.ts",
      "utf8"
    );
    const audit = readFileSync(
      "docs/audits/trpg-mechanics-referee-temporal-qa.md",
      "utf8"
    );
    assert.match(resolvedQa, /RESOLVED_OUTCOME_SYNTHETIC_QA/);
    assert.match(preGmQa, /PRE_GM_RUNTIME_QA/);
    assert.match(audit, /REFEREE_SCENE_SOURCE=previousNarration/);
    assert.match(audit, /CURRENT_GM_RESULT_AVAILABLE_TO_REFEREE=false/);
  });

  it("A. promotes a newly-added poison condition for next round", async () => {
    const db = memoryDb();
    const { campaignId, participantId } = await setupSolo(db);
    await playRound(db, {
      campaignId,
      gmText: gmText({ participantId, conditions: ["중독"] }),
    });
    const effects = loadOngoingEffects(db, campaignId);
    assert.equal(effects.length, 1);
    assert.equal(effects[0]?.kind, "periodic_harm");
    assert.equal(effects[0]?.stackKey, "poison");
    assert.equal(effects[0]?.severity, "LIGHT");
    assert.equal(effects[0]?.tickClass, "LIGHT");
    assert.equal(effects[0]?.sourceRound, 1);
    assert.equal(effects[0]?.appliedRound, 1);
    assert.equal(effects[0]?.startsRound, 2);
    assert.deepEqual(
      loadTrpgSnapshot(db, campaignId, 1)?.sheets.find(
        (card) => card.participantId === participantId
      )?.sheet.conditions,
      ["중독"]
    );
    db.close();
  });

  it("B. promotes bleeding with conservative periodic defaults", async () => {
    const db = memoryDb();
    const { campaignId, participantId } = await setupSolo(db);
    await playRound(db, {
      campaignId,
      gmText: gmText({ participantId, conditions: ["출혈"] }),
    });
    const effect = loadOngoingEffects(db, campaignId)[0];
    assert.equal(effect?.label, "출혈");
    assert.equal(effect?.kind, "periodic_harm");
    assert.equal(effect?.stackKey, "bleed");
    assert.equal(effect?.remainingTicks, 2);
    db.close();
  });

  it("C. promotes paralysis as LIGHT control", async () => {
    const db = memoryDb();
    const { campaignId, participantId } = await setupSolo(db);
    await playRound(db, {
      campaignId,
      gmText: gmText({ participantId, conditions: ["마비"] }),
    });
    const effect = loadOngoingEffects(db, campaignId)[0];
    assert.equal(effect?.label, "마비");
    assert.equal(effect?.kind, "control");
    assert.equal(effect?.stackKey, "paralysis");
    assert.equal(effect?.tickClass, null);
    assert.equal(effect?.actionModifier, -1);
    assert.equal(effect?.treatmentMode, "generic_support");
    db.close();
  });

  it("D. does not promote broad narrative conditions", async () => {
    const db = memoryDb();
    const { campaignId, participantId } = await setupSolo(db);
    await playRound(db, {
      campaignId,
      gmText: gmText({
        participantId,
        conditions: ["긴장", "피곤", "슬픔", "혼란", "배고픔", "젖음", "공포"],
      }),
    });
    assert.deepEqual(loadOngoingEffects(db, campaignId), []);
    db.close();
  });

  it("E. dedupes a newly-added narrative poison against active structured poison", async () => {
    const db = memoryDb();
    const { campaignId, participantId } = await setupSolo(db);
    const existingId = addExistingPoison(db, campaignId, participantId);
    db.prepare(
      `UPDATE trpg_ongoing_effects
       SET remaining_ticks=1, treatment_mode='specific_item', required_item='해독제'
       WHERE id=?`
    ).run(existingId);
    await playRound(db, {
      campaignId,
      gmText: gmText({ participantId, conditions: ["중독"] }),
    });
    const effects = loadOngoingEffects(db, campaignId).filter(
      (effect) => effect.stackKey === "poison"
    );
    assert.equal(effects.length, 1);
    assert.equal(effects[0]?.id, existingId);
    assert.equal(effects[0]?.remainingTicks, 2);
    assert.equal(effects[0]?.treatmentMode, "specific_item");
    assert.equal(effects[0]?.requiredItem, "해독제");
    db.close();
  });

  it("F. GM omission/removal cannot clear active structured poison", async () => {
    const db = memoryDb();
    const { campaignId, participantId } = await setupSolo(db);
    const existingId = addExistingPoison(db, campaignId, participantId);
    db.prepare(
      `UPDATE trpg_character_sheets SET conditions_json='["중독"]' WHERE participant_id=?`
    ).run(participantId);
    await playRound(db, {
      campaignId,
      gmText: gmText({ participantId, conditions: [] }),
    });
    assert.equal(
      loadOngoingEffects(db, campaignId).some(
        (effect) => effect.id === existingId && effect.remainingTicks !== 0
      ),
      true
    );
    db.close();
  });

  it("G. billing retry reuses pending promotion without a second GM call or duplicate", async () => {
    const db = memoryDb();
    const { campaignId, participantId } = await setupSolo(db);
    let gmCalls = 0;
    submitTrpgAction(db, {
      campaignId,
      userId: 1,
      body: "독성 구역을 통과한다.",
      actionType: "free",
    });
    const failed = await advanceTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: {
        skipBilling: false,
        billingFault: "pricing_quote",
        rollD20: () => 6,
        gmCall: async () => {
          gmCalls += 1;
          return { text: gmText({ participantId, conditions: ["중독"] }) };
        },
      },
    });
    assert.equal(failed.round.phase, "ERROR_RECOVERY");
    assert.equal(loadOngoingEffects(db, campaignId).length, 0);
    const failedRound = db
      .prepare(
        `SELECT id FROM trpg_rounds WHERE campaign_id=? AND phase='ERROR_RECOVERY'`
      )
      .get(campaignId) as { id: number };
    assert.equal(
      loadPendingGmResult(db, failedRound.id)?.postGmOngoingSeeds.length,
      1
    );
    const callsAfterFailure = gmCalls;

    const retried = await advanceTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: {
        skipBilling: true,
        gmCall: async () => {
          gmCalls += 1;
          throw new Error("GM must not be recalled");
        },
      },
    });
    assert.equal(retried.round.phase, "ACTION_INPUT");
    assert.equal(gmCalls, callsAfterFailure);
    assert.equal(
      loadOngoingEffects(db, campaignId).filter(
        (effect) => effect.stackKey === "poison"
      ).length,
      1
    );
    db.close();
  });

  it("H. GM failure applies no promoted ongoing", async () => {
    const db = memoryDb();
    const { campaignId } = await setupSolo(db);
    submitTrpgAction(db, {
      campaignId,
      userId: 1,
      body: "독사를 피한다.",
      actionType: "defend",
    });
    await advanceTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: {
        skipBilling: true,
        rollD20: () => 6,
        gmCall: async () => {
          throw new Error("GM provider failed");
        },
      },
    });
    assert.equal(loadOngoingEffects(db, campaignId).length, 0);
    db.close();
  });

  it("I. does not scrape poison from narration without a conditions delta", async () => {
    const db = memoryDb();
    const { campaignId } = await setupSolo(db);
    await playRound(db, {
      campaignId,
      gmText: gmText({
        narration: "독니가 살을 파고들었고 독이 퍼지기 시작했다.",
      }),
    });
    assert.equal(loadOngoingEffects(db, campaignId).length, 0);
    db.close();
  });

  it("J. promoted poison never ticks in its creation round and ticks next round", async () => {
    const db = memoryDb();
    const { campaignId, participantId } = await setupSolo(db);
    db.prepare(
      `UPDATE trpg_character_sheets SET hp=20 WHERE participant_id=?`
    ).run(participantId);
    await playRound(db, {
      campaignId,
      gmText: gmText({ participantId, conditions: ["중독"] }),
      deps: { rollDie: () => 3, rollD20: () => 1 },
    });
    const afterCreation = loadTrpgSnapshot(db, campaignId, 1);
    assert.equal(
      afterCreation?.sheets.find((card) => card.participantId === participantId)
        ?.sheet.hp,
      20
    );
    const created = loadOngoingEffects(db, campaignId)[0];
    assert.equal(created?.lastTickRound, null);
    assert.equal(created?.startsRound, 2);

    await playRound(db, {
      campaignId,
      gmText: gmText({ participantId, conditions: ["중독"] }),
      deps: { rollDie: () => 3, rollD20: () => 1 },
    });
    const afterNextRound = loadTrpgSnapshot(db, campaignId, 1);
    assert.ok(
      (afterNextRound?.sheets.find(
        (card) => card.participantId === participantId
      )?.sheet.hp ?? 20) < 20
    );
    db.close();
  });
});
