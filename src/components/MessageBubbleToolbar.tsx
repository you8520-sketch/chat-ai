"use client";

import { useState, type ReactNode } from "react";
import { buildBillingReceipt } from "@/lib/billingDisplay";
import type { Usage } from "@/lib/chatUsage";
import BillingReceiptTooltip from "./BillingReceiptTooltip";
import ConfirmDialog from "./ConfirmDialog";
import ReportRefundButton from "./ReportRefundButton";
import BookmarkTitleDialog from "./BookmarkTitleDialog";
import ForkTitleDialog from "./ForkTitleDialog";
import { defaultBookmarkTitle } from "@/lib/bookmarks";
import { defaultForkTitle } from "@/lib/chatTitle";
import {
  IconBookmark,
  IconEdit,
  IconFork,
  IconRegenerate,
  IconTrash,
} from "./ChatToolbarIcons";
import {
  ThumbsDownFeedbackControl,
  useThumbsDownFeedback,
} from "./MessageThumbsDownFeedback";

const toolbarBtn =
  "flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-white/[0.08] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30";

type ConfirmKind = "regenerate" | "delete";

const CONFIRM_COPY: Record<
  ConfirmKind,
  { title: string; message: string; confirmLabel: string; danger?: boolean }
> = {
  regenerate: {
    title: "답변 재생성",
    message:
      "마지막 AI 답변을 다른 전개로 다시 생성할까요? 직전 상황은 유지되며, 유저 입력은 그대로입니다. 포인트가 다시 차감됩니다.",
    confirmLabel: "재생성",
  },
  delete: {
    title: "턴 삭제",
    message: "마지막 대화 턴(유저 입력 + AI 답변)을 삭제할까요?",
    confirmLabel: "삭제",
    danger: true,
  },
};

export default function MessageBubbleToolbar({
  role,
  messageId,
  chatId,
  content,
  usage,
  isRefunded,
  bookmarked,
  showDelete,
  showRegenerate,
  showFork,
  disabled,
  onToast,
  onBookmarkChange,
  onEditStart,
  onTurnDeleted,
  onFork,
  onRegenerate,
  onRefunded,
  onReportSubmitted,
  lengthHint,
  showReportRefund = false,
  reportRefundPending = false,
  variantPicker,
  compact = false,
  showFullReceipt = false,
}: {
  role: "user" | "assistant";
  messageId?: number;
  chatId: number | null;
  content: string;
  usage?: Usage | null;
  isRefunded?: boolean;
  bookmarked: boolean;
  showDelete: boolean;
  showRegenerate: boolean;
  showFork: boolean;
  disabled?: boolean;
  onToast: (msg: string) => void;
  onBookmarkChange: (messageId: number, bookmarked: boolean) => void;
  onEditStart: () => void;
  onTurnDeleted: () => void;
  onFork: (newChatId: number) => void;
  onRegenerate: () => void;
  onRefunded?: () => void;
  onReportSubmitted?: (result: { status: "pending" | "approved" }) => void;
  /** assistant — 영수증 왼쪽 글자수 (관리자·데모) */
  lengthHint?: ReactNode;
  /** assistant — 본문 하단 우측 오류신고 */
  showReportRefund?: boolean;
  reportRefundPending?: boolean;
  /** assistant — 재생성 버전 ◀ ▶ */
  variantPicker?: ReactNode;
  /** 초상 OFF — 툴바·본문 간격 축소 */
  compact?: boolean;
  /** 관리자·데모유저 — 영수증 전체 필드 */
  showFullReceipt?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [forkOpen, setForkOpen] = useState(false);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const receipt = role === "assistant" && usage ? buildBillingReceipt(usage) : null;
  const feedback = useThumbsDownFeedback({
    disabled: disabled || busy,
    onToast,
  });

  if (!messageId || messageId <= 0 || !chatId) return null;

  function handleBookmarkClick() {
    if (busy || disabled) return;
    if (bookmarked) {
      void saveBookmark();
    } else {
      setBookmarkOpen(true);
    }
  }

  async function saveBookmark(title?: string) {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const payload: { messageId: number; title?: string } = { messageId: messageId! };
      if (title) payload.title = title;

      const res = await fetch("/api/chat/bookmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        onToast(data.error || "북마크 처리에 실패했습니다.");
        return;
      }
      onBookmarkChange(messageId!, !!data.bookmarked);
      if (data.bookmarked) {
        onToast("북마크에 저장했습니다.");
      }
    } catch {
      onToast("네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function forkRoom(title: string) {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const res = await fetch("/api/chat/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, messageId, title }),
      });
      const data = await res.json();
      if (!res.ok) {
        onToast(data.error || "분기 생성에 실패했습니다.");
        return;
      }
      onFork(data.chatId);
    } catch {
      onToast("네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTurn() {
    if (busy || disabled || !showDelete) return;
    setBusy(true);
    try {
      const res = await fetch("/api/chat/turn", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ chatId }),
      });
      const data = await res.json();
      if (!res.ok) {
        onToast(data.error || "삭제에 실패했습니다.");
        return;
      }
      onTurnDeleted();
      onToast("마지막 대화 턴을 삭제했습니다.");
    } catch {
      onToast("네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function runConfirmedAction(kind: ConfirmKind) {
    if (kind === "regenerate") onRegenerate();
    else if (kind === "delete") void deleteTurn();
  }

  const dialog = confirmKind ? CONFIRM_COPY[confirmKind] : null;

  return (
    <>
      <div className={`${compact ? "mt-0.5" : "mt-1"} flex flex-col ${compact ? "gap-0.5" : "gap-1"}`}>
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-0.5">
          <div className="flex flex-wrap items-start gap-0.5">
            {showRegenerate && role === "assistant" && (
              <button
                type="button"
                aria-label="재생성"
                disabled={busy || disabled}
                onClick={() => setConfirmKind("regenerate")}
                className={toolbarBtn}
                title="재생성"
              >
                <IconRegenerate />
              </button>
            )}
            <button
              type="button"
              aria-label="수정"
              disabled={busy || disabled}
              onClick={onEditStart}
              className={toolbarBtn}
              title="수정"
            >
              <IconEdit />
            </button>
            {showDelete && (
              <button
                type="button"
                aria-label="턴 삭제"
                disabled={busy || disabled}
                onClick={() => setConfirmKind("delete")}
                className={toolbarBtn}
                title="이번 턴 삭제"
              >
                <IconTrash />
              </button>
            )}
            {showFork && role === "assistant" && (
              <button
                type="button"
                aria-label="분기 생성"
                disabled={busy || disabled}
                onClick={() => setForkOpen(true)}
                className={toolbarBtn}
                title="분기 생성"
              >
                <IconFork />
              </button>
            )}
            <button
              type="button"
              aria-label="북마크"
              disabled={busy || disabled}
              onClick={handleBookmarkClick}
              className={`${toolbarBtn} ${bookmarked ? "text-amber-400/90 hover:text-amber-300" : ""}`}
              title="북마크"
            >
              <IconBookmark
                className={bookmarked ? "h-[18px] w-[18px] fill-current" : undefined}
              />
            </button>
            {role === "assistant" && (
              <ThumbsDownFeedbackControl
                open={feedback.open}
                text={feedback.text}
                busy={feedback.busy}
                disabled={disabled || busy}
                onToggle={() => feedback.setOpen((v) => !v)}
                onTextChange={feedback.setText}
                onCancel={feedback.closeForm}
                onSubmit={() => void feedback.submitFeedback()}
              />
            )}
            {variantPicker}
          </div>

          {(lengthHint || showReportRefund || receipt) && (
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {lengthHint}
              {showReportRefund && role === "assistant" && (
                <ReportRefundButton
                  messageId={messageId}
                  chatId={chatId}
                  isRefunded={isRefunded}
                  isReportPending={reportRefundPending}
                  disabled={disabled || busy}
                  onToast={onToast}
                  onReported={(result) => {
                    onReportSubmitted?.(result);
                    if (result.status === "approved") onRefunded?.();
                  }}
                />
              )}
              {receipt && (
                <BillingReceiptTooltip
                  usage={usage!}
                  triggerVariant="info"
                  showFullReceipt={showFullReceipt}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {dialog && confirmKind && (
        <ConfirmDialog
          open
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          danger={dialog.danger}
          onCancel={() => setConfirmKind(null)}
          onConfirm={() => {
            const kind = confirmKind;
            setConfirmKind(null);
            runConfirmedAction(kind);
          }}
        />
      )}

      <ForkTitleDialog
        open={forkOpen}
        defaultTitle={defaultForkTitle()}
        onCancel={() => setForkOpen(false)}
        onConfirm={(title) => {
          setForkOpen(false);
          void forkRoom(title);
        }}
      />

      <BookmarkTitleDialog
        open={bookmarkOpen}
        defaultTitle={defaultBookmarkTitle(content)}
        onCancel={() => setBookmarkOpen(false)}
        onConfirm={(title) => {
          setBookmarkOpen(false);
          void saveBookmark(title);
        }}
      />
    </>
  );
}
