import type Database from "better-sqlite3";
import { isTrpgActionType, type TrpgActionType } from "./actionTypes";
import type { TrpgActionCheckReason } from "./actionCheck";
import type { TrpgSuccessTier } from "./types";

export type TrpgMechanicsCheckTelemetry = {
  action_type: TrpgActionType;
  check_required: boolean;
  check_reason: TrpgActionCheckReason;
  stat_key?: string | null;
  stat_modifier?: number | null;
  condition_modifier?: number | null;
  final_score?: number | null;
  dc?: number | null;
  tier?: TrpgSuccessTier | null;
};

export function logTrpgMechanicsCheckTelemetry(row: TrpgMechanicsCheckTelemetry): void {
  console.info("[trpg-mechanics-check]", {
    kind: "trpg_mechanics_check",
    action_type: row.action_type,
    check_required: row.check_required,
    check_reason: row.check_reason,
    stat_key: row.stat_key ?? null,
    stat_modifier: row.stat_modifier ?? null,
    condition_modifier: row.condition_modifier ?? null,
    final_score: row.final_score ?? null,
    dc: row.dc ?? null,
    tier: row.tier ?? null,
  });
}

export type TrpgDiceOutcomeBucket = "FULL_FAILURE" | "PARTIAL" | "SUCCESS_OR_BETTER";

export function bucketTrpgSuccessTier(tier: string | null | undefined): TrpgDiceOutcomeBucket | null {
  switch (tier) {
    case "CRITICAL_FAILURE":
    case "SEVERE_FAILURE":
    case "FAILURE":
      return "FULL_FAILURE";
    case "PARTIAL_SUCCESS":
      return "PARTIAL";
    case "SUCCESS":
    case "GREAT_SUCCESS":
    case "CRITICAL_SUCCESS":
      return "SUCCESS_OR_BETTER";
    default:
      return null;
  }
}

export type TrpgMechanicsEconomyAudit = {
  TOTAL_ACTIONS: number;
  TOTAL_CHECKS: number;
  CHECK_RATE: number;
  FULL_FAILURE_RATE: number;
  PARTIAL_RATE: number;
  SUCCESS_OR_BETTER_RATE: number;
  BY_HUMAN_VS_BOT: {
    human: { actions: number; checks: number; fullFailures: number };
    bot: { actions: number; checks: number; fullFailures: number };
  };
  BY_ACTION_TYPE: Record<string, { actions: number; checks: number; fullFailures: number }>;
  BY_STAT_MODIFIER: Record<string, { checks: number; fullFailures: number }>;
  ROUNDS_WITH_2_PLUS_FULL_FAILURES: number;
  MAX_HUMAN_CONSECUTIVE_FULL_FAILURES: number;
};

function emptyTypeRow(): { actions: number; checks: number; fullFailures: number } {
  return { actions: 0, checks: 0, fullFailures: 0 };
}

/** Read-only local/audit helper. No provider calls. */
export function auditTrpgMechanicsRollEconomy(
  db: Database.Database,
  campaignId: number
): TrpgMechanicsEconomyAudit {
  const submissions = db
    .prepare(
      `SELECT s.id, s.round_id, s.action_type, s.source, p.kind
       FROM trpg_action_submissions s
       JOIN trpg_rounds r ON r.id = s.round_id
       JOIN trpg_participants p ON p.id = s.participant_id
       WHERE r.campaign_id=? AND s.locked=1
       ORDER BY r.round_number ASC, s.id ASC`
    )
    .all(campaignId) as Array<{
    id: number;
    round_id: number;
    action_type: string | null;
    source: string;
    kind: string;
  }>;
  const rolls = db
    .prepare(
      `SELECT d.submission_id, d.round_id, d.stat_modifier, d.tier
       FROM trpg_dice_rolls d
       JOIN trpg_rounds r ON r.id = d.round_id
       WHERE r.campaign_id=?`
    )
    .all(campaignId) as Array<{
    submission_id: number;
    round_id: number;
    stat_modifier: number;
    tier: string;
  }>;
  const rollBySubmission = new Map(rolls.map((row) => [row.submission_id, row]));
  const byType: Record<string, { actions: number; checks: number; fullFailures: number }> = {};
  const byMod: Record<string, { checks: number; fullFailures: number }> = {};
  const byActor = {
    human: emptyTypeRow(),
    bot: emptyTypeRow(),
  };
  const failuresByRound = new Map<number, number>();
  let humanStreak = 0;
  let maxHumanStreak = 0;

  for (const sub of submissions) {
    const actionType = sub.action_type && isTrpgActionType(sub.action_type) ? sub.action_type : "free";
    const actor = sub.kind === "human" ? "human" : "bot";
    const typeRow = byType[actionType] ?? (byType[actionType] = emptyTypeRow());
    typeRow.actions += 1;
    byActor[actor].actions += 1;
    const roll = rollBySubmission.get(sub.id);
    if (!roll) {
      if (actor === "human") humanStreak = 0;
      continue;
    }
    typeRow.checks += 1;
    byActor[actor].checks += 1;
    const bucket = bucketTrpgSuccessTier(roll.tier);
    const modKey = String(roll.stat_modifier);
    const modRow = byMod[modKey] ?? (byMod[modKey] = { checks: 0, fullFailures: 0 });
    modRow.checks += 1;
    if (bucket === "FULL_FAILURE") {
      typeRow.fullFailures += 1;
      byActor[actor].fullFailures += 1;
      modRow.fullFailures += 1;
      failuresByRound.set(roll.round_id, (failuresByRound.get(roll.round_id) ?? 0) + 1);
      if (actor === "human") {
        humanStreak += 1;
        if (humanStreak > maxHumanStreak) maxHumanStreak = humanStreak;
      } else {
        humanStreak = 0;
      }
    } else if (actor === "human") {
      humanStreak = 0;
    }
  }

  const totalActions = submissions.length;
  const totalChecks = rolls.length;
  const fullFailures = rolls.filter((row) => bucketTrpgSuccessTier(row.tier) === "FULL_FAILURE").length;
  const partials = rolls.filter((row) => bucketTrpgSuccessTier(row.tier) === "PARTIAL").length;
  const successes = rolls.filter((row) => bucketTrpgSuccessTier(row.tier) === "SUCCESS_OR_BETTER").length;
  let roundsWithTwoPlus = 0;
  for (const count of failuresByRound.values()) {
    if (count >= 2) roundsWithTwoPlus += 1;
  }

  return {
    TOTAL_ACTIONS: totalActions,
    TOTAL_CHECKS: totalChecks,
    CHECK_RATE: totalActions === 0 ? 0 : totalChecks / totalActions,
    FULL_FAILURE_RATE: totalChecks === 0 ? 0 : fullFailures / totalChecks,
    PARTIAL_RATE: totalChecks === 0 ? 0 : partials / totalChecks,
    SUCCESS_OR_BETTER_RATE: totalChecks === 0 ? 0 : successes / totalChecks,
    BY_HUMAN_VS_BOT: byActor,
    BY_ACTION_TYPE: byType,
    BY_STAT_MODIFIER: byMod,
    ROUNDS_WITH_2_PLUS_FULL_FAILURES: roundsWithTwoPlus,
    MAX_HUMAN_CONSECUTIVE_FULL_FAILURES: maxHumanStreak,
  };
}
