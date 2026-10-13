import type { TrpgGoalCompletionBasis, TrpgPublicGoal } from "@/lib/trpg/campaignGoals";

/**
 * One display rule for the player-facing goal list, built only from the snapshot's `goals`.
 * - `active`: still in progress.
 * - `pending`: the GM described it as resolved; it is NOT complete until the host answers.
 * - `done_server` / `done_host`: completion the server verified, or the host confirmed.
 * - `done_unrecorded`: recorded as completed but no evidence survived; never shown as verified.
 */
export type TrpgGoalHudBadge = "active" | "pending" | "done_server" | "done_host" | "done_unrecorded";

export type TrpgGoalHudItem = {
  id: string;
  title: string;
  badge: TrpgGoalHudBadge;
  label: string;
  hint: string | null;
};

export type TrpgGoalHudView = {
  activeCount: number;
  pendingCount: number;
  /** The goal shown on the collapsed bar: the first goal still in progress. */
  lead: TrpgGoalHudItem | null;
  active: TrpgGoalHudItem[];
  /** Newest first. */
  done: TrpgGoalHudItem[];
  /** Collapsed-bar text when there is nothing in progress; null when `lead` is shown. */
  emptyNotice: string | null;
};

export const TRPG_GOAL_HUD_NO_GOALS = "등록된 목표가 없습니다";
export const TRPG_GOAL_HUD_ALL_DONE = "진행 중인 목표가 없습니다";

function badgeLabel(badge: TrpgGoalHudBadge): string {
  switch (badge) {
    case "active":
      return "진행 중";
    case "pending":
      return "확인 대기";
    case "done_server":
      return "시스템 확인 완료";
    case "done_host":
      return "방장 확인 완료";
    case "done_unrecorded":
      return "완료 기록 · 확인 근거 없음";
    default: {
      const unreachable: never = badge;
      return unreachable;
    }
  }
}

function badgeHint(badge: TrpgGoalHudBadge): string | null {
  switch (badge) {
    case "pending":
      return "GM이 해결됐다고 서술했습니다. 방장이 확인하기 전에는 완료가 아닙니다.";
    case "active":
    case "done_server":
    case "done_host":
    case "done_unrecorded":
      return null;
    default: {
      const unreachable: never = badge;
      return unreachable;
    }
  }
}

function completedBadge(basis: TrpgGoalCompletionBasis | undefined): TrpgGoalHudBadge {
  switch (basis) {
    case "server":
      return "done_server";
    case "host":
      return "done_host";
    case "unrecorded":
    case undefined:
      return "done_unrecorded";
    default: {
      const unreachable: never = basis;
      return unreachable;
    }
  }
}

function toItem(goal: TrpgPublicGoal): TrpgGoalHudItem {
  const badge: TrpgGoalHudBadge =
    goal.status === "completed" ? completedBadge(goal.basis) : goal.claimed ? "pending" : "active";
  return { id: goal.id, title: goal.title, badge, label: badgeLabel(badge), hint: badgeHint(badge) };
}

/**
 * `undefined` goals means the server sent no goal data (older snapshot); the caller shows nothing rather than
 * claiming there are no goals.
 */
export function goalHudView(goals: readonly TrpgPublicGoal[] | undefined): TrpgGoalHudView | null {
  if (goals === undefined) return null;
  const active = goals.filter((goal) => goal.status === "active").map(toItem);
  const done = goals
    .filter((goal) => goal.status === "completed")
    .map(toItem)
    .reverse();
  const lead = active[0] ?? null;
  const emptyNotice = lead ? null : done.length > 0 ? TRPG_GOAL_HUD_ALL_DONE : TRPG_GOAL_HUD_NO_GOALS;
  return {
    activeCount: active.length,
    pendingCount: active.filter((item) => item.badge === "pending").length,
    lead,
    active,
    done,
    emptyNotice,
  };
}

/**
 * While the newest round is still being revealed (live narration, declarations, dice) the list keeps what the
 * player already saw, so a goal never shows up before the scene that introduced it.
 */
export function nextShownGoals<T>(shown: T, incoming: T, held: boolean): T {
  return held ? shown : incoming;
}
