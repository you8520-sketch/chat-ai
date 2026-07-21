"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** 공개 페이지 배지 행 — 캐릭터 북마크(좋아요 테이블 재사용) 토글 */
export default function CharacterBookmarkBadge({
  characterId,
  bookmarked: initialBookmarked,
  loggedIn,
}: {
  characterId: number;
  bookmarked: boolean;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!loggedIn) {
      router.push(`/login?redirect=${encodeURIComponent(`/character/${characterId}`)}`);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/characters/${characterId}/like`, { method: "POST" });
      const data = (await res.json()) as { liked?: boolean; error?: string };
      if (!res.ok) return;
      setBookmarked(!!data.liked);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      className={`rounded px-2 py-0.5 text-xs font-bold transition disabled:opacity-50 ${
        bookmarked
          ? "bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/40"
          : "bg-white/10 text-zinc-300 hover:bg-white/15"
      }`}
      aria-pressed={bookmarked}
      title={bookmarked ? "북마크 해제" : "북마크"}
    >
      {bookmarked ? "🔖 북마크됨" : "🔖 북마크"}
    </button>
  );
}
