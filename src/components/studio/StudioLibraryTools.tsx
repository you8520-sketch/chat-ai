"use client";

import { moderationLabel, visibilityLabel } from "@/lib/characterVisibility";
import {
  type StudioLibraryFilter,
  type StudioLibrarySummary,
  type StudioStatusFilter,
} from "@/lib/studioLibraryView";
import { cn, studioInputClass, studioSelectClass } from "@/lib/studioDesign";

type OverviewTile = {
  id: string;
  label: string;
  count: number;
  filter: StudioLibraryFilter;
  tone?: "attention";
};

function isSameFilter(a: StudioLibraryFilter, b: StudioLibraryFilter) {
  return a.kind === b.kind && a.status === b.status;
}

export function StudioLibraryOverview({
  summary,
  filter,
  onChange,
}: {
  summary: StudioLibrarySummary;
  filter: StudioLibraryFilter;
  onChange: (next: StudioLibraryFilter) => void;
}) {
  const attention = summary.pending + summary.rejected;
  const tiles: OverviewTile[] = [
    { id: "all", label: "전체", count: summary.total, filter: { ...filter, kind: "all", status: "all" } },
    { id: "character", label: "캐릭터", count: summary.character, filter: { ...filter, kind: "character", status: "all" } },
    { id: "simulation", label: "시뮬레이션", count: summary.simulation, filter: { ...filter, kind: "simulation", status: "all" } },
    {
      id: "attention",
      label: "검수 확인 필요",
      count: attention,
      filter: { ...filter, kind: "all", status: "attention" },
      tone: "attention",
    },
  ];
  return (
    <div data-testid="studio-library-overview">
      <ul className="grid grid-cols-4 gap-2">
        {tiles.map((tile) => {
          const pressed = isSameFilter(tile.filter, filter);
          const attentionOn = tile.tone === "attention" && tile.count > 0;
          return (
            <li key={tile.id} className="min-w-0">
              <button
                type="button"
                aria-pressed={pressed}
                disabled={tile.count === 0 && tile.id !== "all"}
                onClick={() => onChange(tile.filter)}
                className={cn(
                  "flex min-h-16 w-full flex-col items-center justify-center rounded-xl border px-1 py-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:cursor-default disabled:opacity-50",
                  pressed
                    ? "border-violet-400/60 bg-violet-600/20 text-white"
                    : attentionOn
                      ? "border-amber-400/30 bg-amber-500/[0.07] text-amber-100 hover:bg-amber-500/10"
                      : "border-white/10 bg-[#131626] text-zinc-200 hover:border-white/20",
                )}
              >
                <span className="text-lg font-semibold leading-none tabular-nums">{tile.count}</span>
                <span className="mt-1 break-keep text-xs font-medium leading-tight text-zinc-300">{tile.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-zinc-400" data-testid="studio-library-visibility-summary">
        {visibilityLabel("public")} {summary.public} · {visibilityLabel("link")} {summary.link} ·{" "}
        {visibilityLabel("private")} {summary.private}
      </p>
    </div>
  );
}

export function StudioLibraryToolbar({
  filter,
  onChange,
  placeholder,
  showStatus,
}: {
  filter: StudioLibraryFilter;
  onChange: (next: StudioLibraryFilter) => void;
  placeholder: string;
  showStatus: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row" data-testid="studio-library-toolbar">
      <input
        type="search"
        inputMode="search"
        value={filter.query}
        onChange={(e) => onChange({ ...filter, query: e.target.value })}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        className={cn(studioInputClass, "min-h-11 min-w-0 flex-1 py-2.5")}
      />
      {showStatus ? (
        <select
          value={filter.status}
          onChange={(e) => onChange({ ...filter, status: e.target.value as StudioStatusFilter })}
          aria-label="상태로 거르기"
          className={cn(studioSelectClass, "min-h-11 sm:w-56")}
        >
          <option value="all">전체 상태</option>
          <optgroup label="공개 범위">
            <option value="public">{visibilityLabel("public")}</option>
            <option value="link">{visibilityLabel("link")}</option>
            <option value="private">{visibilityLabel("private")}</option>
          </optgroup>
          <optgroup label="검수 상태">
            <option value="pending">{moderationLabel("pending")}</option>
            <option value="rejected">{moderationLabel("rejected")}</option>
            <option value="attention">검수 확인 필요 (대기·반려)</option>
          </optgroup>
        </select>
      ) : null}
    </div>
  );
}

export function StudioLibraryResultBar({
  shown,
  matched,
  total,
  filtered,
  onReset,
}: {
  shown: number;
  matched: number;
  total: number;
  filtered: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
      <p aria-live="polite" data-testid="studio-library-count">
        {filtered ? `조건에 맞는 ${matched}개 중 ${shown}개 표시 · 전체 ${total}개` : `전체 ${total}개 중 ${shown}개 표시`}
      </p>
      {filtered ? (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex min-h-9 items-center rounded-lg px-2 font-semibold text-violet-300 hover:text-violet-200"
        >
          필터 초기화
        </button>
      ) : null}
    </div>
  );
}

export function StudioNoMatches({ onReset }: { onReset: () => void }) {
  return (
    <div
      className="mt-4 rounded-xl border border-dashed border-white/15 bg-[#131626]/60 p-8 text-center"
      data-testid="studio-library-no-matches"
    >
      <p className="text-sm text-zinc-300">조건에 맞는 항목이 없습니다.</p>
      <p className="mt-1 text-[13px] text-zinc-400">검색어나 상태 조건을 바꿔 보세요.</p>
      <button
        type="button"
        onClick={onReset}
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-white/10 px-4 text-sm font-semibold text-zinc-200 hover:bg-white/[0.06]"
      >
        필터 초기화
      </button>
    </div>
  );
}

export function StudioLoadMore({ remaining, onClick }: { remaining: number; onClick: () => void }) {
  if (remaining <= 0) return null;
  return (
    <div className="mt-2 flex justify-center">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-white/10 bg-[#131626] px-5 text-sm font-semibold text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.04] sm:w-auto"
      >
        더 보기 (남은 {remaining}개)
      </button>
    </div>
  );
}
