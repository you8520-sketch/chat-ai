"use client";

import { useState } from "react";
import { IconReportError } from "@/components/ChatToolbarIcons";

const reportToolbarBtn =
  "flex h-8 w-8 items-center justify-center rounded-lg text-rose-400/90 transition hover:bg-white/[0.08] hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30";
import ConfirmDialog from "@/components/ConfirmDialog";
import { AUTO_REFUND_DAILY_LIMIT } from "@/lib/reportRefundPolicy";

export type ReportRefundSubmitResult = {
  status: "pending" | "approved";
  autoRefund?: boolean;
};

export default function ReportRefundButton({
  messageId,
  chatId,
  isRefunded = false,
  isReportPending = false,
  disabled = false,
  onToast,
  onReported,
  className = "",
}: {
  messageId: number;
  chatId: number;
  isRefunded?: boolean;
  isReportPending?: boolean;
  disabled?: boolean;
  onToast?: (msg: string) => void;
  onReported?: (result: ReportRefundSubmitResult) => void;
  className?: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submitReport() {
    if (busy || isRefunded || isReportPending || disabled || messageId <= 0 || chatId <= 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/chat/report-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, chatId }),
      });
      const data = await res.json();
      if (!res.ok) {
        onToast?.(data.error || "오류 신고에 실패했습니다.");
        return;
      }
      onToast?.(data.message || "오류 신고가 접수되었습니다.");
      onReported?.({
        status: data.status === "approved" ? "approved" : "pending",
        autoRefund: data.autoRefund === true,
      });
    } catch {
      onToast?.("네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const inactive = disabled || busy || isRefunded || isReportPending;
  const ariaLabel = isRefunded
    ? "환불 완료"
    : isReportPending
      ? "신고 접수됨"
      : "오류 신고";

  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        title={ariaLabel}
        disabled={inactive}
        onClick={() => setConfirmOpen(true)}
        className={`${reportToolbarBtn} ${className} ${
          isRefunded || isReportPending ? "cursor-default text-zinc-600 hover:bg-transparent hover:text-zinc-600" : ""
        }`}
      >
        <IconReportError />
      </button>
      {confirmOpen && (
        <ConfirmDialog
          open
          title="오류 신고"
          message={`해당 AI 응답에 오류(짧은 출력·중복·비정상 등)가 있나요? 확인되면 하루 ${AUTO_REFUND_DAILY_LIMIT}회까지 자동 환불됩니다. 한도를 넘기면 관리자 확인 후 환불 여부가 결정됩니다.`}
          confirmLabel="신고하기"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            void submitReport();
          }}
        />
      )}
    </>
  );
}
