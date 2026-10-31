import type Database from "better-sqlite3";
import { answerGoalClaim, type TrpgGoalAnswer, type TrpgGoalAnswerResult } from "./campaignGoals";
import { CampaignGoalsConflictError, loadCampaignLedger, loadStoredGoalsJson, persistGoalsIfUnchanged } from "./campaignLedger";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { finalizeHostConfirmedEnding } from "./endingDecision";
import { claimMatchesCommittedMessage } from "./goalClaimProvenance";
import type { TrpgCampaignSnapshot } from "./snapshot";
import { loadCampaign, loadParticipants } from "./store";

export type TrpgGoalClaimDecision = "confirm" | "decline";

export type TrpgGoalClaimOutcome = "confirmed" | "declined" | "already_confirmed" | "already_declined";

const REJECTION_MESSAGE = {
  unknown_goal: "목표를 찾을 수 없습니다.",
  closed: "이미 닫힌 목표입니다.",
  no_claim: "해결 제안이 없는 목표입니다.",
  stale_claim: "해결 제안이 바뀌었습니다. 화면을 새로고침하세요.",
} as const;

export const TRPG_GOAL_HOST_ONLY_MESSAGE = "방장만 목표 해결을 확인할 수 있습니다.";
export const TRPG_GOAL_CLAIM_REWRITTEN_MESSAGE = "장면이 다시 쓰여 이 해결 제안은 더 이상 유효하지 않습니다.";

/**
 * The host answers one GM resolution proposal. Authority is the same as every other host-only action
 * (`campaign.host_user_id`); the completion evidence names the host's participant seat. The read, the checks and
 * the conditional write run in one write transaction, so a GM commit or a second request cannot interleave.
 * No provider call, no billing.
 */
export function answerTrpgGoalClaim(
  db: Database.Database,
  opts: { campaignId: number; userId: number; goalId: string; claimedRound: number; decision: TrpgGoalClaimDecision }
): { outcome: TrpgGoalClaimOutcome; campaign: TrpgCampaignSnapshot } {
  const outcome = db
    .transaction((): TrpgGoalClaimOutcome => {
      const campaign = loadCampaign(db, opts.campaignId);
      if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
      if (campaign.host_user_id !== opts.userId) throw new Error(TRPG_GOAL_HOST_ONLY_MESSAGE);
      if (campaign.status === "CAMPAIGN_COMPLETE") throw new Error("끝난 캠페인의 목표는 바꿀 수 없습니다.");
      if (!Number.isInteger(opts.claimedRound)) throw new Error(REJECTION_MESSAGE.stale_claim);

      const goalsJson = loadStoredGoalsJson(db, opts.campaignId);
      const goals = loadCampaignLedger(db, opts.campaignId).goals;
      const hostSeat = loadParticipants(db, opts.campaignId).find(
        (participant) => participant.kind === "human" && participant.user_id === opts.userId
      );
      if (!hostSeat) throw new Error(TRPG_GOAL_HOST_ONLY_MESSAGE);
      const round = (
        db.prepare(`SELECT round_number FROM trpg_campaign_state WHERE campaign_id=?`).get(opts.campaignId) as
          | { round_number: number }
          | undefined
      )?.round_number ?? 0;

      const goal = goals.find((item) => item.id === opts.goalId);
      if (opts.decision === "confirm" && goal && goal.status === "active" && goal.claimedRound === opts.claimedRound) {
        if (!claimMatchesCommittedMessage(db, opts.campaignId, goal)) {
          throw new Error(TRPG_GOAL_CLAIM_REWRITTEN_MESSAGE);
        }
      }
      const answer: TrpgGoalAnswer =
        opts.decision === "confirm"
          ? { decision: "confirm", round, hostSeatId: hostSeat.id }
          : { decision: "decline" };
      const result: TrpgGoalAnswerResult = answerGoalClaim(goals, opts.goalId, opts.claimedRound, answer);
      if (result.outcome === "rejected") throw new Error(REJECTION_MESSAGE[result.reason]);
      if (!("goals" in result)) return result.outcome;
      if (!persistGoalsIfUnchanged(db, opts.campaignId, goalsJson, result.goals)) throw new CampaignGoalsConflictError();
      if (opts.decision === "confirm") {
        finalizeHostConfirmedEnding(db, {
          campaignId: opts.campaignId,
          goalId: opts.goalId,
          claimedRound: opts.claimedRound,
        });
      }
      return result.outcome;
    })
    .immediate();
  const campaign = loadTrpgSnapshot(db, opts.campaignId, opts.userId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  return { outcome, campaign };
}
