"use client";

import { useMemo, useState } from "react";
import { LOREBOOK_KEYWORDS_PER_ENTRY, parseKeywordField } from "@/lib/keywordLorebooks";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

const keywordSeparator = "│";

function keywordsToField(keywords: string[]) {
  return keywords.join(keywordSeparator);
}

export default function LorebookKeywordInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const keywords = useMemo(() => parseKeywordField(value), [value]);
  const [draft, setDraft] = useState("");

  function commitKeyword(raw: string) {
    const nextKeyword = raw.trim();
    if (!nextKeyword || keywords.length >= LOREBOOK_KEYWORDS_PER_ENTRY) return;
    if (keywords.some((keyword) => keyword === nextKeyword)) {
      setDraft("");
      return;
    }
    onChange(keywordsToField([...keywords, nextKeyword]));
    setDraft("");
  }

  function removeKeyword(keywordToRemove: string) {
    onChange(keywordsToField(keywords.filter((keyword) => keyword !== keywordToRemove)));
  }

  return (
    <div>
      <div
        className={cn(
          "flex min-h-12 w-full flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#161922] px-3 py-2",
          "focus-within:border-violet-500/60 focus-within:ring-2 focus-within:ring-violet-500/20"
        )}
      >
        {keywords.map((keyword) => (
          <span key={keyword} className={studioSurface.chip}>
            <span className="max-w-[12rem] truncate">{keyword}</span>
            <button
              type="button"
              onClick={() => removeKeyword(keyword)}
              className={studioSurface.chipRemove}
              aria-label={`${keyword} 키워드 삭제`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="min-h-11 min-w-[10rem] flex-1 bg-transparent px-1 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed"
          placeholder={
            keywords.length >= LOREBOOK_KEYWORDS_PER_ENTRY
              ? "키워드는 최대 10개까지 등록할 수 있어요."
              : "키워드 입력 후 Enter"
          }
          value={draft}
          disabled={keywords.length >= LOREBOOK_KEYWORDS_PER_ENTRY}
          onChange={(e) => setDraft(e.target.value.replace(/[|│]/g, "").slice(0, 40))}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            commitKeyword(draft);
          }}
          onBlur={() => commitKeyword(draft)}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className={studioType.helper}>
          등록한 키워드가 대화에 나오면 이 항목이 활성화됩니다.
        </span>
        <span className={studioType.counter}>
          {keywords.length}/{LOREBOOK_KEYWORDS_PER_ENTRY}
        </span>
      </div>
    </div>
  );
}
