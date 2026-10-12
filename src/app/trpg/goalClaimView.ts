import type { TrpgPublicGoal } from "@/lib/trpg/campaignGoals";
import type { TrpgGoalClaimDecision } from "@/lib/trpg/goalConfirm";

/**
 * - `confirmable`: host, and the server still ties the proposal to the committed GM message.
 * - `stale`: host, but the proposal's source is gone (reroll, or an older build re-saved it). It cannot be
 *   confirmed; the host can only clear it, which keeps the goal active.
 * - `readonly`: any other viewer; the host decides.
 */
export type TrpgGoalClaimMode = "confirmable" | "stale" | "readonly";

export type TrpgGoalClaimAction = {
  decision: TrpgGoalClaimDecision;
  label: string;
  primary: boolean;
};

export type TrpgGoalClaimItem = {
  goalId: string;
  title: string;
  claimedRound: number;
  mode: TrpgGoalClaimMode;
  notice: string;
  actions: TrpgGoalClaimAction[];
};

function claimPresentation(mode: TrpgGoalClaimMode): Pick<TrpgGoalClaimItem, "notice" | "actions"> {
  switch (mode) {
    case "confirmable":
      return {
        notice: "GM이 이 목표가 해결됐다고 서술했습니다.",
        actions: [
          { decision: "confirm", label: "해결 확인", primary: true },
          { decision: "decline", label: "아직 진행 중", primary: false },
        ],
      };
    case "stale":
      return {
        notice: "장면이 다시 쓰여 이 해결 제안은 더 이상 확인할 수 없습니다. 목표는 그대로 진행 중입니다.",
        actions: [{ decision: "decline", label: "제안 정리", primary: false }],
      };
    case "readonly":
      return { notice: "해결 여부는 방장이 확인합니다.", actions: [] };
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

function modeFor(goal: TrpgPublicGoal, viewerIsHost: boolean): TrpgGoalClaimMode {
  if (!viewerIsHost) return "readonly";
  return goal.confirmable === true ? "confirmable" : "stale";
}

/** Pending GM resolution proposals for the small confirm area. Completed goals never appear here. */
export function goalClaimItems(goals: readonly TrpgPublicGoal[] | undefined, viewerIsHost: boolean): TrpgGoalClaimItem[] {
  return (goals ?? [])
    .filter((goal) => goal.status === "active" && goal.claimed && goal.claimedRound != null)
    .map((goal) => {
      const mode = modeFor(goal, viewerIsHost);
      return { goalId: goal.id, title: goal.title, claimedRound: goal.claimedRound as number, mode, ...claimPresentation(mode) };
    });
}
