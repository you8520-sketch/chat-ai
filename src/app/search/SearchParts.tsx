import Link from "next/link";
import type { ReactNode } from "react";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

export type SearchState = { q?: string; g?: string };

export function searchHref(opts: SearchState): string {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.g) params.set("g", opts.g);
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const CHIP_BASE =
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-4 text-sm font-semibold transition motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300";

/** Genre chips are rounded rectangles; tag chips (below) are pills, so the two filters never read as one set. */
export function GenreChip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        CHIP_BASE,
        "rounded-xl border",
        active
          ? "border-violet-400/60 bg-violet-600 text-white"
          : "border-white/10 bg-[#161922] text-zinc-300 hover:border-white/20 hover:text-zinc-50",
      )}
    >
      {active && <CheckIcon />}
      {children}
    </Link>
  );
}

export function TagChip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        CHIP_BASE,
        "rounded-full border",
        active
          ? "border-violet-400/60 bg-violet-500/20 text-violet-100"
          : "border-white/10 bg-transparent text-zinc-300 hover:border-white/20 hover:text-zinc-50",
      )}
    >
      {active && <CheckIcon />}
      <span aria-hidden="true" className="text-zinc-500">
        #
      </span>
      {children}
    </Link>
  );
}

export function FilterLabel({ children }: { children: ReactNode }) {
  return <p className={cn(studioType.caption, "mb-2 font-semibold text-zinc-300")}>{children}</p>;
}

const REMOVE_CHIP =
  "inline-flex min-h-11 items-center gap-2 rounded-full bg-violet-500/15 pl-4 pr-3 text-sm font-medium text-violet-100 ring-1 ring-violet-400/30 transition hover:bg-violet-500/25 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300";

function RemoveIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

/** What the page is currently filtered by, each with a one-tap way back. */
export function ActiveFilters({ query, genre }: { query: string; genre: string | null }) {
  if (!query && !genre) return null;
  return (
    <div role="group" aria-label="적용된 검색 조건" className="flex flex-wrap items-center gap-2" data-testid="search-active-filters">
      <span className={cn(studioType.caption, "font-semibold text-zinc-300")}>적용 중</span>
      {query ? (
        <Link href={searchHref({ g: genre ?? undefined })} className={REMOVE_CHIP} aria-label={`검색어 ${query} 해제`}>
          <span className="max-w-[12rem] truncate">검색어 「{query}」</span>
          <RemoveIcon />
        </Link>
      ) : null}
      {genre ? (
        <Link href={searchHref({ q: query || undefined })} className={REMOVE_CHIP} aria-label={`장르 ${genre} 해제`}>
          <span>장르 {genre}</span>
          <RemoveIcon />
        </Link>
      ) : null}
      {query && genre ? (
        <Link href="/search" className={cn(studioType.caption, "inline-flex min-h-11 items-center px-2 font-semibold underline-offset-2 hover:text-zinc-100 hover:underline")}>
          모두 지우기
        </Link>
      ) : null}
    </div>
  );
}

export function SearchResultsSummary({
  query,
  genre,
  count,
  limit,
}: {
  query: string;
  genre: string | null;
  count: number;
  limit: number;
}) {
  const capped = count >= limit;
  return (
    <div data-testid="search-summary" role="status">
      <p className={studioType.body}>
        {query ? (
          <>
            <span className="break-all font-semibold text-violet-300">「{query}」</span>
            {genre ? (
              <>
                {" "}
                · <span className="font-semibold text-violet-300">{genre}</span>
              </>
            ) : null}{" "}
            검색 결과{" "}
          </>
        ) : (
          <>
            <span className="font-semibold text-violet-300">{genre}</span> 장르{" "}
          </>
        )}
        {capped ? (
          <span className="text-zinc-50">최대 {limit}개 표시</span>
        ) : (
          <>
            <span className="text-zinc-50">{count}</span>건
          </>
        )}
      </p>
      {capped ? (
        <p className={cn(studioType.helper, "mt-1")}>결과가 많아 일부만 보여요. 검색어를 더 구체적으로 쓰거나 장르·태그로 좁혀 보세요.</p>
      ) : null}
    </div>
  );
}

export function SearchEmpty({ query, genre }: { query: string; genre: string | null }) {
  return (
    <div className={cn(studioSurface.cardDashed, "mt-4 px-5 py-8 text-center")} data-testid="search-empty">
      <p className="break-words text-base font-semibold text-zinc-100">
        {query ? (
          <>
            「{query}」{genre ? <> · {genre}</> : null}에 해당하는 결과가 없습니다.
          </>
        ) : (
          <>「{genre}」 장르에 해당하는 캐릭터가 없습니다.</>
        )}
      </p>
      <p className={cn(studioType.helper, "mx-auto mt-2 max-w-sm")}>
        철자를 확인하거나 더 짧은 검색어로 다시 찾아보세요. 아래 인기 태그를 눌러도 좋아요.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {genre && query ? (
          <Link href={searchHref({ q: query })} className={cn(studioSurface.chip, "min-h-11 px-4 text-sm font-semibold hover:bg-white/10")}>
            장르 해제하고 다시 보기
          </Link>
        ) : null}
        {genre && !query ? (
          <Link href="/search" className={cn(studioSurface.chip, "min-h-11 px-4 text-sm font-semibold hover:bg-white/10")}>
            장르 해제
          </Link>
        ) : null}
        {query ? (
          <Link href={searchHref({ g: genre ?? undefined })} className={cn(studioSurface.chip, "min-h-11 px-4 text-sm font-semibold hover:bg-white/10")}>
            검색어 지우기
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function SearchGuide() {
  return (
    <div className={cn(studioSurface.cardDashed, "mt-6 px-5 py-8 text-center")} data-testid="search-guide">
      <p className="text-base font-semibold text-zinc-100">찾고 싶은 작품을 검색해 보세요</p>
      <p className={cn(studioType.helper, "mx-auto mt-2 max-w-sm")}>
        위 검색창에 캐릭터 이름이나 제작자를 입력하거나, 장르·인기 태그를 눌러 둘러볼 수 있어요.
      </p>
    </div>
  );
}
