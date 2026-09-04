"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatStoredTurnChargeStatusLabel,
  type UserMessageBillingSummary,
} from "@/lib/storedTurnChargeEvidenceShared";
import { IconInfo } from "./ChatToolbarIcons";

export default function BillingChargeStatusTooltip({
  summary,
}: {
  summary: UserMessageBillingSummary;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const label = formatStoredTurnChargeStatusLabel(
    summary.chargeStatus,
    summary.settledPoints
  );

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="포인트 차감 상태"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300 ${
          open ? "bg-white/5 text-zinc-300" : ""
        }`}
      >
        <IconInfo />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="포인트 차감 상태"
          className="absolute bottom-full right-0 z-30 mb-1.5 w-60 rounded-lg border border-white/10 bg-[#1a1a1a]/95 p-2.5 shadow-xl shadow-black/40 backdrop-blur-sm"
        >
          <div className="space-y-1 text-[11px] leading-relaxed text-zinc-300">
            {summary.modelLabel && (
              <p>
                <span className="text-zinc-500">모델:</span> {summary.modelLabel}
              </p>
            )}
            <p>
              <span className="text-zinc-500">생성 상태:</span> {summary.generationStatus}
            </p>
            <p className="font-semibold text-zinc-100">
              <span className="text-zinc-500">차감 상태:</span> {label}
            </p>
            {summary.chargeStatus === "unknown" && (
              <p className="text-[10px] leading-relaxed text-zinc-500">
                저장된 정산 증거가 불완전합니다. 0P로 추정하지 않습니다.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
