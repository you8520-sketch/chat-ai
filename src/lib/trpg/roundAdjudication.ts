import type Database from "better-sqlite3";
import { resolveTrpgActionCheckDecision, type TrpgActionCheckReason } from "./actionCheck";
import { resolveTrpgAdjudicationDifficulty } from "./adjudicationDifficulty";
import { resolveTrpgCanonicalAttempt } from "./canonicalAttempt";
import { pickStatForActionDetailed } from "./actionTypes";
import { resolveTrpgRoll, rollServerD20 } from "./dice";
import { loadSheetSnapshots } from "./engineSheets";
import { computeResolutionOrder, type TrpgResolutionOrderEntry } from "./initiative";
import { logTrpgMechanicsCheckTelemetry } from "./mechanicsObservability";
import { ensurePreActionMechanics, type MechanicsRoundDeps } from "./mechanicsRound";
import type { MechanicsResolution } from "./mechanicsTypes";
import { loadCampaignContext } from "./campaignContext";
import { loadParticipants, loadScenario, parseJson, setRoundPhase } from "./store";
import { statModifier } from "./stats";

export type AdjudicationMark = "no_roll" | "skipped";

export type TrpgFrozenAdjudicationDecision = {
  needsCheck: boolean;
  reason: TrpgActionCheckReason;
};

/** Viewer-safe adjudication outcome per participant (derived from rolls + marks). */
export type TrpgParticipantAdjudicationOutcome = "roll" | "no_roll" | "skipped";

export type RoundAdjudicationSnapshot = {
  submissions?: Array<{ id: number; body: string }>;
  resolutionOrder?: TrpgResolutionOrderEntry[];
  adjudicationMarks?: Record<string, AdjudicationMark>;
  /** Server-frozen action-check decisions keyed by submission id. */
  adjudicationDecisions?: Record<string, TrpgFrozenAdjudicationDecision>;
  /** Server-frozen current-round presentation roster, ordered by resolution order. */
  expectedPresentationActorIds?: number[];
};

export type ExpectedPresentationActorParticipant = {
  id: number;
  can_act: number;
  status: string;
};

/** Active round actors expected to receive a presentation slot this round. */
export function computeExpectedPresentationActorIds(
  participants: readonly ExpectedPresentationActorParticipant[],
  resolutionOrder: readonly TrpgResolutionOrderEntry[]
): number[] {
  const expectedSet = new Set(
    participants.filter((part) => part.can_act === 1 && part.status === "active").map((part) => part.id)
  );
  return resolutionOrder.map((entry) => entry.participantId).filter((id) => expectedSet.has(id));
}

export type AdjudicationOutcome = "roll" | "no_roll" | "skipped" | "already";

type LockedSubmission = {
  id: number;
  participant_id: number;
  action_type: string | null;
  selected_stat: string | null;
  body: string;
};

function loadRoundAdjudicationSnapshot(db: Database.Database, roundId: number): RoundAdjudicationSnapshot {
  const row = db.prepare(`SELECT input_snapshot_json FROM trpg_rounds WHERE id=?`).get(roundId) as
    | { input_snapshot_json: string | null }
    | undefined;
  return parseJson(row?.input_snapshot_json, {} as RoundAdjudicationSnapshot);
}

function saveRoundAdjudicationSnapshot(
  db: Database.Database,
  roundId: number,
  patch: Partial<RoundAdjudicationSnapshot>
): RoundAdjudicationSnapshot {
  const current = loadRoundAdjudicationSnapshot(db, roundId);
  const next: RoundAdjudicationSnapshot = { ...current, ...patch };
  if (patch.adjudicationMarks) {
    next.adjudicationMarks = { ...current.adjudicationMarks, ...patch.adjudicationMarks };
  }
  if (patch.adjudicationDecisions) {
    next.adjudicationDecisions = { ...current.adjudicationDecisions, ...patch.adjudicationDecisions };
  }
  db.prepare(`UPDATE trpg_rounds SET input_snapshot_json=? WHERE id=?`).run(JSON.stringify(next), roundId);
  return next;
}

function markSubmissionAdjudicated(
  db: Database.Database,
  roundId: number,
  submissionId: number,
  mark: AdjudicationMark,
  decision?: TrpgFrozenAdjudicationDecision
): void {
  const patch: Partial<RoundAdjudicationSnapshot> = {
    adjudicationMarks: { [String(submissionId)]: mark },
  };
  if (decision) {
    patch.adjudicationDecisions = { [String(submissionId)]: decision };
  }
  saveRoundAdjudicationSnapshot(db, roundId, patch);
}

export function loadFrozenAdjudicationDecision(
  db: Database.Database,
  roundId: number,
  submissionId: number
): TrpgFrozenAdjudicationDecision | null {
  const snapshot = loadRoundAdjudicationSnapshot(db, roundId);
  return snapshot.adjudicationDecisions?.[String(submissionId)] ?? null;
}

export function isSubmissionAdjudicated(
  db: Database.Database,
  roundId: number,
  submissionId: number
): boolean {
  const roll = db
    .prepare(`SELECT 1 FROM trpg_dice_rolls WHERE round_id=? AND submission_id=? LIMIT 1`)
    .get(roundId, submissionId);
  if (roll) return true;
  const marks = loadRoundAdjudicationSnapshot(db, roundId).adjudicationMarks ?? {};
  const mark = marks[String(submissionId)];
  return mark === "no_roll" || mark === "skipped";
}

export function ensureRoundAdjudicationContext(
  db: Database.Database,
  opts: {
    campaignId: number;
    roundId: number;
    roundNumber: number;
    deps?: MechanicsRoundDeps;
  }
): { pre: MechanicsResolution; resolutionOrder: TrpgResolutionOrderEntry[] } {
  const pre = ensurePreActionMechanics(db, {
    campaignId: opts.campaignId,
    roundId: opts.roundId,
    roundNumber: opts.roundNumber,
    deps: opts.deps,
  });
  const snapshot = loadRoundAdjudicationSnapshot(db, opts.roundId);
  if (snapshot.resolutionOrder?.length) {
    return { pre, resolutionOrder: snapshot.resolutionOrder };
  }
  const scenario = loadScenario(db, opts.campaignId);
  const parts = loadParticipants(db, opts.campaignId);
  const sheets = loadSheetSnapshots(db, opts.campaignId);
  const resolutionOrder = computeResolutionOrder(
    parts.map((part) => {
      const sheet = sheets.find((row) => row.participantId === part.id);
      return {
        participantId: part.id,
        name: sheet?.name || part.display_name,
        slotIndex: part.slot_index,
        stats: sheet?.stats ?? {},
      };
    }),
    scenario.statDefs
  );
  const expectedPresentationActorIds = computeExpectedPresentationActorIds(parts, resolutionOrder);
  const subs = db
    .prepare(
      `SELECT id, body FROM trpg_action_submissions WHERE round_id=? AND locked=1 ORDER BY id ASC`
    )
    .all(opts.roundId) as Array<{ id: number; body: string }>;
  saveRoundAdjudicationSnapshot(db, opts.roundId, {
    resolutionOrder,
    submissions: subs.map((sub) => ({ id: sub.id, body: sub.body })),
    expectedPresentationActorIds,
  });
  return { pre, resolutionOrder };
}

/** Viewer-safe server-frozen expected presentation roster for the round. */
export function loadExpectedPresentationActorIds(
  db: Database.Database,
  opts: { roundId: number; campaignId: number }
): number[] {
  const snapshot = loadRoundAdjudicationSnapshot(db, opts.roundId);
  if (snapshot.expectedPresentationActorIds?.length) {
    return snapshot.expectedPresentationActorIds;
  }
  const parts = loadParticipants(db, opts.campaignId);
  const resolutionOrder = snapshot.resolutionOrder ?? [];
  if (resolutionOrder.length === 0) return [];
  return computeExpectedPresentationActorIds(parts, resolutionOrder);
}

export function adjudicateCanonicalSubmission(
  db: Database.Database,
  opts: {
    campaignId: number;
    roundId: number;
    submissionId: number;
    pre: MechanicsResolution;
    deps?: MechanicsRoundDeps;
  }
): AdjudicationOutcome {
  if (isSubmissionAdjudicated(db, opts.roundId, opts.submissionId)) {
    return "already";
  }
  const sub = db
    .prepare(
      `SELECT s.id, s.participant_id, s.action_type, s.selected_stat, s.body, p.kind
       FROM trpg_action_submissions s
       JOIN trpg_participants p ON p.id = s.participant_id
       WHERE s.id=? AND s.round_id=? AND s.locked=1`
    )
    .get(opts.submissionId, opts.roundId) as
    | (LockedSubmission & { kind: string })
    | undefined;
  if (!sub) return "already";

  const scenario = loadScenario(db, opts.campaignId);
  const participantKind = sub.kind === "ai_character" ? "ai_character" : "human";
  const resolved = resolveTrpgCanonicalAttempt({
    participantKind,
    submissionBody: sub.body,
    actionType: sub.action_type,
  });
  const checkBody = resolved.canonicalAttempt;
  const actionType = resolved.actionType;
  const statSelection = pickStatForActionDetailed({
    actionType,
    selectedStat: sub.selected_stat,
    body: checkBody,
    defs: scenario.statDefs,
  });
  const statKey = statSelection.statKey;
  const statRow = db
    .prepare(
      `SELECT st.value FROM trpg_character_stats st
       JOIN trpg_character_sheets sh ON sh.id = st.sheet_id
       WHERE sh.participant_id=? AND st.stat_key=?`
    )
    .get(sub.participant_id, statKey) as { value: number } | undefined;
  const statValue = statRow?.value ?? null;
  const localScene = loadCampaignContext(db, opts.campaignId)?.localSceneProgress ?? null;
  const decision = resolveTrpgActionCheckDecision({
    body: checkBody,
    actionType: resolved.actionType,
    intent: participantKind === "ai_character" ? checkBody : "",
    localScene,
    statValue,
  });

  const frozenDecision: TrpgFrozenAdjudicationDecision = {
    needsCheck: decision.needsCheck,
    reason: decision.reason,
  };

  if (!decision.needsCheck) {
    logTrpgMechanicsCheckTelemetry({
      action_type: actionType,
      check_required: false,
      check_reason: decision.reason,
    });
    markSubmissionAdjudicated(db, opts.roundId, sub.id, "no_roll", frozenDecision);
    return "no_roll";
  }

  const preHp = opts.pre.hpAfter[String(sub.participant_id)];
  const downed =
    (typeof preHp === "number" && preHp <= 0) ||
    (opts.pre.incapacitated ?? []).some((row) => row.participantId === sub.participant_id);
  if (downed) {
    markSubmissionAdjudicated(db, opts.roundId, sub.id, "skipped", frozenDecision);
    return "skipped";
  }

  const difficulty = resolveTrpgAdjudicationDifficulty({
    anchorDc: scenario.diceRules.dc,
    actionType,
    checkReason: decision.reason,
    intent: checkBody,
    statValue,
  });
  const d20 = opts.deps?.rollD20?.() ?? rollServerD20();
  const conditionModifier = opts.pre.actionModifiers[String(sub.participant_id)] ?? 0;
  const result = resolveTrpgRoll({
    d20,
    statModifier: statModifier(statRow?.value ?? 5),
    conditionModifier,
    dc: difficulty.effectiveDc,
    rules: scenario.diceRules,
  });
  db.prepare(
    `INSERT INTO trpg_dice_rolls
      (round_id, submission_id, d20, stat_key, stat_modifier, condition_modifier, final_score, dc, tier)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    opts.roundId,
    sub.id,
    result.d20,
    statKey,
    statModifier(statRow?.value ?? 5),
    conditionModifier,
    result.finalScore,
    result.dc,
    result.tier
  );
  logTrpgMechanicsCheckTelemetry({
    action_type: actionType,
    check_required: true,
    check_reason: decision.reason,
    difficulty_band: difficulty.band,
    base_dc: difficulty.anchorDc,
    effective_dc: result.dc,
    stat_key: statKey,
    stat_selection_reason: statSelection.reason,
    stat_modifier: statModifier(statRow?.value ?? 5),
    condition_modifier: conditionModifier,
    final_score: result.finalScore,
    dc: result.dc,
    tier: result.tier,
  });
  saveRoundAdjudicationSnapshot(db, opts.roundId, {
    adjudicationDecisions: { [String(sub.id)]: frozenDecision },
  });
  return "roll";
}

function loadLockedSubmissions(db: Database.Database, roundId: number): LockedSubmission[] {
  return db
    .prepare(
      `SELECT s.id, s.participant_id, s.action_type, s.selected_stat, s.body
       FROM trpg_action_submissions s WHERE s.round_id=? AND s.locked=1 ORDER BY s.id ASC`
    )
    .all(roundId) as LockedSubmission[];
}

export function adjudicateLockedHumanSubmissions(
  db: Database.Database,
  opts: {
    campaignId: number;
    roundId: number;
    pre: MechanicsResolution;
    deps?: MechanicsRoundDeps;
  }
): void {
  const humanIds = new Set(
    (
      db
        .prepare(
          `SELECT s.participant_id AS id
           FROM trpg_action_submissions s
           JOIN trpg_participants p ON p.id = s.participant_id
           WHERE s.round_id=? AND s.locked=1 AND p.kind='human'`
        )
        .all(opts.roundId) as Array<{ id: number }>
    ).map((row) => row.id)
  );
  for (const sub of loadLockedSubmissions(db, opts.roundId)) {
    if (!humanIds.has(sub.participant_id)) continue;
    adjudicateCanonicalSubmission(db, {
      campaignId: opts.campaignId,
      roundId: opts.roundId,
      submissionId: sub.id,
      pre: opts.pre,
      deps: opts.deps,
    });
  }
}

export function adjudicateSubmissionForParticipant(
  db: Database.Database,
  opts: {
    campaignId: number;
    roundId: number;
    participantId: number;
    pre: MechanicsResolution;
    deps?: MechanicsRoundDeps;
  }
): AdjudicationOutcome {
  const sub = db
    .prepare(
      `SELECT id FROM trpg_action_submissions WHERE round_id=? AND participant_id=? AND locked=1`
    )
    .get(opts.roundId, opts.participantId) as { id: number } | undefined;
  if (!sub) return "already";
  return adjudicateCanonicalSubmission(db, {
    campaignId: opts.campaignId,
    roundId: opts.roundId,
    submissionId: sub.id,
    pre: opts.pre,
    deps: opts.deps,
  });
}

export function allLockedSubmissionsAdjudicated(db: Database.Database, roundId: number): boolean {
  for (const sub of loadLockedSubmissions(db, roundId)) {
    if (!isSubmissionAdjudicated(db, roundId, sub.id)) return false;
  }
  return true;
}

export function loadAdjudicatedParticipantIds(db: Database.Database, roundId: number): number[] {
  const ids = new Set<number>();
  const rolled = db
    .prepare(
      `SELECT s.participant_id AS participantId
       FROM trpg_dice_rolls r
       JOIN trpg_action_submissions s ON s.id = r.submission_id
       WHERE r.round_id=?`
    )
    .all(roundId) as Array<{ participantId: number }>;
  for (const row of rolled) ids.add(row.participantId);

  const marks = loadRoundAdjudicationSnapshot(db, roundId).adjudicationMarks ?? {};
  if (Object.keys(marks).length > 0) {
    const subs = db
      .prepare(`SELECT id, participant_id FROM trpg_action_submissions WHERE round_id=?`)
      .all(roundId) as Array<{ id: number; participant_id: number }>;
    const byId = new Map(subs.map((sub) => [sub.id, sub.participant_id]));
    for (const [submissionId, mark] of Object.entries(marks)) {
      if (mark !== "no_roll" && mark !== "skipped") continue;
      const participantId = byId.get(Number(submissionId));
      if (participantId != null) ids.add(participantId);
    }
  }
  return [...ids];
}

export function loadParticipantAdjudicationOutcomes(
  db: Database.Database,
  roundId: number
): Record<number, TrpgParticipantAdjudicationOutcome> {
  const outcomes: Record<number, TrpgParticipantAdjudicationOutcome> = {};

  const marks = loadRoundAdjudicationSnapshot(db, roundId).adjudicationMarks ?? {};
  if (Object.keys(marks).length > 0) {
    const subs = db
      .prepare(`SELECT id, participant_id FROM trpg_action_submissions WHERE round_id=?`)
      .all(roundId) as Array<{ id: number; participant_id: number }>;
    const byId = new Map(subs.map((sub) => [sub.id, sub.participant_id]));
    for (const [submissionId, mark] of Object.entries(marks)) {
      if (mark !== "no_roll" && mark !== "skipped") continue;
      const participantId = byId.get(Number(submissionId));
      if (participantId != null) outcomes[participantId] = mark;
    }
  }

  const rolled = db
    .prepare(
      `SELECT s.participant_id AS participantId
       FROM trpg_dice_rolls r
       JOIN trpg_action_submissions s ON s.id = r.submission_id
       WHERE r.round_id=?`
    )
    .all(roundId) as Array<{ participantId: number }>;
  for (const row of rolled) {
    outcomes[row.participantId] = "roll";
  }

  return outcomes;
}

export function deriveAdjudicatedParticipantIds(
  outcomes: Record<number, TrpgParticipantAdjudicationOutcome>
): number[] {
  return Object.keys(outcomes).map(Number);
}

/** Legacy batch entry — thin wrapper over the per-submission canonical owner. */
export function finalizeRoundAdjudication(
  db: Database.Database,
  campaignId: number,
  roundId: number,
  deps?: MechanicsRoundDeps
): void {
  const roundNumber = (
    db.prepare(`SELECT round_number FROM trpg_rounds WHERE id=?`).get(roundId) as { round_number: number }
  ).round_number;
  const { pre } = ensureRoundAdjudicationContext(db, {
    campaignId,
    roundId,
    roundNumber,
    deps,
  });
  db.transaction(() => {
    for (const sub of loadLockedSubmissions(db, roundId)) {
      adjudicateCanonicalSubmission(db, {
        campaignId,
        roundId,
        submissionId: sub.id,
        pre,
        deps,
      });
    }
    setRoundPhase(db, roundId, "ROLLING");
  })();
}
