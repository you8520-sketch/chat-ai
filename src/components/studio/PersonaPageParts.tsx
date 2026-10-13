"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import StudioButton from "@/components/studio/StudioButton";
import { cn, studioType } from "@/lib/studioDesign";

export type PageNotice = { kind: "ok" | "error"; text: string };

/** Result message that renders next to the form or list that triggered it. */
export function ScopedNotice({
  notice,
  className,
  revealOnChange = false,
}: {
  notice: PageNotice | null;
  className?: string;
  /** Scroll the message into view when it is not docked to a sticky bar. */
  revealOnChange?: boolean;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (revealOnChange && notice) ref.current?.scrollIntoView({ block: "nearest" });
  }, [notice, revealOnChange]);
  if (!notice) return null;
  const error = notice.kind === "error";
  return (
    <p
      ref={ref}
      role={error ? "alert" : "status"}
      className={cn(
        "rounded-xl border px-3 py-2.5 text-sm leading-relaxed",
        error
          ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
          : "border-violet-400/30 bg-violet-500/10 text-violet-100",
        className,
      )}
    >
      {notice.text}
    </p>
  );
}

export function EditingBadge({ children = "수정 중" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-violet-400/50 bg-violet-500/20 px-2 py-0.5 text-[11px] font-semibold text-violet-100">
      {children}
    </span>
  );
}

/**
 * Save / cancel row that stays reachable while a long form scrolls. It docks above the mobile
 * bottom nav and the on-screen keyboard through the same CSS variables the creator save bar uses.
 */
export function EditorActionBar({
  onSave,
  onCancel,
  saving,
  saveDisabled,
  saveLabel = "저장",
  disabledReason,
  notice,
  extra,
}: {
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveDisabled: boolean;
  saveLabel?: string;
  disabledReason?: string | null;
  notice?: PageNotice | null;
  extra?: ReactNode;
}) {
  return (
    <div
      data-testid="editor-action-bar"
      className="sticky bottom-[calc(var(--mobile-nav-offset,0px)+var(--keyboard-inset,0px))] z-10 -mx-4 space-y-2 border-t border-white/10 bg-[#0b0d14]/95 px-4 py-3 backdrop-blur-md sm:-mx-5 sm:px-5"
    >
      <ScopedNotice notice={notice ?? null} />
      {saveDisabled && !saving && disabledReason ? (
        <p className={studioType.caption}>{disabledReason}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <StudioButton type="button" disabled={saveDisabled || saving} onClick={onSave}>
          {saving ? "저장 중…" : saveLabel}
        </StudioButton>
        {extra}
        <StudioButton type="button" variant="secondary" onClick={onCancel}>
          취소
        </StudioButton>
      </div>
    </div>
  );
}

const WIDE_QUERY = "(min-width: 1024px)";

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True from the lg breakpoint up. Server and first paint use the stacked mobile flow. */
export function useWideLayout(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

/**
 * List + editor body of one section. Stacked: the create form sits above the list and the edit
 * form opens inside the row (the list renders it). Wide: the list stays on the left and the form
 * lives in a sticky pane on the right.
 */
export function SectionPanes({
  wide,
  list,
  editor,
  creating,
  placeholder,
}: {
  wide: boolean;
  list: ReactNode;
  editor: ReactNode;
  creating: boolean;
  placeholder: string;
}) {
  if (!wide) {
    return (
      <>
        {creating ? editor : null}
        {list}
      </>
    );
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-start gap-5">
      <div className="min-w-0 space-y-3">{list}</div>
      <div className="sticky top-24 max-h-[calc(100vh-7rem)] min-w-0 overflow-y-auto rounded-xl">
        {editor ?? (
          <p className="rounded-xl border border-dashed border-white/15 bg-[#0e1120] px-4 py-10 text-center text-sm leading-relaxed text-zinc-400">
            {placeholder}
          </p>
        )}
      </div>
    </div>
  );
}
