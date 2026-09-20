"use client";

import type { ReactNode } from "react";
import {
  parseUserNoteCombined,
  splitUserNoteBodyForEditor,
  userNoteZoneBreakdown,
} from "@/lib/userNoteStatusWindow";

type UserNoteSplitEditorProps = {
  userNote: string;
  onUserNoteChange: (value: string) => void;
  defaultUserNote?: string;
  focusRows?: number;
  textareaClassName?: string;
  editing?: boolean;
  editingFocus?: boolean;
  focusOnly?: boolean;
  widgetReservedChars?: number;
  focusMaxChars?: number;
  focusFooter?: ReactNode;
  userLorebookSlot?: ReactNode;
};

const readOnlyBoxClass =
  "max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 font-mono text-xs leading-relaxed text-zinc-200 scrollbar-hide";

export default function UserNoteSplitEditor({
  userNote,
  onUserNoteChange,
  defaultUserNote = "",
  focusRows = 6,
  textareaClassName = "w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 font-mono text-xs leading-relaxed text-zinc-200 outline-none focus:border-amber-500/40",
  editing = true,
  editingFocus,
  focusOnly = false,
  widgetReservedChars = 0,
  focusMaxChars = 1_000,
  focusFooter,
  userLorebookSlot,
}: UserNoteSplitEditorProps) {
  const canEditFocus = editingFocus ?? editing;
  const { body } = parseUserNoteCombined(userNote);
  const { focusBody, focusBodyMax, storedFocusChars, overCurrentPlanLimit } =
    splitUserNoteBodyForEditor(body, widgetReservedChars, focusMaxChars);
  const { focusChars } = userNoteZoneBreakdown(body, widgetReservedChars, focusMaxChars);

  const defaultBody = defaultUserNote.trim()
    ? parseUserNoteCombined(defaultUserNote).body || defaultUserNote.trim()
    : "";

  const focusPlaceholder = defaultBody ? defaultBody.slice(0, focusBodyMax) : "";

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3">
        <div>
          <p className="text-[11px] font-bold text-amber-200">중요 기억 · 고집중</p>
          <p className="mt-0.5 text-[10px] leading-relaxed">
            매 턴 전량 주입 · 현재 요금제 최대 {focusBodyMax.toLocaleString()}자
          </p>
        </div>
        {canEditFocus ? (
          <textarea
            className={textareaClassName}
            rows={focusRows}
            value={focusBody}
            placeholder={focusPlaceholder}
            onChange={(e) => onUserNoteChange(e.target.value)}
          />
        ) : (
          <div className={readOnlyBoxClass}>{focusBody || "—"}</div>
        )}
        <p
          className={`text-[10px] ${overCurrentPlanLimit ? "text-rose-300" : "text-amber-200/80"}`}
        >
          {focusChars.toLocaleString()} / {focusBodyMax.toLocaleString()}자
          {overCurrentPlanLimit ? " · 현재 요금제 한도 초과 (저장하려면 줄여 주세요)" : ""}
        </p>
        {storedFocusChars > focusBodyMax ? (
          <p className="text-[10px] text-rose-300/90">
            저장된 {storedFocusChars.toLocaleString()}자 중 현재 요금제로는 앞{" "}
            {focusBodyMax.toLocaleString()}자만 주입됩니다.
          </p>
        ) : null}
        {focusFooter}
      </section>

      {!focusOnly && userLorebookSlot}
    </div>
  );
}
