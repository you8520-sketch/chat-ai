"use client";

import { AppSectionCard } from "@/components/AppPageShell";
import type { TrpgGoalClaimDecision } from "@/lib/trpg/goalConfirm";
import type { TrpgGoalClaimItem } from "./goalClaimView";

const PRIMARY_BUTTON =
  "inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50";
const SECONDARY_BUTTON =
  "inline-flex min-h-10 items-center rounded-xl border border-zinc-600 px-4 text-sm font-semibold text-zinc-200 disabled:opacity-50";

export function TrpgGoalClaimCard({
  items,
  busy,
  onAnswer,
}: {
  items: readonly TrpgGoalClaimItem[];
  busy: boolean;
  onAnswer: (item: TrpgGoalClaimItem, decision: TrpgGoalClaimDecision) => void;
}) {
  if (items.length === 0) return null;
  return (
    <AppSectionCard title="목표 해결 확인">
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={`${item.goalId}:${item.claimedRound}`} className="space-y-2">
            <p className="text-sm text-zinc-200">{item.title}</p>
            {item.actions.length === 0 ? (
              <p className="text-xs text-zinc-400">{item.notice}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-400">{item.notice}</span>
                {item.actions.map((action) => (
                  <button
                    key={action.decision}
                    type="button"
                    disabled={busy}
                    onClick={() => onAnswer(item, action.decision)}
                    className={action.primary ? PRIMARY_BUTTON : SECONDARY_BUTTON}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </AppSectionCard>
  );
}
