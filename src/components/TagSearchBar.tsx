"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { cn, studioInputClass } from "@/lib/studioDesign";
import { normalizeCatalogSearchQuery } from "@/lib/tagSearch";

const SEARCH_PLACEHOLDER = "캐릭터·제작자·태그 검색";

type Props = {
  defaultQuery?: string;
  /** Preserve active genre filter when submitting a text search */
  genre?: string | null;
  className?: string;
  compact?: boolean;
};

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.2 13.2L17 17" strokeLinecap="round" />
    </svg>
  );
}

export default function TagSearchBar({
  defaultQuery = "",
  genre = null,
  className = "",
  compact,
}: Props) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(defaultQuery);
  const [syncedQuery, setSyncedQuery] = useState(defaultQuery);

  // The search page keeps this instance mounted across URL-only navigations (tag chips, back/forward),
  // so the field must follow the URL query whenever that query itself changes.
  if (defaultQuery !== syncedQuery) {
    setSyncedQuery(defaultQuery);
    setQ(defaultQuery);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = normalizeCatalogSearchQuery(q);
    if (!trimmed) return;
    const params = new URLSearchParams();
    params.set("q", trimmed);
    if (genre?.trim()) params.set("g", genre.trim());
    router.push(`/search?${params.toString()}`);
  }

  function clear() {
    setQ("");
    inputRef.current?.focus();
  }

  return (
    <form
      onSubmit={submit}
      role="search"
      className={cn("flex min-w-0 items-center", compact ? "gap-1.5" : "gap-2", className)}
    >
      <label htmlFor={inputId} className="sr-only">
        캐릭터·제작자·태그 검색
      </label>
      <div className="relative min-w-0 flex-1">
        <SearchIcon
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-zinc-400",
            compact ? "left-2.5 h-3.5 w-3.5" : "left-3.5 h-[18px] w-[18px]",
          )}
        />
        <input
          id={inputId}
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={SEARCH_PLACEHOLDER}
          maxLength={40}
          className={cn(
            studioInputClass,
            "[&::-webkit-search-cancel-button]:hidden",
            compact ? "py-1.5 pl-8 text-[13px]" : "min-h-12 py-2.5 pl-10 pr-11 text-base",
          )}
        />
        {!compact && q.length > 0 && (
          <button
            type="button"
            onClick={clear}
            aria-label="검색어 지우기"
            className="absolute right-0.5 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 transition hover:text-zinc-100 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <button
        type="submit"
        className={cn(
          "shrink-0 rounded-xl bg-violet-600 font-bold text-white transition hover:bg-violet-500 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300",
          compact ? "px-2.5 py-1.5 text-xs" : "min-h-12 min-w-[4.5rem] px-4 text-base",
        )}
      >
        검색
      </button>
    </form>
  );
}
