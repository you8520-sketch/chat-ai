import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import Database from "better-sqlite3";
import { parseStoredInventory } from "./inventory";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
} from "./engineAdvance";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { mergeMechanicsOwnedDelta } from "./mechanicsMerge";
import { resolveRoundMechanics } from "./mechanicsResolve";
import type { MechanicsActorInput, MechanicsResolution, TrpgOngoingEffect } from "./mechanicsTypes";
import { ensureTrpgTables } from "./schema";
import {
  evaluateThreatShadow,
  type ThreatShadowActor,
  type ThreatShadowReport,
} from "./threatShadow";
import type { TrpgSheetSnapshot, TrpgStateDelta } from "./types";

function sheet(participantId: number, partial: Partial<TrpgSheetSnapshot> = {}): TrpgSheetSnapshot {
  return {
    participantId,
    name: `PC${participantId}`,
    playerName: `P${participantId}`,
    level: 1,
    hp: 30,
    maxHp: 30,
    stats: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, res: 8 },
    conditions: [],
    inventory: parseStoredInventory([]),
    location: "",
    modifiersNote: "",
    ...partial,
  };
}

function actor(
  participantId: number,
  partial: Partial<MechanicsActorInput> = {}
): MechanicsActorInput {
  return {
    participantId,
    name: `PC${participantId}`,
    actionType: "free",
    body: "골목 소리를 듣는다",
    tier: "SUCCESS",
    d20: 14,
    modifier: 1,
    finalScore: 15,
    dc: 12,
    statKey: "str",
    ...partial,
  };
}

function poison(participantId: number): TrpgOngoingEffect {
  return {
    id: 10,
    campaignId: 1,
    participantId,
    label: "중독",
    kind: "periodic_harm",
    severity: "MEDIUM",
    stackKey: "poison",
    stackPolicy: "refresh",
    sourceRound: 5,
    appliedRound: 5,
    startsRound: 6,
    tickClass: "LIGHT",
    remainingTicks: 3,
    lastTickRound: null,
    recoveryMode: "treatment",
    recoveryStat: "res",
    treatmentMode: "generic_support",
    requiredItem: null,
    actionModifier: 0,
    metadata: {},
  };
}

type Scenario = {
  sheets: TrpgSheetSnapshot[];
  actors: MechanicsActorInput[];
  gmPlayers: Array<{ participantId: number; hp?: number }>;
  npcsAdd?: string[];
  authored?: string[];
  ledger?: string[];
  effects?: TrpgOngoingEffect[];
};

type Outcome = {
  mechanics: MechanicsResolution;
  merged: TrpgSheetSnapshot[];
  report: ThreatShadowReport;
  withoutShadow: TrpgSheetSnapshot[];
};

/** Referee OFF (production default): fallback gm_legacy, calledFlash=false. */
function run(s: Scenario): Outcome {
  const mechanics = resolveRoundMechanics({
    campaignId: 1,
    roundId: 900,
    roundNumber: 6,
    sheets: s.sheets,
    effects: s.effects ?? [],
    actors: s.actors,
    flash: null,
    fallback: "gm_legacy",
    calledFlash: false,
    model: null,
    latencyMs: 0,
    baseDc: 12,
    rng: () => 4,
    recoveryRng: () => 1,
    scene: "적대적 위협이 눈앞에 있다.",
  });
  const delta = { players: s.gmPlayers, npcsAdd: s.npcsAdd } as TrpgStateDelta;
  const merged = mergeMechanicsOwnedDelta(s.sheets, delta, mechanics);
  assert.equal(merged.ok, true);
  if (!merged.ok) throw new Error("merge failed");
  const shadowActors: ThreatShadowActor[] = s.actors.map((row) => ({
    participantId: row.participantId,
    actionType: row.actionType,
    body: row.body,
    tier: row.tier,
  }));
  const frozen = JSON.stringify({ sheets: s.sheets, delta, mechanics });
  const report = evaluateThreatShadow({
    roundId: 900,
    roundNumber: 6,
    startSheets: s.sheets,
    appliedSheets: merged.next,
    gmDelta: delta,
    mechanics,
    actors: shadowActors,
    authoredNpcNames: s.authored ?? [],
    ledgerNpcNames: s.ledger ?? [],
  });
  assert.equal(JSON.stringify({ sheets: s.sheets, delta, mechanics }), frozen, "shadow must not mutate inputs");
  const again = mergeMechanicsOwnedDelta(s.sheets, delta, mechanics);
  assert.equal(again.ok, true);
  return { mechanics, merged: merged.next, report, withoutShadow: again.ok ? again.next : [] };
}

function hp(rows: TrpgSheetSnapshot[], id: number): number {
  return rows.find((row) => row.participantId === id)!.hp;
}

function claimOf(report: ThreatShadowReport, id: number) {
  const claim = report.claims.find((row) => row.targetParticipantId === id);
  assert.ok(claim, `claim for ${id}`);
  return claim;
}

describe("Slice 1a threat shadow — classification (no HP/state change)", () => {
  it("1. listen + GM false HP drop → UNGROUNDED, no candidate; legacy HP application untouched", () => {
    const out = run({
      sheets: [sheet(1)],
      actors: [actor(1)],
      gmPlayers: [{ participantId: 1, hp: 8 }],
      authored: ["도적"],
    });
    const claim = claimOf(out.report, 1);
    assert.equal(claim.grounding, "UNGROUNDED");
    assert.equal(claim.verdict, "NO_SERVER_BASIS");
    assert.equal(claim.insufficientGrounding, true);
    assert.equal(claim.divergence, true);
    assert.equal(out.report.candidates.length, 0);
    assert.deepEqual(out.report.policyOpen, ["AUTONOMOUS_THREAT_UNVERIFIABLE"]);
    assert.equal(hp(out.merged, 1), 8, "GM_LEGACY keeps applying the GM HP in Slice 1a");
    assert.equal(claim.appliedGmDropHp, 22);
    assert.deepEqual(out.merged, out.withoutShadow);
  });

  it("2. legitimate NPC counter (failed attack on authored NPC) → server candidate within envelope", () => {
    const out = run({
      sheets: [sheet(1)],
      actors: [actor(1, { actionType: "attack", body: "도적을 공격한다", tier: "FAILURE" })],
      gmPlayers: [{ participantId: 1, hp: 22 }],
      authored: ["도적"],
      ledger: ["도적"],
    });
    const claim = claimOf(out.report, 1);
    assert.equal(claim.grounding, "AUTHORED");
    assert.equal(claim.verdict, "CANDIDATE_WITHIN_ENVELOPE");
    assert.equal(claim.neededClass, "HEAVY");
    assert.equal(claim.divergence, false);
    assert.deepEqual(claim.candidateSources, [1]);
    assert.equal(out.report.candidates[0]?.boundNpc, "도적");
    assert.equal(hp(out.merged, 1), 22);
  });

  it("2b. ledger-only NPC → ESTABLISHED; unnamed engagement → CURRENT_CHECK", () => {
    const established = run({
      sheets: [sheet(1)],
      actors: [actor(1, { actionType: "attack", body: "그림자를 공격한다", tier: "FAILURE" })],
      gmPlayers: [{ participantId: 1, hp: 25 }],
      ledger: ["그림자"],
    });
    assert.equal(claimOf(established.report, 1).grounding, "ESTABLISHED");
    const unnamed = run({
      sheets: [sheet(1)],
      actors: [actor(1, { actionType: "attack", body: "앞을 막는 자를 공격한다", tier: "FAILURE" })],
      gmPlayers: [{ participantId: 1, hp: 25 }],
    });
    assert.equal(claimOf(unnamed.report, 1).grounding, "CURRENT_CHECK");
  });

  it("3. GM omits damage number → server candidate preserved and flagged gmOmitted; HP unchanged", () => {
    const out = run({
      sheets: [sheet(1)],
      actors: [actor(1, { actionType: "attack", body: "도적을 공격한다", tier: "FAILURE" })],
      gmPlayers: [],
      authored: ["도적"],
    });
    assert.equal(out.report.claims.length, 0);
    assert.equal(out.report.candidates.length, 1);
    assert.equal(out.report.candidates[0]?.gmOmitted, true);
    assert.equal(out.report.candidates[0]?.expression, "1d8");
    assert.equal(hp(out.merged, 1), 30, "H2 stays as is: nothing is applied by the shadow");
  });

  it("4. attack on a nonexistent NPC never produces an HP approval candidate", () => {
    const listened = run({
      sheets: [sheet(1)],
      actors: [actor(1)],
      gmPlayers: [{ participantId: 1, hp: 10 }],
      authored: ["도적"],
      ledger: ["도적"],
    });
    assert.equal(listened.report.candidates.length, 0);
    assert.equal(claimOf(listened.report, 1).verdict, "NO_SERVER_BASIS");
    const oversized = run({
      sheets: [sheet(1)],
      actors: [actor(1, { actionType: "attack", body: "도적을 공격한다", tier: "SUCCESS" })],
      gmPlayers: [{ participantId: 1, hp: 20 }],
      authored: ["도적"],
    });
    const claim = claimOf(oversized.report, 1);
    assert.equal(claim.verdict, "CANDIDATE_EXCEEDS_ENVELOPE");
    assert.equal(claim.neededClass, "SEVERE");
    assert.equal(claim.singleMaxHp, 2);
  });

  it("5. existing trap exposure (human + failed check) is grounded; GM-invented trap on a plain action is not", () => {
    const grounded = run({
      sheets: [sheet(1)],
      actors: [actor(1, { body: "함정이 깔린 복도를 지나간다", tier: "FAILURE" })],
      gmPlayers: [{ participantId: 1, hp: 26 }],
    });
    const claim = claimOf(grounded.report, 1);
    assert.equal(claim.grounding, "CURRENT_CHECK");
    assert.equal(claim.verdict, "CANDIDATE_WITHIN_ENVELOPE");
    const invented = run({
      sheets: [sheet(1)],
      actors: [actor(1, { body: "복도를 걷는다", tier: "FAILURE" })],
      gmPlayers: [{ participantId: 1, hp: 26 }],
    });
    assert.equal(claimOf(invented.report, 1).grounding, "UNGROUNDED");
    assert.equal(invented.report.candidates.length, 0);
  });

  it("6. GM claims a new threat and damage in the same round → no self-approval", () => {
    const out = run({
      sheets: [sheet(1)],
      actors: [actor(1)],
      gmPlayers: [{ participantId: 1, hp: 20 }],
      npcsAdd: ["어둠 속 괴물"],
      authored: ["도적"],
    });
    const claim = claimOf(out.report, 1);
    assert.equal(claim.grounding, "GM_PROPOSAL");
    assert.equal(claim.verdict, "NO_SELF_APPROVAL_NEW_THREAT");
    assert.equal(claim.newThreatThisRound, true);
    assert.equal(out.report.candidates.length, 0);
    const knownNpc = run({
      sheets: [sheet(1)],
      actors: [actor(1)],
      gmPlayers: [{ participantId: 1, hp: 20 }],
      npcsAdd: ["도적"],
      authored: ["도적"],
    });
    assert.equal(claimOf(knownNpc.report, 1).grounding, "UNGROUNDED");
  });

  it("7. 2 human + 2 AI seats are independent damage targets", () => {
    const sheets = [1, 2, 3, 4].map((id) => sheet(id));
    const out = run({
      sheets,
      actors: [
        actor(1, { actionType: "attack", body: "적을 공격한다", tier: "FAILURE" }),
        actor(2, { actionType: "attack", body: "적을 공격한다", tier: "SUCCESS" }),
        actor(3, { actionType: "attack", body: "적을 공격한다", tier: "PARTIAL_SUCCESS" }),
        actor(4, { actionType: "attack", body: "적을 공격한다", tier: "FAILURE" }),
      ],
      gmPlayers: [
        { participantId: 1, hp: 24 },
        { participantId: 2, hp: 24 },
        { participantId: 3, hp: 26 },
        { participantId: 4, hp: 28 },
      ],
    });
    assert.equal(out.report.claims.length, 4);
    assert.equal(new Set(out.report.claims.map((row) => row.eventKey)).size, 4);
    for (const id of [1, 2, 3, 4]) {
      const claim = claimOf(out.report, id);
      assert.equal(claim.candidateBasis, "SELF");
      assert.deepEqual(claim.candidateSources, [id]);
    }
    assert.equal(claimOf(out.report, 1).verdict, "CANDIDATE_WITHIN_ENVELOPE");
    assert.equal(claimOf(out.report, 2).verdict, "CANDIDATE_EXCEEDS_ENVELOPE");
    assert.equal(claimOf(out.report, 3).verdict, "CANDIDATE_WITHIN_ENVELOPE");
    assert.equal(claimOf(out.report, 4).verdict, "CANDIDATE_WITHIN_ENVELOPE");
    assert.deepEqual(out.report.policyOpen, []);
  });

  it("8a. multi-attack on one target is reported as combined-envelope policy-open, not silently capped", () => {
    const out = run({
      sheets: [sheet(1), sheet(2), sheet(3)],
      actors: [
        actor(1, { actionType: "attack", body: "적을 공격한다", tier: "FAILURE" }),
        actor(2),
        actor(3, { actionType: "attack", body: "적을 공격한다", tier: "FAILURE" }),
      ],
      gmPlayers: [{ participantId: 2, hp: 16 }],
    });
    const claim = claimOf(out.report, 2);
    assert.equal(claim.candidateBasis, "OTHER_ACTOR");
    assert.deepEqual(claim.candidateSources, [1, 3]);
    assert.equal(claim.singleMaxHp, 8);
    assert.equal(claim.combinedMaxHp, 16);
    assert.equal(claim.verdict, "CANDIDATE_NEEDS_MULTI_SOURCE");
    assert.deepEqual(out.report.policyOpen, ["MULTI_SOURCE_SAME_TARGET"]);
  });

  it("8b. one source hitting several targets (area) is reported as policy-open", () => {
    const out = run({
      sheets: [sheet(1), sheet(2), sheet(3)],
      actors: [actor(1, { actionType: "attack", body: "폭발물을 던진다", tier: "FAILURE" }), actor(2), actor(3)],
      gmPlayers: [
        { participantId: 2, hp: 26 },
        { participantId: 3, hp: 26 },
      ],
    });
    assert.deepEqual(out.report.policyOpen, ["ONE_SOURCE_MULTI_TARGET"]);
    assert.equal(out.report.candidates[0]?.boundTargets.length, 2);
  });

  it("9. existing DOT is server-explained; GM hp equal to server tick is not a GM claim to approve", () => {
    const hurt = sheet(1);
    const out = run({
      sheets: [hurt],
      actors: [actor(1)],
      gmPlayers: [{ participantId: 1, hp: 29 }],
      effects: [poison(1)],
    });
    assert.ok(out.mechanics.ongoingTicks.length > 0);
    const tick = out.mechanics.ongoingTicks[0]!;
    const drop = tick.hpBefore - tick.hpAfter;
    assert.ok(drop > 0);
    const claim = claimOf(
      run({
        sheets: [hurt],
        actors: [actor(1)],
        gmPlayers: [{ participantId: 1, hp: 30 - drop }],
        effects: [poison(1)],
      }).report,
      1
    );
    assert.equal(claim.grounding, "ONGOING");
    assert.equal(claim.verdict, "SERVER_EXPLAINED");
    assert.equal(claim.serverTickHp, drop);
    assert.equal(hp(out.merged, 1) <= 30 - drop, true, "server tick stays applied");
  });

  it("10. identical inputs (retry / duplicate commit) yield the identical report and event keys", () => {
    const scenario: Scenario = {
      sheets: [sheet(1), sheet(2)],
      actors: [actor(1, { actionType: "attack", body: "도적을 공격한다", tier: "FAILURE" }), actor(2)],
      gmPlayers: [
        { participantId: 1, hp: 22 },
        { participantId: 2, hp: 25 },
      ],
      authored: ["도적"],
    };
    const first = run(scenario);
    const second = run(scenario);
    assert.deepEqual(first.report, second.report);
    assert.deepEqual(
      first.report.claims.map((row) => row.eventKey),
      second.report.claims.map((row) => row.eventKey)
    );
  });

  it("ignores malformed GM hp (same validity rule as the merge) and heals", () => {
    const out = run({
      sheets: [sheet(1), sheet(2, { hp: 10 })],
      actors: [actor(1)],
      gmPlayers: [
        { participantId: 1, hp: Number.NaN },
        { participantId: 2, hp: 30 },
      ],
    });
    assert.equal(out.report.claims.length, 0);
  });
});

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function dropText(participantId: number, hpValue: number): string {
  return buildTrpgGmStructuredWireText("차가운 바람이 문턱을 스치고, 어둠 속에서 무언가가 움직인다.", {
    players: [{ participantId, hp: hpValue }],
    location: "폐허",
    next_round_context: "",
    campaign_finished: false,
  });
}

function shadowLines(spy: ReturnType<typeof mock.method<Console, "info">>): string[] {
  return spy.mock.calls
    .map((call) => String(call.arguments[0]))
    .filter((line) => line.startsWith("[trpg-threat-shadow]"));
}

describe("Slice 1a threat shadow — commit hook (engine, no provider call)", () => {
  it("emits one shadow line after a successful commit, never on regeneration, and leaves HP behaviour as is", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "유저1", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "PC1", stats: EVEN_STATS });
    await startTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: { skipBilling: true, gmCall: async () => ({ text: dropText(1, 30) }) },
    });
    const row = db
      .prepare(`SELECT participant_id AS id, hp FROM trpg_character_sheets WHERE campaign_id=?`)
      .get(campaignId) as { id: number; hp: number };
    const startHp = row.hp;
    const info = mock.method(console, "info", () => undefined);
    try {
      submitTrpgAction(db, { campaignId, userId: 1, body: "문 너머 소리를 가만히 듣는다.", actionType: "free" });
      await advanceTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: {
          skipBilling: true,
          rollD20: () => 15,
          gmCall: async () => ({ text: dropText(row.id, Math.max(0, startHp - 5)) }),
        },
      });
      const lines = shadowLines(info);
      assert.equal(lines.length, 1);
      assert.match(lines[0]!, /claims=1/);
      assert.match(lines[0]!, /"NO_SERVER_BASIS":1/);
      const after = db
        .prepare(`SELECT hp FROM trpg_character_sheets WHERE campaign_id=?`)
        .get(campaignId) as { hp: number };
      assert.equal(after.hp, startHp - 5, "GM_LEGACY HP application is intentionally unchanged in Slice 1a");

      await regenerateTrpgNarration(db, {
        campaignId,
        userId: 1,
        deps: { skipBilling: true, gmCall: async () => ({ text: dropText(row.id, 1) }) },
      });
      assert.equal(shadowLines(info).length, 1, "regeneration must not evaluate or log the shadow");
      const afterRegen = db
        .prepare(`SELECT hp FROM trpg_character_sheets WHERE campaign_id=?`)
        .get(campaignId) as { hp: number };
      assert.equal(afterRegen.hp, startHp - 5, "regeneration leaves world state unchanged");
    } finally {
      info.mock.restore();
      db.close();
    }
  });

  it("billing-fault retry commits once and logs the shadow once (nothing from the rolled-back attempt)", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "유저1", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "PC1", stats: EVEN_STATS });
    await startTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: { skipBilling: true, gmCall: async () => ({ text: dropText(1, 30) }) },
    });
    const row = db
      .prepare(`SELECT participant_id AS id, hp FROM trpg_character_sheets WHERE campaign_id=?`)
      .get(campaignId) as { id: number; hp: number };
    const info = mock.method(console, "info", () => undefined);
    try {
      submitTrpgAction(db, { campaignId, userId: 1, body: "문 너머 소리를 가만히 듣는다.", actionType: "free" });
      let gmCalls = 0;
      await advanceTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: {
          skipBilling: false,
          billingFault: "pricing_quote",
          rollD20: () => 15,
          gmCall: async () => {
            gmCalls += 1;
            return { text: dropText(row.id, row.hp - 5) };
          },
        },
      });
      assert.equal(shadowLines(info).length, 0, "no shadow output when the commit transaction rolled back");
      const midHp = (
        db.prepare(`SELECT hp FROM trpg_character_sheets WHERE campaign_id=?`).get(campaignId) as { hp: number }
      ).hp;
      assert.equal(midHp, row.hp);
      await advanceTrpgCampaign(db, {
        campaignId,
        userId: 1,
        deps: {
          skipBilling: true,
          gmCall: async () => {
            gmCalls += 1;
            throw new Error("must reuse pending result");
          },
        },
      });
      assert.equal(gmCalls, 1);
      assert.equal(shadowLines(info).length, 1);
      const finalHp = (
        db.prepare(`SELECT hp FROM trpg_character_sheets WHERE campaign_id=?`).get(campaignId) as { hp: number }
      ).hp;
      assert.equal(finalHp, row.hp - 5);
    } finally {
      info.mock.restore();
      db.close();
    }
  });
});
