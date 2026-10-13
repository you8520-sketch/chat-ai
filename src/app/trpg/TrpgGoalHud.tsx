"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { TrpgPublicGoal } from "@/lib/trpg/campaignGoals";
import { goalHudView, nextShownGoals, type TrpgGoalHudBadge, type TrpgGoalHudItem } from "./goalHudView";

function badgeClass(badge: TrpgGoalHudBadge): string {
  switch (badge) {
    case "active":
      return "border-violet-400/30 bg-violet-500/10 text-violet-200";
    case "pending":
      return "border-amber-400/40 bg-amber-500/10 text-amber-200";
    case "done_server":
      return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
    case "done_host":
      return "border-sky-400/30 bg-sky-500/10 text-sky-200";
    case "done_unrecorded":
      return "border-white/15 bg-white/[0.04] text-zinc-400";
    default: {
      const unreachable: never = badge;
      return unreachable;
    }
  }
}

function GoalRow({ item }: { item: TrpgGoalHudItem }) {
  return (
    <li className="space-y-1" data-trpg-goal-id={item.id} data-trpg-goal-badge={item.badge}>
      <p className={`text-sm leading-snug ${item.badge.startsWith("done_") ? "text-zinc-400" : "text-zinc-100"}`}>
        {item.title}
      </p>
      <span
        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass(item.badge)}`}
      >
        {item.label}
      </span>
      {item.hint ? <p className="text-xs leading-relaxed text-zinc-400">{item.hint}</p> : null}
    </li>
  );
}

/**
 * Read-only list of the campaign goals the snapshot already carries. It never answers a resolution proposal;
 * the host does that in the existing goal-claim card. The collapsed bar has a fixed one-line height and the
 * expanded list floats over the page, so a goal change never moves the scene the player is reading.
 */
export function TrpgGoalHud({
  goals,
  hold,
  stickyClassName,
}: {
  goals: readonly TrpgPublicGoal[] | undefined;
  hold: boolean;
  stickyClassName: string;
}) {
  const [shown, setShown] = useState(goals);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const panelId = useId();

  useEffect(() => {
    setShown((previous) => nextShownGoals(previous, goals, hold));
  }, [goals, hold]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [open]);

  const view = goalHudView(shown);
  if (!view) return null;

  const expandable = view.lead !== null || view.done.length > 0;
  const barText = view.lead?.title ?? view.emptyNotice ?? "";
  const barClass =
    "flex min-h-11 w-full items-center gap-2 rounded-xl border border-white/10 bg-[#101218]/95 px-3 py-2 text-left shadow-[0_6px_18px_rgba(0,0,0,0.35)] backdrop-blur";
  const barContent = (
    <>
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-violet-300">목표</span>
      {view.activeCount > 0 ? (
        <span className="shrink-0 rounded-full border border-violet-400/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-200">
          진행 중 {view.activeCount}
        </span>
      ) : null}
      {view.pendingCount > 0 ? (
        <span className="shrink-0 rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
          확인 대기 {view.pendingCount}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-100" data-trpg-goal-hud-lead>
        {barText}
      </span>
      {expandable ? (
        <span aria-hidden className="shrink-0 text-xs text-zinc-400">
          {open ? "접기 ▲" : "펼치기 ▼"}
        </span>
      ) : null}
    </>
  );

  return (
    <section
      ref={rootRef}
      aria-label="현재 목표"
      data-trpg-goal-hud
      data-trpg-goal-hud-open={open ? "true" : "false"}
      data-trpg-goal-hud-held={hold ? "true" : "false"}
      className={`z-30 ${stickyClassName}`}
    >
      <div className="relative">
        {expandable ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
            className={`${barClass} hover:bg-[#161922]`}
          >
            {barContent}
          </button>
        ) : (
          <div className={barClass}>{barContent}</div>
        )}
        {open && expandable ? (
          <div
            id={panelId}
            className="absolute inset-x-0 top-full z-40 mt-1 max-h-[min(60dvh,26rem)] space-y-4 overflow-y-auto rounded-xl border border-white/10 bg-[#161616] p-3 shadow-[0_14px_36px_rgba(0,0,0,0.6)]"
          >
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-300">진행 중 ({view.activeCount})</p>
              {view.active.length > 0 ? (
                <ul className="space-y-3">
                  {view.active.map((item) => (
                    <GoalRow key={item.id} item={item} />
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-400">{view.emptyNotice}</p>
              )}
            </div>
            {view.done.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-zinc-300">최근 달성 ({view.done.length})</p>
                <ul className="space-y-3">
                  {view.done.map((item) => (
                    <GoalRow key={item.id} item={item} />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
