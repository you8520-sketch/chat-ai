"use client";

import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const toolbarBtn =
  "flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-white/[0.08] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30";

const FEEDBACK_MAX = 500;
const THUMBS_DOWN_EMOJI = "👎";

type Options = {
  disabled?: boolean;
  onToast: (msg: string) => void;
};

export function useThumbsDownFeedback({ disabled, onToast }: Options) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  function closeForm() {
    setOpen(false);
    setText("");
  }

  async function submitFeedback() {
    const feedbackReason = text.trim();
    if (!feedbackReason || busy || disabled) return;

    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedbackReason }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        onToast(data.error || "피드백 전송에 실패했습니다.");
        return;
      }
      onToast("피드백이 전송되었습니다. 감사합니다!");
      closeForm();
    } catch {
      onToast("네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return {
    open,
    text,
    busy,
    setOpen,
    setText,
    closeForm,
    submitFeedback,
  };
}

export const ThumbsDownFeedbackButton = forwardRef<
  HTMLButtonElement,
  {
    open: boolean;
    busy: boolean;
    disabled?: boolean;
    onToggle: () => void;
  }
>(function ThumbsDownFeedbackButton({ open, busy, disabled, onToggle }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label="붐따 · 싫어요 피드백"
      aria-expanded={open}
      disabled={disabled || busy}
      onClick={onToggle}
      className={`${toolbarBtn} ${open ? "bg-white/[0.08] ring-1 ring-rose-400/30" : ""}`}
      title="붐따 · 아쉬운 점 보내기"
    >
      <span className="text-[20px] leading-none select-none" aria-hidden>
        {THUMBS_DOWN_EMOJI}
      </span>
    </button>
  );
});

export function ThumbsDownFeedbackPanel({
  open,
  text,
  busy,
  disabled,
  onTextChange,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  text: string;
  busy: boolean;
  disabled?: boolean;
  onTextChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div
      className={`w-[15rem] max-w-[calc(100vw-2rem)] grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out ${
        open
          ? "pointer-events-auto mt-1 grid-rows-[1fr] opacity-100"
          : "pointer-events-none mt-0 grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className={open ? "min-h-0 overflow-visible" : "min-h-0 overflow-hidden"}>
        <div className="rounded-lg border border-white/30 bg-[#131626] p-2 shadow-xl shadow-black/50 ring-1 ring-white/10">
          <textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value.slice(0, FEEDBACK_MAX))}
            placeholder="어떤 점이 아쉬웠나요?"
            rows={2}
            disabled={busy || disabled}
            className="w-full resize-none rounded-md border border-white/25 bg-[#0e1120] px-2 py-1.5 text-xs leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-400/55"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] tabular-nums text-zinc-500">
              {text.length}/{FEEDBACK_MAX}
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="rounded-md border border-white/25 px-2 py-0.5 text-[11px] font-semibold text-zinc-300 transition hover:bg-white/5 hover:text-zinc-100 disabled:opacity-40"
              >
                취소
              </button>
              <button
                type="button"
                disabled={busy || disabled || !text.trim()}
                onClick={onSubmit}
                className="rounded-md border border-violet-400/50 bg-violet-600/25 px-2 py-0.5 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-600/40 disabled:opacity-40"
              >
                {busy ? "전송 중…" : "전송"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThumbsDownFeedbackControl({
  open,
  text,
  busy,
  disabled,
  onToggle,
  onTextChange,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  text: string;
  busy: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onTextChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }

    const panelWidth = 240;

    function updatePosition() {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - panelWidth - 8);
      setPanelPos({
        top: rect.bottom + 4,
        left: Math.min(rect.left, maxLeft),
      });
    }

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  return (
    <>
      <ThumbsDownFeedbackButton
        ref={buttonRef}
        open={open}
        busy={busy}
        disabled={disabled}
        onToggle={onToggle}
      />
      {open &&
        panelPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-[100]"
            style={{ top: panelPos.top, left: panelPos.left }}
          >
            <ThumbsDownFeedbackPanel
              open
              text={text}
              busy={busy}
              disabled={disabled}
              onTextChange={onTextChange}
              onCancel={onCancel}
              onSubmit={onSubmit}
            />
          </div>,
          document.body
        )}
    </>
  );
}
