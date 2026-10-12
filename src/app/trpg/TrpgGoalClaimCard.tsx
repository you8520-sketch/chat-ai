"use client";

import { AppSectionCard } from "@/components/AppPageShell";
import type { TrpgGoalClaimDecision } from "@/lib/trpg/goalConfirm";
import type { TrpgGoalClaimItem } from "./goalClaimView";

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
            {item.answerable ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-400">GM이 이 목표가 해결됐다고 서술했습니다.</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAnswer(item, "confirm")}
                  className="inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  해결 확인
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAnswer(item, "decline")}
                  className="inline-flex min-h-10 items-center rounded-xl border border-zinc-600 px-4 text-sm font-semibold text-zinc-200 disabled:opacity-50"
                >
                  아직 진행 중
                </button>
              </div>
            ) : (
              <p className="text-xs text-zinc-400">해결 여부는 방장이 확인합니다.</p>
            )}
          </li>
        ))}
      </ul>
    </AppSectionCard>
  );
}
