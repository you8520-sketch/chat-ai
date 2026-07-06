"use client";

import { useEffect, useRef, useState } from "react";
import { formatPoints } from "@/lib/billingDisplay";
import { FREE_POINTS_VALID_MONTHS } from "@/lib/plans";
import { ATTENDANCE_POINTS_VALID_MONTHS } from "@/lib/attendanceConstants";

type Props = {
  total: number;
  paid: number;
  free: number;
  children: React.ReactNode;
  className?: string;
  /** true면 클릭 시 툴팁 토글. Link 등 자체 클릭 동작이 있으면 false */
  enableClickToggle?: boolean;
};

export default function PointsBalanceTooltip({
  total,
  paid,
  free,
  children,
  className = "",
  enableClickToggle = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div
        onClick={enableClickToggle ? () => setOpen((v) => !v) : undefined}
        className={enableClickToggle ? "cursor-default" : undefined}
        aria-label={`보유 포인트 ${formatPoints(total)}P, 유료 ${formatPoints(paid)}P, 무료 ${formatPoints(free)}P`}
      >
        {children}
      </div>
      {open && (
        <div
          role="tooltip"
          className="absolute left-1/2 top-full z-50 mt-1.5 w-max -translate-x-1/2 rounded-lg border border-white/10 bg-[#1a1a1a]/95 px-2.5 py-1.5 text-[11px] text-zinc-300 shadow-lg shadow-black/40 backdrop-blur-sm"
        >
          (유료: {formatPoints(paid)} P / 무료: {formatPoints(free)} P)
          <br />
          <span className="text-amber-300/90">충전 보너스·이벤트 무료 포인트 · {FREE_POINTS_VALID_MONTHS}개월 유효</span>
          <br />
          <span className="text-emerald-300/90">출석 포인트 · {ATTENDANCE_POINTS_VALID_MONTHS}개월 유효</span>
        </div>
      )}
    </div>
  );
}
