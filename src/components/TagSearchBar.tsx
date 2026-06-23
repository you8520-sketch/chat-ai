"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sanitizeSearchQuery } from "@/lib/tagSearch";

type Props = {
  defaultQuery?: string;
  className?: string;
  compact?: boolean;
};

export default function TagSearchBar({ defaultQuery = "", className = "", compact }: Props) {
  const router = useRouter();
  const [q, setQ] = useState(defaultQuery);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = sanitizeSearchQuery(q);
    if (!trimmed) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={submit} className={`flex min-w-0 items-center ${compact ? "gap-1.5" : "gap-2"} ${className}`}>
      <div className="relative min-w-0 flex-1">
        <span
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-gray-500 ${
            compact ? "left-2.5 text-xs" : "left-3 text-sm"
          }`}
        >
          🔍
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            compact
              ? "캐릭터·제작자·태그 검색"
              : "캐릭터명, 제작자명, 태그 검색 (예: 카스펜, 틤작, 츤데레)"
          }
          maxLength={40}
          className={`w-full rounded-xl border border-white/25 bg-[#0e1120] pl-9 pr-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/40 ${
            compact ? "py-1.5 pl-8 text-[13px]" : "py-2"
          }`}
        />
      </div>
      <button
        type="submit"
        className={`shrink-0 rounded-xl bg-violet-600 font-bold text-white hover:bg-violet-500 ${
          compact ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm"
        }`}
      >
        검색
      </button>
    </form>
  );
}
