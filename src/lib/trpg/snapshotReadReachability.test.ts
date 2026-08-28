import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  EVEN_STATS,
  createTrpgCampaign,
  saveTrpgSheet,
  writeSheet,
} from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import {
  deriveAdjudicatedParticipantIds,
  loadParticipantAdjudicationOutcomes,
} from "./roundAdjudication";
import {
  advanceAfterActorResult,
  buildRoundPresentationActors,
  freezeLivePresentationActors,
  isExpectedPresentationRosterMaterialized,
  shouldShowGmNarration,
} from "./roundPresentation";
import { catchUpHiddenPresentationState, isHiddenPresentationCatchUpActive } from "./presentationHiddenCatchUp";
import { insertParticipant, loadLatestRound } from "./store";
import { ensureTrpgTables } from "./schema";
import type { TrpgCampaignSnapshot } from "./snapshot";

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

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function loadCurrentRoundActions(db: Database.Database, roundId: number, viewerParticipantId: number | null) {
  return (
    db
      .prepare(
        `SELECT s.participant_id, p.display_name AS name, p.kind, s.body, s.locked, s.action_type
         FROM trpg_action_submissions s
         JOIN trpg_participants p ON p.id = s.participant_id
         WHERE s.round_id=?
         ORDER BY s.id ASC`
      )
      .all(roundId) as Array<{
      participant_id: number;
      name: string;
      kind: string;
      body: string;
      locked: number;
      action_type: string | null;
    }>
  ).map((row) => ({
    participantId: row.participant_id,
    name: row.name,
    body: row.locked === 1 || row.participant_id === viewerParticipantId ? row.body : "",
    revealed: row.locked === 1 || row.participant_id === viewerParticipantId,
    kind: row.kind === "ai_character" ? ("ai_character" as const) : ("human" as const),
    actionType: row.action_type,
  }));
}

async function setupTwoBotRound(db: Database.Database, deps: TrpgEngineDeps) {
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const b1 = insertParticipant(db, {
    campaignId,
    slotIndex: 1,
    kind: "ai_character",
    userId: null,
    characterId: null,
    displayName: "Bot1",
  });
  const b2 = insertParticipant(db, {
    campaignId,
    slotIndex: 2,
    kind: "ai_character",
    userId: null,
    characterId: null,
    displayName: "Bot2",
  });
  writeSheet(db, campaignId, b1, "Bot1", EVEN_STATS, "");
  writeSheet(db, campaignId, b2, "Bot2", EVEN_STATS, "");
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  return { campaignId, b1, b2 };
}

function deriveRoomPresentationFromSnap(snap: TrpgCampaignSnapshot) {
  const currentLogRow = snap.log.find((row) => row.roundNumber === snap.round.number) ?? null;
  const sourceActions = (currentLogRow?.actions ?? []).filter((action) => action.revealed && action.body.trim());
  const sourceRolls = snap.currentRolls.length > 0 ? snap.currentRolls : currentLogRow?.rolls ?? [];
  const liveReady = sourceActions.length > 0 || sourceRolls.length > 0;
  const liveActors = buildRoundPresentationActors({
    resolutionOrder: (snap.resolutionOrder ?? []).map((entry) => entry.participantId),
    actions: sourceActions,
    rolls: sourceRolls,
  });
  const frozen = freezeLivePresentationActors({
    previous: null,
    next: liveActors,
    ready: liveReady,
    roundNumber: snap.round.number,
    frozenRound: null,
  });
  return {
    sourceActions,
    presentationActors: frozen.actors,
    adjudicatedParticipantIds: new Set(snap.adjudicatedParticipantIds ?? []),
  };
}

function assertSnapshotAdjudicatedImpliesAction(snap: TrpgCampaignSnapshot): void {
  const row = snap.log.find((entry) => entry.roundNumber === snap.round.number);
  const actionIds = new Set(
    (row?.actions ?? []).filter((action) => action.revealed && action.body.trim()).map((action) => action.participantId)
  );
  for (const id of snap.adjudicatedParticipantIds ?? []) {
    assert.ok(actionIds.has(id), `adjudicated participant ${id} must have revealed locked action in current log row`);
  }
}

function assertNormalRenderMaterializesExpected(snap: TrpgCampaignSnapshot): void {
  const room = deriveRoomPresentationFromSnap(snap);
  const expected = snap.round.expectedPresentationActorIds ?? [];
  assert.equal(
    isExpectedPresentationRosterMaterialized({
      actors: room.presentationActors,
      expectedPresentationActorIds: expected,
    }),
    true
  );
}

describe("TRPG snapshot read reachability audit", () => {
  it("LOAD_TRPG_SNAPSHOT has no read transaction wrapping log and adjudication", () => {
    const source = readFileSync("src/lib/trpg/engineSnapshot.ts", "utf8");
    const fn = source.slice(source.indexOf("export function loadTrpgSnapshot"));
    const body = fn.slice(0, fn.indexOf("\nexport function", 10));
    assert.doesNotMatch(body, /\.transaction\s*\(/);
    assert.match(body, /const log =[\s\S]*loadLog\(/);
    assert.match(body, /loadParticipantAdjudicationOutcomes\(db, round\.id\)/);
    const logIdx = body.indexOf("loadLog(");
    const outcomeIdx = body.indexOf("loadParticipantAdjudicationOutcomes(");
    assert.ok(logIdx >= 0 && outcomeIdx > logIdx, "log read precedes adjudication read");
  });

  it("REAL_SNAPSHOT_SKEW: two DB connections can observe actions without B2 then outcomes with B2", () => {
    const dir = mkdtempSync(join(tmpdir(), "trpg-skew-audit-"));
    const dbPath = join(dir, "app.db");
    try {
      const writer = new Database(dbPath);
      writer.pragma("journal_mode = WAL");
      ensureTrpgTables(writer);

      const campaignId = createTrpgCampaign(writer, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
      saveTrpgSheet(writer, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
      const humanId = (
        writer
          .prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND kind='human' LIMIT 1`)
          .get(campaignId) as { id: number }
      ).id;
      const b1 = insertParticipant(writer, {
        campaignId,
        slotIndex: 1,
        kind: "ai_character",
        userId: null,
        characterId: null,
        displayName: "Bot1",
      });
      const b2 = insertParticipant(writer, {
        campaignId,
        slotIndex: 2,
        kind: "ai_character",
        userId: null,
        characterId: null,
        displayName: "Bot2",
      });
      writeSheet(writer, campaignId, b1, "Bot1", EVEN_STATS, "");
      writeSheet(writer, campaignId, b2, "Bot2", EVEN_STATS, "");

      const roundId = writer
        .prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?, 1, 'GENERATING_NARRATION')`)
        .run(campaignId).lastInsertRowid as number;

      const humanSubId = writer
        .prepare(
          `INSERT INTO trpg_action_submissions
            (round_id, participant_id, body, action_type, selected_stat, locked, source)
           VALUES (?, ?, 'human acts', 'investigate', 'nerve', 1, 'human')`
        )
        .run(roundId, humanId).lastInsertRowid as number;
      const b1SubId = writer
        .prepare(
          `INSERT INTO trpg_action_submissions
            (round_id, participant_id, body, action_type, selected_stat, locked, source)
           VALUES (?, ?, 'bot1 acts', 'investigate', 'nerve', 1, 'bot_model')`
        )
        .run(roundId, b1).lastInsertRowid as number;

      writer
        .prepare(
          `INSERT INTO trpg_dice_rolls
            (round_id, submission_id, d20, stat_key, stat_modifier, condition_modifier, final_score, dc, tier)
           VALUES (?, ?, 12, 'nerve', 0, 0, 12, 11, 'SUCCESS')`
        )
        .run(roundId, humanSubId);
      writer
        .prepare(
          `INSERT INTO trpg_dice_rolls
            (round_id, submission_id, d20, stat_key, stat_modifier, condition_modifier, final_score, dc, tier)
           VALUES (?, ?, 8, 'nerve', 0, 0, 8, 11, 'FAILURE')`
        )
        .run(roundId, b1SubId);

      writer
        .prepare(
          `UPDATE trpg_rounds SET input_snapshot_json=? WHERE id=?`
        )
        .run(
          JSON.stringify({
            resolutionOrder: [
              { participantId: humanId, name: "렌", slotIndex: 0 },
              { participantId: b1, name: "Bot1", slotIndex: 1 },
              { participantId: b2, name: "Bot2", slotIndex: 2 },
            ],
          }),
          roundId
        );

      const reader = new Database(dbPath);
      reader.pragma("journal_mode = WAL");

      const actionsBefore = loadCurrentRoundActions(reader, roundId, humanId);
      const actionIdsBefore = new Set(actionsBefore.filter((a) => a.revealed).map((a) => a.participantId));
      assert.deepEqual([...actionIdsBefore].sort(), [humanId, b1].sort());

      const b2SubId = writer
        .prepare(
          `INSERT INTO trpg_action_submissions
            (round_id, participant_id, body, action_type, selected_stat, locked, source)
           VALUES (?, ?, 'bot2 acts', 'investigate', 'nerve', 1, 'bot_model')`
        )
        .run(roundId, b2).lastInsertRowid as number;
      writer
        .prepare(
          `INSERT INTO trpg_dice_rolls
            (round_id, submission_id, d20, stat_key, stat_modifier, condition_modifier, final_score, dc, tier)
           VALUES (?, ?, 3, 'nerve', 0, 0, 3, 11, 'CRITICAL_FAILURE')`
        )
        .run(roundId, b2SubId);

      const outcomesAfter = loadParticipantAdjudicationOutcomes(reader, roundId);
      const adjudicatedAfter = new Set(deriveAdjudicatedParticipantIds(outcomesAfter));

      assert.ok(adjudicatedAfter.has(b2));
      assert.equal(actionIdsBefore.has(b2), false);
      assert.deepEqual([...adjudicatedAfter].sort(), [humanId, b1, b2].sort());

      reader.close();
      writer.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("SINGLE_CONNECTION loadTrpgSnapshot never returns adjudicated-without-action for current round", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async () => ({ text: gmText("오프닝") }),
      botCall: async (_s, user) => {
        if (user.includes("Bot1")) {
          return { text: "Bot1 acts.\n\n<<<INTENT>>>\nacts\n\n<<<ACTION_TYPE>>>\ninvestigate" };
        }
        return { text: "Bot2 acts.\n\n<<<INTENT>>>\nacts\n\n<<<ACTION_TYPE>>>\ninvestigate" };
      },
    };
    const { campaignId } = await setupTwoBotRound(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "human acts", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const snap = loadTrpgSnapshot(db, campaignId, 1)!;
    assertSnapshotAdjudicatedImpliesAction(snap);
    assertNormalRenderMaterializesExpected(snap);
    db.close();
  });

  it("PREMATURE_GM_WITHOUT_B2_ADJUDICATED fixed by expected roster", () => {
    const H = 47;
    const B1 = 49;
    const B2 = 48;
    const human = {
      participantId: H,
      name: "Human",
      body: "human acts",
      revealed: true,
      kind: "human" as const,
      actionType: "investigate" as const,
    };
    const bot1 = {
      participantId: B1,
      name: "Bot1",
      body: "bot1 acts",
      revealed: true,
      kind: "ai_character" as const,
      actionType: "investigate" as const,
    };
    const actors = buildRoundPresentationActors({
      resolutionOrder: [H, B1, B2],
      actions: [human, bot1],
      rolls: [
        { participantId: H, name: "Human", d20: 12, statKey: "nerve", finalScore: 12, dc: 11, tier: "SUCCESS", success: true, actionBody: "", actionType: "investigate", kind: "human" },
        { participantId: B1, name: "Bot1", d20: 8, statKey: "nerve", finalScore: 8, dc: 11, tier: "FAILURE", success: false, actionBody: "", actionType: "investigate", kind: "ai_character" },
      ],
    });
    const afterB1 = advanceAfterActorResult({
      actors,
      presentationIndex: 1,
      adjudicatedParticipantIds: new Set([H, B1]),
      declarationConsumedIds: new Set([H, B1]),
      awaitingMoreActors: false,
      expectedPresentationActorIds: [H, B1, B2],
    });
    assert.deepEqual(afterB1, { phase: "actor-action", presentationIndex: 2 });
    assert.notEqual(afterB1.phase, "gm-narration");
  });

  it("HIDDEN_CATCHUP_CAN_PRODUCE_EXACT_SYMPTOM without dice overlay", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: [47, 49, 48],
      actions: [
        { participantId: 47, name: "H", body: "h", revealed: true, kind: "human", actionType: "investigate" },
        { participantId: 49, name: "B1", body: "b1", revealed: true, kind: "ai_character", actionType: "investigate" },
        { participantId: 48, name: "B2", body: "b2", revealed: true, kind: "ai_character", actionType: "investigate" },
      ],
      rolls: [
        { participantId: 47, name: "H", d20: 12, statKey: "nerve", finalScore: 12, dc: 11, tier: "SUCCESS", success: true, actionBody: "", actionType: "investigate", kind: "human" },
        { participantId: 49, name: "B1", d20: 8, statKey: "nerve", finalScore: 8, dc: 11, tier: "FAILURE", success: false, actionBody: "", actionType: "investigate", kind: "ai_character" },
        { participantId: 48, name: "B2", d20: 3, statKey: "nerve", finalScore: 3, dc: 11, tier: "CRITICAL_FAILURE", success: false, actionBody: "", actionType: "investigate", kind: "ai_character" },
      ],
    });
    const caught = catchUpHiddenPresentationState({
      state: { mode: "cinematic", phase: "actor-action", presentationIndex: 1 },
      actors,
      gmTextAvailable: true,
    });
    assert.equal(caught.phase, "complete");
    assert.equal(
      isHiddenPresentationCatchUpActive({
        documentHidden: true,
        session: { sessionKey: "45|live-cinematic", roundNumber: 45 },
        sessionKey: "45|live-cinematic",
        cinematic: true,
      }),
      true
    );
  });

  it("B2_PREMATURE_DECLARATION_CONSUME: seenLogKeys only written on reveal complete", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const writers = room.match(/seenLogKeysRef\.current\?\.add\(/g) ?? [];
    assert.equal(writers.length, 1);
    assert.match(room, /handleDeclarationRevealChange[\s\S]*report\.complete/);
    assert.match(room, /if \(seenLogKeysRef\.current\?\.has\(key\)\) return;/);
  });

  it("LIVE_BOT2_CAN_BE_MARKED_HISTORICAL only via mount consume, not live phase advance", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /decideRoundPresentationMode\([\s\S]*consumeOnMount/);
    assert.doesNotMatch(room, /gmNarrationDraft[\s\S]{0,160}historicalPresentation\(/);
    assert.doesNotMatch(room, /gmTextReady[\s\S]{0,160}historicalPresentation\(/);
    assert.doesNotMatch(room, /GENERATING_NARRATION[\s\S]{0,160}historicalPresentation\(/);
  });
});
