"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import StatusWidgetPreview from "@/components/StatusWidgetPreview";
import {
  formatStatusWidgetShareDate,
  type PublicStatusWidgetShareCard,
  type StatusWidgetShareSort,
} from "@/lib/statusWidgetShareTypes";

type Props = {
  items: PublicStatusWidgetShareCard[];
  sort: StatusWidgetShareSort;
  viewerUserId: number | null;
};

const SORTS: Array<{ id: StatusWidgetShareSort; label: string }> = [
  { id: "popular", label: "인기순" },
  { id: "newest", label: "최신순" },
];

export default function StatusWidgetCommunity({ items, sort, viewerUserId }: Props) {
  const router = useRouter();
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function unpublish(slug: string) {
    setBusySlug(slug);
    setError("");
    try {
      const res = await fetch(`/api/status-widget-shares/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: "unlisted" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "공개 해제에 실패했습니다.");
        return;
      }
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setBusySlug(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="상태창 정렬">
        {SORTS.map((tab) => {
          const active = sort === tab.id;
          return (
            <Link
              key={tab.id}
              href={tab.id === "popular" ? "/widgets" : "/widgets?sort=newest"}
              role="tab"
              aria-selected={active}
              className={`inline-flex min-h-10 items-center rounded-xl px-3.5 text-sm font-semibold transition ${
                active
                  ? "bg-violet-600 text-white"
                  : "border border-white/10 text-zinc-300 hover:bg-white/5"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}

      {items.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-zinc-500">
          아직 커뮤니티에 공개된 상태창이 없습니다.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.shareSlug}
              className="flex min-w-0 flex-col rounded-2xl border border-white/10 bg-[#131626] p-4"
            >
              <div className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0c] p-2">
                <StatusWidgetPreview widget={item.widget} lazy={item.renderer === "jsx"} />
              </div>
              <div className="mt-3 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="min-w-0 text-base font-bold text-white">{item.title}</h2>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-bold text-zinc-300">
                    {item.renderer === "jsx" ? "JSX" : "HTML"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  @{item.authorNickname} · {formatStatusWidgetShareDate(item.createdAt)}
                </p>
                <p className="mt-1 text-xs text-zinc-400">가져온 사람 {item.uniqueImportCount}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={`/widget/apply/${item.shareSlug}`}
                  className="inline-flex min-h-10 items-center rounded-lg bg-violet-600 px-3 text-xs font-bold text-white hover:bg-violet-500"
                >
                  적용하기
                </Link>
                {viewerUserId != null && viewerUserId === item.authorUserId ? (
                  <button
                    type="button"
                    disabled={busySlug === item.shareSlug}
                    onClick={() => void unpublish(item.shareSlug)}
                    className="inline-flex min-h-10 items-center rounded-lg border border-white/10 px-3 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-40"
                  >
                    {busySlug === item.shareSlug ? "해제 중…" : "공개 해제"}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
