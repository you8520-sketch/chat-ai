import type Database from "better-sqlite3";
import type { TrpgGoal } from "./campaignGoals";
import type { TrpgActionPlan } from "./actionContract";
import { loadCampaignLedger } from "./campaignLedger";
import { applyCampaignStoryProgress, loadCampaignContext, persistCampaignContext, resolvedCampaignPlan } from "./campaignContext";
import { settleFinishedSceneNarration } from "./gmPrompt";
import { grantTrpgCampaignCompletionXp } from "./progression";
import { loadCampaign, loadParticipants } from "./store";

export type TrpgEndingDecision =
  | { kind: "none" }
  | {
      kind: "needs_host_confirmation";
      goalId: string;
      claimedRound: number;
      reason: "goal_claim_pending";
    }
  | {
      kind: "end";
      reason: "explicit_campaign_close" | "scenario_complete";
      conditionId?: string;
    };

/**
 * Single server ending owner. Only a human seat can declare an explicit
 * campaign close. A normal NPC farewell or scene close is not a campaign end.
 * A pending goal claim is preserved for the real host; this owner never
 * auto-confirms or auto-declines it.
 */
export function evaluateTrpgEndingDecision(opts: {
  plans: readonly TrpgActionPlan[];
  goals: readonly TrpgGoal[];
  humanParticipantIds: ReadonlySet<number>;
  scenarioEndingConditions?: readonly string[];
  /** Pre-R1 finish predicate result, treated as a server fact input. */
  legacyFinishWouldStand?: boolean;
}): TrpgEndingDecision {
  const humanClose = opts.plans.find(
    (plan) =>
      opts.humanParticipantIds.has(plan.proposal.actorParticipantId) &&
      plan.endingIntent === "campaign_close" &&
      plan.acts.some((act) => act.status === "planned")
  );
  if (!humanClose && opts.legacyFinishWouldStand !== true) return { kind: "none" };

  const active = opts.goals.filter((goal) => goal.status === "active");
  const pending = active.find((goal) => goal.claimedRound != null);
  if (pending) {
    return {
      kind: "needs_host_confirmation",
      goalId: pending.id,
      claimedRound: pending.claimedRound!,
      reason: "goal_claim_pending",
    };
  }
  if (active.length > 0) return { kind: "none" };
  return {
    kind: "end",
    reason:
      opts.scenarioEndingConditions && opts.scenarioEndingConditions.length > 0
        ? "scenario_complete"
        : "explicit_campaign_close",
  };
}

export function loadRoundActionPlans(db: Database.Database, roundId: number): TrpgActionPlan[] {
  const rows = db
    .prepare(`SELECT action_plan_json FROM trpg_action_submissions WHERE round_id=? AND locked=1 ORDER BY id`)
    .all(roundId) as Array<{ action_plan_json: string | null }>;
  const out: TrpgActionPlan[] = [];
  for (const row of rows) {
    if (!row.action_plan_json) continue;
    try {
      out.push(JSON.parse(row.action_plan_json) as TrpgActionPlan);
    } catch {
      // Older or malformed plans fall back to the existing finish contract.
    }
  }
  return out;
}

export function humanParticipantIds(db: Database.Database, campaignId: number): Set<number> {
  return new Set(
    loadParticipants(db, campaignId)
      .filter((row) => row.kind === "human")
      .map((row) => row.id)
  );
}

/**
 * The real host answered a pending claim. If the latest committed round
 * already carried the host's explicit campaign-close act, the server can
 * finish from that round's narration. No extra player action (and no paid
 * "take a breath" filler) is inserted. Missing final narration still blocks
 * completion.
 */
export function finalizeHostConfirmedEnding(
  db: Database.Database,
  opts: { campaignId: number; goalId: string; claimedRound: number }
): { ended: boolean; reason?: string } {
  const run = (): { ended: boolean; reason?: string } => {
    const campaign = loadCampaign(db, opts.campaignId);
    if (!campaign || campaign.status === "CAMPAIGN_COMPLETE") return { ended: false, reason: "already_complete" } as const;
    const latest = db
      .prepare(
        `SELECT r.id, r.round_number, r.phase
         FROM trpg_rounds r
         JOIN trpg_gm_messages m ON m.round_id = r.id
         WHERE r.campaign_id=?
         ORDER BY r.round_number DESC LIMIT 1`
      )
      .get(opts.campaignId) as { id: number; round_number: number; phase: string } | undefined;
    if (!latest || latest.phase !== "ROUND_COMPLETE") return { ended: false, reason: "no_committed_round" } as const;

    const context = loadCampaignContext(db, opts.campaignId);
    const decision = evaluateTrpgEndingDecision({
      plans: loadRoundActionPlans(db, latest.id),
      goals: loadCampaignLedger(db, opts.campaignId).goals,
      humanParticipantIds: humanParticipantIds(db, opts.campaignId),
      scenarioEndingConditions: resolvedCampaignPlan(context)?.endingConditions,
    });
    if (decision.kind !== "end") return { ended: false, reason: decision.kind } as const;

    const gm = db
      .prepare(`SELECT narration, structured_json FROM trpg_gm_messages WHERE round_id=?`)
      .get(latest.id) as { narration: string | null; structured_json: string | null } | undefined;
    const narration = gm?.narration?.trim() ?? "";
    if (!narration) return { ended: false, reason: "no_final_narration" } as const;

    const settled = settleFinishedSceneNarration(narration);
    let structured: Record<string, unknown> = {};
    try {
      structured = gm?.structured_json ? (JSON.parse(gm.structured_json) as Record<string, unknown>) : {};
    } catch {
      structured = {};
    }
    db.prepare(`UPDATE trpg_gm_messages SET narration=?, structured_json=? WHERE round_id=?`).run(
      settled,
      JSON.stringify({
        ...structured,
        narration: settled,
        effectiveCampaignFinished: true,
        endingDecision: decision,
        hostConfirmedEnding: { goalId: opts.goalId, claimedRound: opts.claimedRound },
      }),
      latest.id
    );

    // The ordinary GM finalize opened an empty next ACTION_INPUT round before
    // the host answered. Close that empty round so reconnect cannot reopen play.
    const next = db
      .prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=? AND phase='ACTION_INPUT'`)
      .get(opts.campaignId, latest.round_number + 1) as { id: number } | undefined;
    if (next) {
      const used =
        db.prepare(`SELECT 1 FROM trpg_action_submissions WHERE round_id=? LIMIT 1`).get(next.id) !== undefined ||
        db.prepare(`SELECT 1 FROM trpg_gm_messages WHERE round_id=? LIMIT 1`).get(next.id) !== undefined;
      if (!used) db.prepare(`DELETE FROM trpg_rounds WHERE id=?`).run(next.id);
    }

    db.prepare(`UPDATE trpg_campaigns SET status='CAMPAIGN_COMPLETE', updated_at=datetime('now') WHERE id=?`).run(
      opts.campaignId
    );
    const current = loadCampaignContext(db, opts.campaignId);
    if (current) {
      persistCampaignContext(
        db,
        applyCampaignStoryProgress(current, { storyPhase: "FINISHED", campaignFinished: true })
      );
    }
    grantTrpgCampaignCompletionXp(db, opts.campaignId);
    return { ended: true, reason: decision.reason } as const;
  };
  if (db.inTransaction) return run();
  return db.transaction(run).immediate();
}
