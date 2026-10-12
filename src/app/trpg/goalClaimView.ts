import type { TrpgPublicGoal } from "@/lib/trpg/campaignGoals";

export type TrpgGoalClaimItem = {
  goalId: string;
  title: string;
  claimedRound: number;
  /** The host may answer; everyone else only sees that the proposal is waiting. */
  answerable: boolean;
};

/**
 * Pending GM resolution proposals for the small confirm area. Answerable only for the host and only while the
 * server still reports the proposal as matching the committed GM message.
 */
export function goalClaimItems(goals: readonly TrpgPublicGoal[] | undefined, viewerIsHost: boolean): TrpgGoalClaimItem[] {
  return (goals ?? [])
    .filter((goal) => goal.status === "active" && goal.claimed && goal.claimedRound != null)
    .map((goal) => ({
      goalId: goal.id,
      title: goal.title,
      claimedRound: goal.claimedRound as number,
      answerable: viewerIsHost && goal.confirmable === true,
    }));
}
