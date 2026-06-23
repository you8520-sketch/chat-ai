"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

export default function ChargeCancelButton({
  pointLogId,
  disabled = false,
  cancelled = false,
  blockReason,
  onToast,
  onCancelled,
}: {
  pointLogId: number;
  disabled?: boolean;
  cancelled?: boolean;
  blockReason?: string;
  onToast?: (msg: string) => void;
  onCancelled?: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function cancelCharge() {
    if (busy || disabled || cancelled || pointLogId <= 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/points/charge/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pointLogId }),
      });
      const data = await res.json();
      if (!res.ok) {
        onToast?.(data.error || "결제 취소에 실패했습니다.");
        return;
      }
      onToast?.("결제가 취소되어 포인트가 회수되었습니다.");
      onCancelled?.();
    } catch {
      onToast?.("네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (cancelled) {
    return <span className="text-[9px] leading-none text-gray-600">취소완료</span>;
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || busy}
        title={disabled && blockReason ? blockReason : busy ? "처리 중…" : "결제 후 7일 이내·미사용 포인트만 취소 가능"}
        onClick={() => setConfirmOpen(true)}
        className="rounded border border-white/10 px-2 py-0.5 text-[10px] font-medium text-gray-300 transition hover:border-rose-400/40 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        결제취소
      </button>
      {confirmOpen && (
        <ConfirmDialog
          open
          title="결제 취소"
          message="충전한 유료·무료 포인트를 사용하지 않았다면 결제를 취소하고 포인트를 회수합니다. (결제 후 7일 이내)"
          confirmLabel="결제 취소"
          danger
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            void cancelCharge();
          }}
        />
      )}
    </>
  );
}
