"use client";

import { useState } from "react";
import {
  CHARACTER_TAG_MAX_COUNT,
  normalizeCharacterTag,
} from "@/lib/characterTags";

type Props = {
  tags: string[];
  onChange: (tags: string[]) => void;
  inputClassName?: string;
  disabled?: boolean;
  placeholder?: string;
};

export default function TagChipInput({
  tags,
  onChange,
  inputClassName = "",
  disabled = false,
  placeholder = "태그 입력 후 Enter",
}: Props) {
  const [draft, setDraft] = useState("");

  function addTag(raw: string) {
    const next = normalizeCharacterTag(raw);
    if (!next || tags.includes(next)) {
      setDraft("");
      return;
    }
    if (tags.length >= CHARACTER_TAG_MAX_COUNT) {
      setDraft("");
      return;
    }
    onChange([...tags, next]);
    setDraft("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        className={inputClassName}
        value={draft}
        disabled={disabled || tags.length >= CHARACTER_TAG_MAX_COUNT}
        placeholder={
          tags.length >= CHARACTER_TAG_MAX_COUNT
            ? `태그는 최대 ${CHARACTER_TAG_MAX_COUNT}개까지`
            : placeholder
        }
        onChange={(e) => setDraft(e.target.value.replace(/[,，]/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addTag(draft);
          }
          if (e.key === "Backspace" && !draft && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (draft.trim()) addTag(draft);
        }}
      />
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/5 px-3 py-2 text-xs font-medium text-zinc-200 ring-1 ring-white/10"
            >
              #{tag}
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
                  aria-label={`${tag} 태그 삭제`}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-400">입력 후 Enter · 예: 로판 → #로판</p>
      )}
    </div>
  );
}
