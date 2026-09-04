"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatStoredTurnChargeStatusLabel,
  type UserMessageBillingSummary,
} from "@/lib/storedTurnChargeEvidenceShared";
import type { AdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3Shared";
import { AdminBillingReceiptV3Panel } from "@/components/AdminBillingReceiptV3Panel";
import { IconInfo } from "./ChatToolbarIcons";

export default function BillingChargeStatusTooltip({
  summary,
  messageId,
  showFullReceipt = false,
}: {
  summary: UserMessageBillingSummary;
  /** Admin failed-turn full V3 entry — same canonical endpoint, guard unchanged. */
  messageId?: number;
  showFullReceipt?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [v3Receipt, setV3Receipt] = useState<AdminBillingReceiptV3 | null>(null);
  const [v3Loading, setV3Loading] = useState(false);
  const [v3Error, setV3Error] = useState<string | null>(null);
  const fetchGenerationRef = useRef(0);
  const label = formatStoredTurnChargeStatusLabel(
    summary.chargeStatus,
    summary.settledPoints
  );

  useEffect(() => {
    if (!open || !showFullReceipt || !messageId) return;
    const generation = ++fetchGenerationRef.current;
    setV3Loading(true);
    setV3Error(null);
    void fetch(`/api/chat/admin-billing-receipt?messageId=${messageId}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<AdminBillingReceiptV3>;
      })
      .then((payload) => {
        if (generation !== fetchGenerationRef.current) return;
        setV3Receipt(payload);
      })
      .catch((error: Error) => {
        if (generation !== fetchGenerationRef.current) return;
        setV3Receipt(null);
        setV3Error(error.message);
      })
      .finally(() => {
        if (generation === fetchGenerationRef.current) {
          setV3Loading(false);
        }
      });
  }, [open, showFullReceipt, messageId]);

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
            {showFullReceipt && messageId && (
              <div className="mt-1.5 border-t border-white/10 pt-1.5">
                {v3Loading && (
                  <p className="text-[10px] text-zinc-500">Admin forensic 불러오는 중…</p>
                )}
                {v3Error && (
                  <p className="text-[10px] text-amber-400/90">
                    Admin forensic unavailable — {v3Error}
                  </p>
                )}
                {v3Receipt ? (
                  <AdminBillingReceiptV3Panel receipt={v3Receipt} />
                ) : (
                  !v3Loading &&
                  !v3Error && (
                    <p className="text-[10px] text-zinc-500">
                      Admin forensic은 열림 시 자동 조회됩니다.
                    </p>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
