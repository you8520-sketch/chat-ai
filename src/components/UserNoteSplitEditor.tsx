"use client";

import type { ReactNode } from "react";
import {
  mergeUserNoteBodyFromEditor,
  parseUserNoteCombined,
  splitUserNoteBodyForEditor,
  userNoteCombinedCharCount,
  userNoteZoneBreakdown,
  USER_NOTE_REFERENCE_MAX,
} from "@/lib/userNoteStatusWindow";

type UserNoteSplitEditorProps = {
  userNote: string;
  onUserNoteChange: (value: string) => void;
  defaultUserNote?: string;
  focusRows?: number;
  referenceRows?: number;
  textareaClassName?: string;
  /** false — 읽기 전용(스크롤바 숨김), true — 편집(스크롤바 표시) */
  editing?: boolean;
  editingFocus?: boolean;
  editingReference?: boolean;
  /** 관리 보관함 — 고집중 구간만 */
  focusOnly?: boolean;
  /** 상태창 위젯 상태값·지시 토큰 환산 글자 수 (고집중 구간과 별도) */
  widgetReservedChars?: number;
  focusFooter?: ReactNode;
  referenceFooter?: ReactNode;
};

const readOnlyBoxClass =
  "max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 font-mono text-xs leading-relaxed text-zinc-200 scrollbar-hide";

const referenceTextareaClass =
  "w-full rounded-lg border-2 border-violet-400/45 bg-[#252532] px-3 py-2.5 font-mono text-sm leading-relaxed text-zinc-50 shadow-inner shadow-black/20 outline-none ring-0 placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/30";

export default function UserNoteSplitEditor({
  userNote,
  onUserNoteChange,
  defaultUserNote = "",
  focusRows = 6,
  referenceRows = 8,
  textareaClassName = "w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 font-mono text-xs leading-relaxed text-zinc-200 outline-none focus:border-amber-500/40",
  editing = true,
  editingFocus,
  editingReference,
  focusOnly = false,
  widgetReservedChars = 0,
  focusFooter,
  referenceFooter,
}: UserNoteSplitEditorProps) {
  const canEditFocus = editingFocus ?? editing;
  /** 참조 구간은 항상 입력 가능 */
  const canEditReference = !focusOnly;
  const { body, statusTemplate } = parseUserNoteCombined(userNote);
  const { focusBody, referenceBody, focusBodyMax, referenceBodyMax } =
    splitUserNoteBodyForEditor(body, widgetReservedChars);
  const combinedChars = userNoteCombinedCharCount(body, statusTemplate);
  const { referenceChars } = userNoteZoneBreakdown(combinedChars, widgetReservedChars);

  const defaultBody = defaultUserNote.trim()
    ? parseUserNoteCombined(defaultUserNote).body || defaultUserNote.trim()
    : "";

  const updateFocus = (next: string) => {
    onUserNoteChange(mergeUserNoteBodyFromEditor(next, referenceBody, widgetReservedChars));
  };

  const updateReference = (next: string) => {
    onUserNoteChange(mergeUserNoteBodyFromEditor(focusBody, next, widgetReservedChars));
  };

  const focusPlaceholder = defaultBody ? defaultBody.slice(0, focusBodyMax) : "";
  const referencePlaceholder = "장기 세계관, NPC 목록, 사건 연표, 부가 설정… (선택)";

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3">
        <div>
          <p className="text-[11px] font-bold text-amber-200">중요 기억 · 고집중 구간</p>
          <p className="mt-0.5 text-[10px] leading-relaxed">
            {focusOnly ? (
              <>
                <span className="text-amber-100/85">
                  절대 규칙(OOC), 관계, AI에게 줄 핵심지시 등 잊지말아야 할 설정.
                </span>
                <span className="block mt-0.5 text-amber-400/80">
                  보관함에 제목과 함께 저장할 수 있습니다.
                </span>
              </>
            ) : (
              <>
                <span className="text-amber-100/85">
                  규칙(OOC)등 AI가 반드시 기억해야할 고정 규칙이나 설정.
                </span>
                <span className="block mt-0.5 text-amber-400/80">
                  수정 후 「저장」으로 이 대화방에 적용합니다.
                </span>
              </>
            )}
          </p>
        </div>
        {canEditFocus ? (
          <textarea
            rows={focusRows}
            value={focusBody}
            onChange={(e) => updateFocus(e.target.value)}
            placeholder={focusPlaceholder}
            className={`${textareaClassName} resize-none overflow-y-auto border-amber-500/25 focus:border-amber-500/50`}
          />
        ) : (
          <div
            className={`${readOnlyBoxClass} border-amber-500/25 ${
              focusBody.trim() ? "text-zinc-200" : "text-zinc-600"
            }`}
          >
            {focusBody.trim() || focusPlaceholder}
          </div>
        )}
        <p className="text-[10px] font-medium text-amber-100/90">
          본문 {focusBody.length.toLocaleString()} / {focusBodyMax.toLocaleString()}자 (고집중)
        </p>
        {focusFooter}
      </section>

      {!focusOnly && (
      <section className="space-y-2 rounded-lg border border-violet-500/35 bg-violet-500/[0.1] p-3">
        <div>
          <p className="text-[11px] font-bold text-violet-100">유저노트 확장구간</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400">
            세계관·NPC·사건 등
            <span className="block mt-0.5 text-violet-200/80">확장구간의 내용은 이 대화방에 저장됩니다.</span>
          </p>
        </div>
        <textarea
          rows={referenceRows}
          value={referenceBody}
          onChange={(e) => updateReference(e.target.value)}
          placeholder={referencePlaceholder}
          className={`${referenceTextareaClass} min-h-[9rem] resize-y overflow-y-auto`}
        />
        <p className="text-[10px] text-zinc-400">
          {referenceBody.length.toLocaleString()} / {referenceBodyMax.toLocaleString()}자 · 참조
          구간 {referenceChars.toLocaleString()} / {USER_NOTE_REFERENCE_MAX.toLocaleString()}자
        </p>
        {referenceFooter}
      </section>
      )}

    </div>
  );
}
