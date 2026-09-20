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
  const { focusBody, focusBodyMax } = splitUserNoteBodyForEditor(
    body,
    widgetReservedChars,
    focusMaxChars
  );
  const { focusChars } = userNoteZoneBreakdown(body, widgetReservedChars, focusMaxChars);

  const defaultBody = defaultUserNote.trim()
    ? parseUserNoteCombined(defaultUserNote).body || defaultUserNote.trim()
    : "";

  const updateFocus = (next: string) => {
    onUserNoteChange(next.slice(0, focusBodyMax));
  };

  const focusPlaceholder = defaultBody ? defaultBody.slice(0, focusBodyMax) : "";

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3">
        <div>
          <p className="text-[11px] font-bold text-amber-200">중요 기억 · 고집중</p>
          <p className="mt-0.5 text-[10px] leading-relaxed">
            매 턴 전량 주입 · 최대 {focusBodyMax.toLocaleString()}자
          </p>
        </div>
        {canEditFocus ? (
          <textarea
            className={textareaClassName}
            rows={focusRows}
            value={focusBody}
            placeholder={focusPlaceholder}
            maxLength={focusBodyMax}
            onChange={(e) => updateFocus(e.target.value)}
          />
        ) : (
          <div className={readOnlyBoxClass}>{focusBody || "—"}</div>
        )}
        <p className="text-[10px] text-amber-200/80">
          {focusChars.toLocaleString()} / {focusBodyMax.toLocaleString()}자
        </p>
        {focusFooter}
      </section>

      {!focusOnly && userLorebookSlot}
    </div>
  );
}
