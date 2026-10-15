"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { StatusNoticeTone } from "@/components/StatusNotice";
import {
  isPointChargeRefundPendingState,
  type PointChargeRefundState,
} from "@/lib/pointChargeRefundShared";
import { POINT_CHARGE_CANCEL_DAYS } from "@/lib/plans";

export default function ChargeCancelButton({
  pointLogId,
  disabled = false,
  cancelled = false,
  state,
  blockReason,
  onToast,
  onCancelled,
}: {
  pointLogId: number;
  disabled?: boolean;
  cancelled?: boolean;
  state?: PointChargeRefundState;
  blockReason?: string;
  onToast?: (msg: string, tone: StatusNoticeTone) => void;
  onCancelled?: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const pending = isPointChargeRefundPendingState(state);
  const needsRecheck = pending || state === "SUCCEEDED";

  async function cancelCharge() {
    if (busy || disabled || cancelled || state === "FAILED" || pointLogId <= 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/points/charge/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pointLogId }),
      });
      const data = await res.json();
      if (!res.ok) {
        onToast?.(data.error || "결제 취소에 실패했습니다.", "error");
        onCancelled?.();
        return;
      }

      if (data.status === "refunded") {
        onToast?.("결제가 취소되어 포인트가 회수되었습니다.", "success");
      } else if (data.status === "pending") {
        onToast?.(data.message || "환불 처리가 진행 중입니다.", "info");
      } else if (data.status === "reconciliation_required") {
        onToast?.(data.message || "환불 결과 확인이 필요합니다.", "info");
      } else if (data.status === "skipped") {
        onToast?.(data.message || "다른 요청이 환불 처리를 진행 중입니다.", "info");
      }
      onCancelled?.();
    } catch {
      onToast?.("네트워크 오류가 발생했습니다.", "error");
    } finally {
      setBusy(false);
    }
  }

  if (cancelled) {
    return <span className="inline-flex min-h-8 items-center text-xs font-medium text-zinc-400">결제 취소 완료</span>;
  }

  if (state === "FAILED") {
    return (
      <p className="text-xs leading-relaxed text-rose-300">
        <span className="font-semibold">환불 실패</span>
        <span className="block text-zinc-400">{blockReason || "PortOne 환불 실패 — 관리자 확인 필요"}</span>
      </p>
    );
  }

  const buttonLabel = pending
    ? "환불 상태 확인"
    : state === "SUCCEEDED"
      ? "취소 마무리"
      : "결제 취소";
  const title = disabled && blockReason
    ? blockReason
    : busy
      ? "처리 중…"
      : pending
        ? "PortOne 환불 상태를 다시 확인합니다. 취소 요청을 재전송하지 않습니다."
        : state === "SUCCEEDED"
          ? "확인된 환불 성공을 로컬 포인트 내역에 반영합니다."
          : `결제 후 ${POINT_CHARGE_CANCEL_DAYS}일 이내·미사용 포인트만 취소 가능`;

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={disabled || busy}
        title={title}
        data-testid="charge-cancel-button"
        onClick={() => {
          if (needsRecheck) {
            void cancelCharge();
            return;
          }
          setConfirmOpen(true);
        }}
        className="min-h-11 rounded-lg border border-white/15 px-4 text-sm font-medium text-zinc-200 transition hover:border-rose-400/40 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
      >
        {busy ? "처리 중…" : buttonLabel}
      </button>
      {(disabled && blockReason) || (!disabled && needsRecheck && blockReason) ? (
        <span className="text-xs leading-relaxed text-zinc-400" data-testid="charge-cancel-reason">
          {blockReason}
        </span>
      ) : null}
      {confirmOpen && (
        <ConfirmDialog
          touchTargets
          open
          title="결제 취소"
          message={`환불 요청을 시작하면 충전한 유료·무료 포인트는 PortOne 환불 결과가 확정될 때까지 사용이 보류됩니다. 환불 성공 확인 후 취소가 최종 확정됩니다. (결제 후 ${POINT_CHARGE_CANCEL_DAYS}일 이내)`}
          confirmLabel="결제 취소"
          danger
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            void cancelCharge();
          }}
        />
      )}
    </div>
  );
}
