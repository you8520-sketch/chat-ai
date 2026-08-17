"use client";

import Link from "next/link";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";
import { hueFromId } from "@/lib/trpg/catalogBrowse";

export default function TrpgCatalogCard({
  kind,
  id,
  title,
  summary,
  creatorName,
  genres,
  badge,
  emoji,
  coverUrl,
  selected,
  onSelect,
  editHref,
}: {
  kind: "world" | "scenario";
  id: number;
  title: string;
  summary: string;
  creatorName?: string;
  genres: readonly string[];
  badge?: string;
  emoji: string;
  coverUrl?: string | null;
  selected?: boolean;
  onSelect: () => void;
  editHref?: string;
}) {
  const hue = hueFromId(id);
  const kindLabel = kind === "world" ? "샌드박스" : "시나리오";

  return (
    <article
      className={cn(
        studioSurface.card,
        "group/card flex h-full flex-col overflow-hidden rounded-2xl bg-[#11141f] shadow-[0_18px_50px_rgba(0,0,0,.18)] transition duration-300 hover:-translate-y-1.5 hover:border-violet-400/40 hover:shadow-[0_22px_60px_rgba(0,0,0,.34)]",
        selected ? "border-violet-400/70 ring-1 ring-violet-400/40" : "",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={`${kindLabel} 읽기: ${title}`}
        className="relative block w-full text-left"
      >
        <div
          className={`relative ${kind === "world" ? "aspect-square" : "aspect-[2/3]"} w-full overflow-hidden bg-black`}
          style={
            kind === "world"
              ? undefined
              : {
                  background: `linear-gradient(135deg, hsl(${hue} 50% 18%), hsl(${(hue + 40) % 360} 45% 10%))`,
                }
          }
        >
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
          ) : kind === "world" ? null : (
            <span className="flex h-full w-full items-center justify-center text-5xl sm:text-6xl">{emoji}</span>
          )}
          <span className="pointer-events-none absolute inset-2.5 z-[2] rounded-[0.55rem] border border-white/15 transition duration-300 group-hover/card:border-violet-200/30" />
          <div className="absolute left-2.5 top-2.5 z-[4] flex flex-wrap gap-1">
            <span className="rounded-md border border-white/10 bg-violet-600/90 px-1.5 py-1 text-[9px] font-bold leading-none text-white shadow-sm backdrop-blur">
              {kindLabel}
            </span>
            {badge ? (
              <span className="rounded-md border border-white/10 bg-black/50 px-1.5 py-1 text-[9px] font-bold leading-none text-white shadow-sm backdrop-blur">
                {badge}
              </span>
            ) : null}
          </div>
        </div>
      </button>

      <div className="flex min-h-[10.5rem] flex-1 flex-col gap-1.5 p-3.5">
        <button type="button" onClick={onSelect} className="min-w-0 text-left">
          <h3 className="line-clamp-1 text-[15px] font-semibold tracking-[-0.02em] text-zinc-50 transition group-hover/card:text-violet-200">
            {title}
          </h3>
        </button>
        {creatorName ? (
          <p className="line-clamp-1 text-[10px] font-medium text-zinc-500">
            <span className="text-zinc-600">by</span> {creatorName}
          </p>
        ) : null}
        <button type="button" onClick={onSelect} className="min-w-0 text-left">
          {summary.trim() ? (
            <p className={cn(studioType.caption, "line-clamp-3 min-h-[3.75rem] text-[12px] leading-5 text-zinc-300")}>
              {summary}
            </p>
          ) : (
            <p className="min-h-[3.75rem] text-xs leading-5 text-zinc-600">한 줄 소개 없음</p>
          )}
        </button>
        {genres.length > 0 ? (
          <div className="mt-auto flex max-h-[3.15rem] flex-wrap gap-1.5 overflow-hidden pt-1">
            {genres.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-white/[0.06] bg-white/[0.035] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-auto" />
        )}
        {editHref ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              href={editHref}
              className="inline-flex min-h-8 items-center justify-center rounded-lg border border-white/10 px-2.5 text-[11px] font-semibold text-zinc-300 hover:bg-white/5"
            >
              수정
            </Link>
          </div>
        ) : null}
      </div>
    </article>
  );
}
