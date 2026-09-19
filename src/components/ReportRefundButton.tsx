"use client";

import { useState } from "react";
import { IconReportError } from "@/components/ChatToolbarIcons";

const reportToolbarBtn =
  "flex h-8 w-8 items-center justify-center rounded-lg text-rose-400/90 transition hover:bg-white/[0.08] hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30";
import ConfirmDialog from "@/components/ConfirmDialog";
import { AUTO_REFUND_DAILY_LIMIT } from "@/lib/reportRefundPolicy";
import {
  REPORT_REFUND_UI_CATEGORIES,
  REPORT_REFUND_CATEGORY_LABELS,
  type ReportRefundUiCategory,
} from "@/lib/reportRefundCategories";

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
  const [category, setCategory] = useState<ReportRefundUiCategory | null>(null);

  async function submitReport(selectedCategory: ReportRefundUiCategory) {
    if (busy || isRefunded || isReportPending || disabled || messageId <= 0 || chatId <= 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/chat/report-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, chatId, category: selectedCategory }),
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
          message={
            <div className="space-y-3 text-left text-sm text-zinc-300">
              <p>
                해당 AI 응답의 문제 유형을 선택해 주세요. 서버에서 확인되면 하루 {AUTO_REFUND_DAILY_LIMIT}회까지
                자동 환불됩니다. 한도를 넘기면 관리자 확인 후 환불 여부가 결정됩니다.
              </p>
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-xs font-medium text-zinc-400">문제 유형</legend>
                {REPORT_REFUND_UI_CATEGORIES.map((value) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 hover:bg-white/5"
                  >
                    <input
                      type="radio"
                      name={`report-category-${messageId}`}
                      value={value}
                      checked={category === value}
                      onChange={() => setCategory(value)}
                      className="accent-rose-400"
                    />
                    <span>{REPORT_REFUND_CATEGORY_LABELS[value]}</span>
                  </label>
                ))}
              </fieldset>
            </div>
          }
          confirmLabel="신고하기"
          confirmDisabled={category == null}
          onCancel={() => {
            setConfirmOpen(false);
            setCategory(null);
          }}
          onConfirm={() => {
            if (!category) return;
            setConfirmOpen(false);
            void submitReport(category);
            setCategory(null);
          }}
        />
      )}
    </>
  );
}
