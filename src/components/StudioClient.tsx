"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import MyCharacterCard, { type MyCharacterRow } from "@/components/MyCharacterCard";
import {
  IconSidebarStudio,
  IconStudioLorebook,
  IconStudioWorld,
} from "@/components/SidebarNavIcons";
import StudioButton from "@/components/studio/StudioButton";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import {
  StudioLibraryOverview,
  StudioLibraryResultBar,
  StudioLibraryToolbar,
  StudioLoadMore,
  StudioNoMatches,
} from "@/components/studio/StudioLibraryTools";
import type { KeywordLorebookListItem } from "@/lib/keywordLorebooks";
import {
  EMPTY_STUDIO_FILTER,
  STUDIO_LIBRARY_PAGE_SIZE,
  STUDIO_LIBRARY_TOOLS_MIN,
  filterStudioWorks,
  isStudioFilterActive,
  matchesLibraryQuery,
  summarizeStudioWorks,
  type StudioLibraryFilter,
} from "@/lib/studioLibraryView";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";
import type { WorldListItem } from "@/lib/worlds";

export type StudioTab = "creations" | "worlds" | "lorebooks";

const TABS: {
  id: StudioTab;
  label: string;
  createHref: string;
  createLabel: string;
  Icon: typeof IconSidebarStudio;
}[] = [
  {
    id: "creations",
    label: "캐릭터",
    createHref: "/create",
    createLabel: "새 캐릭터 만들기",
    Icon: IconSidebarStudio,
  },
  {
    id: "worlds",
    label: "세계관",
    createHref: "/world/create",
    createLabel: "새 세계관 만들기",
    Icon: IconStudioWorld,
  },
  {
    id: "lorebooks",
    label: "로어북",
    createHref: "/lorebook/create",
    createLabel: "새 로어북 만들기",
    Icon: IconStudioLorebook,
  },
];

function parseTab(raw: string | null): StudioTab {
  if (raw === "worlds" || raw === "world") return "worlds";
  if (raw === "lorebooks" || raw === "lorebook" || raw === "lore") return "lorebooks";
  if (
    raw === "creations" ||
    raw === "creation" ||
    raw === "characters" ||
    raw === "character" ||
    raw === "simulations" ||
    raw === "simulation"
  ) {
    return "creations";
  }
  return "creations";
}

type Props = {
  characters: MyCharacterRow[];
  simulations: MyCharacterRow[];
  worlds: WorldListItem[];
  lorebooks: KeywordLorebookListItem[];
  blurNsfw: boolean;
  creatorId: number;
  ownerIsAdmin: boolean;
};

export default function StudioClient({
  characters,
  simulations,
  worlds,
  lorebooks,
  blurNsfw,
  creatorId,
  ownerIsAdmin,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = useMemo(() => parseTab(searchParams.get("tab")), [searchParams]);
  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]!;

  const setTab = useCallback(
    (tab: StudioTab) => {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("kind");
      if (tab === "creations") next.delete("tab");
      else next.set("tab", tab);
      const qs = next.toString();
      router.replace(qs ? `/studio?${qs}` : "/studio", { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <div data-testid="studio-page-shell" className="mx-auto w-full max-w-6xl py-6 sm:py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className={cn(studioType.heading, "flex items-center gap-2.5")}>
            <IconSidebarStudio className="h-6 w-6 shrink-0 text-zinc-400" />
            제작
          </h1>
          <nav aria-label="제작자 메뉴" data-testid="studio-creator-nav" className="mt-3 flex flex-wrap gap-2">
            <StudioButton
              href="/creator"
              variant="secondary"
              size="sm"
              className="whitespace-nowrap"
              title="수익·CP·공지를 관리하는 나만의 대시보드"
            >
              크리에이터 대시보드
            </StudioButton>
            <StudioButton
              href={`/creator/${creatorId}`}
              variant="secondary"
              size="sm"
              className="whitespace-nowrap"
              title="다른 사용자에게 보이는 내 제작자 페이지"
            >
              내 공개 프로필
            </StudioButton>
            {ownerIsAdmin ? (
              <StudioButton
                href="/create"
                variant="secondary"
                size="sm"
                className="whitespace-nowrap"
                aria-label="범용 초안 생성"
                title="장르를 골라 검수 후 비공개 초안으로 저장"
              >
                범용 초안 생성
              </StudioButton>
            ) : null}
          </nav>
        </div>
        <StudioButton href={activeMeta.createHref} size="lg" className="w-full justify-center sm:w-auto">
          <span className="text-base leading-none" aria-hidden>
            +
          </span>
          {activeMeta.createLabel}
        </StudioButton>
      </div>

      <div
        role="tablist"
        data-testid="studio-tablist"
        aria-label="제작 종류"
        className="mt-5 grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-[#0e1120] p-1.5 sm:mt-6"
      >
        {TABS.map((tab) => {
          const selected = tab.id === activeTab;
          const count =
            tab.id === "creations"
              ? characters.length + simulations.length
              : tab.id === "worlds"
                ? worlds.length
                : lorebooks.length;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(tab.id)}
              className={cn(
                // 모바일: 아이콘·라벨·숫자 세로 배치로 truncate 없이 전체 글자 표시
                "flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[13px] font-semibold leading-tight transition sm:min-h-11 sm:flex-row sm:gap-2 sm:px-3 sm:text-sm",
                selected ? studioSurface.tabActive : studioSurface.tabIdle,
              )}
            >
              <tab.Icon
                className={cn("h-4 w-4 shrink-0", selected ? "text-white" : "text-zinc-500")}
              />
              <span className="text-center">{tab.label}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                  selected ? "bg-black/25 text-white/80" : "bg-white/5 text-zinc-500",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6" role="tabpanel" data-testid="studio-tabpanel">
        {activeTab === "creations" && (
          <CreationsPanel
            characters={characters}
            simulations={simulations}
            blurNsfw={blurNsfw}
            ownerIsAdmin={ownerIsAdmin}
          />
        )}
        {activeTab === "worlds" && <WorldsPanel worlds={worlds} />}
        {activeTab === "lorebooks" && <LorebooksPanel lorebooks={lorebooks} />}
      </div>
    </div>
  );
}

function CreationsPanel({
  characters,
  simulations,
  blurNsfw,
  ownerIsAdmin,
}: {
  characters: MyCharacterRow[];
  simulations: MyCharacterRow[];
  blurNsfw: boolean;
  ownerIsAdmin: boolean;
}) {
  const creations = useMemo(
    () =>
      [...characters, ...simulations].sort((a, b) => {
        const createdAtOrder = b.created_at.localeCompare(a.created_at);
        return createdAtOrder || b.id - a.id;
      }),
    [characters, simulations],
  );
  const [filter, setFilter] = useState<StudioLibraryFilter>(EMPTY_STUDIO_FILTER);
  const [visibleCount, setVisibleCount] = useState(STUDIO_LIBRARY_PAGE_SIZE);
  const showTools = creations.length >= STUDIO_LIBRARY_TOOLS_MIN;
  const summary = useMemo(() => summarizeStudioWorks(creations), [creations]);
  const matched = useMemo(
    () => (showTools ? filterStudioWorks(creations, filter) : creations),
    [creations, filter, showTools],
  );
  const shown = showTools ? matched.slice(0, visibleCount) : matched;
  const filtered = showTools && isStudioFilterActive(filter);

  const changeFilter = useCallback((next: StudioLibraryFilter) => {
    setFilter(next);
    setVisibleCount(STUDIO_LIBRARY_PAGE_SIZE);
  }, []);
  const resetFilter = useCallback(() => changeFilter(EMPTY_STUDIO_FILTER), [changeFilter]);

  return (
    <section>
      <h2 className="sr-only">내 제작 캐릭터와 시뮬레이션</h2>
      <p className={studioType.helper}>
        내가 만든 단일 캐릭터와 다인 시뮬레이션입니다. 하나의 제작 화면에서 만들고 수정할 수 있습니다.
      </p>
      {creations.length === 0 ? (
        <StudioEmptyState
          icon={<IconSidebarStudio className="h-5 w-5" />}
          message="아직 제작한 캐릭터나 시뮬레이션이 없습니다."
          description="캐릭터 한 명 또는 여러 인물이 등장하는 시뮬레이션을 하나의 제작 화면에서 만들 수 있습니다."
          href="/create"
          cta="캐릭터·시뮬레이션 만들기"
        />
      ) : (
        <>
          {showTools ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
              <StudioLibraryOverview summary={summary} filter={filter} onChange={changeFilter} />
              <StudioLibraryToolbar
                filter={filter}
                onChange={changeFilter}
                placeholder="작품 이름 검색"
                showStatus
              />
            </div>
          ) : null}
          {showTools ? (
            <div className="mt-2">
              <StudioLibraryResultBar
                shown={shown.length}
                matched={matched.length}
                total={creations.length}
                filtered={filtered}
                onReset={resetFilter}
              />
            </div>
          ) : null}
          {matched.length === 0 ? (
            <StudioNoMatches onReset={resetFilter} />
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-0 sm:grid-cols-3 lg:grid-cols-5">
              {shown.map((creation) => {
                const isSimulation = creation.content_kind === "simulation";
                return (
                  <MyCharacterCard
                    key={creation.id}
                    c={creation}
                    blurNsfw={blurNsfw}
                    ownerIsAdmin={ownerIsAdmin}
                    editHref={`/create?edit=${creation.id}`}
                    contentLabel={isSimulation ? "시뮬레이션" : "캐릭터"}
                  />
                );
              })}
            </div>
          )}
          {showTools ? (
            <StudioLoadMore
              remaining={matched.length - shown.length}
              onClick={() => setVisibleCount((n) => n + STUDIO_LIBRARY_PAGE_SIZE)}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function useQueryList<T extends { name: string }>(items: T[]) {
  const [query, setQueryState] = useState("");
  const [visibleCount, setVisibleCount] = useState(STUDIO_LIBRARY_PAGE_SIZE);
  const showTools = items.length >= STUDIO_LIBRARY_TOOLS_MIN;
  const matched = useMemo(
    () => (showTools ? items.filter((item) => matchesLibraryQuery(item.name, query)) : items),
    [items, query, showTools],
  );
  const shown = showTools ? matched.slice(0, visibleCount) : matched;
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setVisibleCount(STUDIO_LIBRARY_PAGE_SIZE);
  }, []);
  return {
    query,
    setQuery,
    showTools,
    matched,
    shown,
    filtered: showTools && query.trim() !== "",
    showMore: () => setVisibleCount((n) => n + STUDIO_LIBRARY_PAGE_SIZE),
  };
}

function QueryTools({
  list,
  placeholder,
  total,
}: {
  list: ReturnType<typeof useQueryList>;
  placeholder: string;
  total: number;
}) {
  if (!list.showTools) return null;
  return (
    <div className="mt-4">
      <StudioLibraryToolbar
        filter={{ ...EMPTY_STUDIO_FILTER, query: list.query }}
        onChange={(next) => list.setQuery(next.query)}
        placeholder={placeholder}
        showStatus={false}
      />
      <div className="mt-2">
        <StudioLibraryResultBar
          shown={list.shown.length}
          matched={list.matched.length}
          total={total}
          filtered={list.filtered}
          onReset={() => list.setQuery("")}
        />
      </div>
    </div>
  );
}

function WorldsPanel({ worlds }: { worlds: WorldListItem[] }) {
  const list = useQueryList(worlds);
  const owned = worlds.filter((w) => w.libraryKind !== "borrowed" && w.libraryKind !== "legacy_borrowed").length;
  const borrowed = worlds.filter((w) => w.libraryKind === "borrowed" || w.libraryKind === "legacy_borrowed").length;
  const ended = worlds.filter((w) => w.libraryKind === "borrowed" && w.shareAvailable === false).length;
  return (
    <section>
      <h2 className="sr-only">내 제작 세계관</h2>
      <p className={studioType.helper}>
        직접 만든 세계관과 라이브러리에 추가한 빌린 세계관입니다. 빌린 세계관은 읽기 전용이며 캐릭터·시뮬레이션
        제작에만 사용할 수 있습니다. TRPG 시나리오는 직접 소유한 세계관에서만 만듭니다.
      </p>
      {worlds.length === 0 ? (
        <StudioEmptyState
          icon={<IconStudioWorld className="h-5 w-5" />}
          message="아직 제작한 세계관이 없습니다."
          description="세계관은 캐릭터·시뮬레이션의 배경으로 다시 쓸 수 있고, 공유 링크로 다른 사람에게 빌려줄 수 있습니다."
          href="/world/create"
          cta="세계관 제작하기"
        />
      ) : (
        <>
          {list.showTools ? (
            <p className="mt-3 text-xs text-zinc-400" data-testid="studio-world-summary">
              내 세계관 {owned} · 빌린 세계관 {borrowed}
              {ended > 0 ? ` · 공유 종료 ${ended}` : ""}
            </p>
          ) : null}
          <QueryTools list={list} placeholder="세계관 이름 검색" total={worlds.length} />
          {list.matched.length === 0 ? (
            <StudioNoMatches onReset={() => list.setQuery("")} />
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.shown.map((world) => (
                <WorldCard
                  key={world.borrowId ? `borrow-${world.borrowId}` : `world-${world.id}`}
                  world={world}
                />
              ))}
            </div>
          )}
          {list.showTools ? (
            <StudioLoadMore remaining={list.matched.length - list.shown.length} onClick={list.showMore} />
          ) : null}
        </>
      )}
    </section>
  );
}

const WORLD_CHIP = "inline-flex min-h-6 shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-semibold leading-tight ring-1 ring-inset";

function WorldCard({ world }: { world: WorldListItem }) {
  const router = useRouter();
  const [shareBusy, setShareBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState("");
  const [copied, setCopied] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [removeOpen, setRemoveOpen] = useState(false);
  const removeInFlight = useRef(false);
  const shareInFlight = useRef(false);

  const isBorrowed = world.libraryKind === "borrowed";
  const isLegacyBorrowed = world.libraryKind === "legacy_borrowed";
  const readOnly = world.readOnly === true || isBorrowed || isLegacyBorrowed;
  const borrowUnavailable = isBorrowed && world.shareAvailable === false;

  async function shareWorld() {
    if (readOnly || world.id <= 0 || shareInFlight.current) return;
    shareInFlight.current = true;
    setShareBusy(true);
    setShareError("");
    try {
      const res = await fetch(`/api/worlds/${world.id}/share`, { method: "POST" });
      const data = (await res.json()) as { applyPath?: string; error?: string };
      if (!res.ok || !data.applyPath) {
        setShareError(data.error || "공유 링크 생성에 실패했습니다.");
        return;
      }
      const full = `${window.location.origin}${data.applyPath}`;
      setShareUrl(full);
      try {
        await navigator.clipboard.writeText(full);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* ignore clipboard failures — link still shown */
      }
    } catch {
      setShareError("네트워크 오류가 발생했습니다.");
    } finally {
      shareInFlight.current = false;
      setShareBusy(false);
    }
  }

  async function removeFromLibrary() {
    if (removeInFlight.current) return;
    removeInFlight.current = true;
    setRemoveBusy(true);
    setRemoveError("");
    try {
      const res = isBorrowed
        ? await fetch(`/api/world-borrows/${world.borrowId}`, { method: "DELETE" })
        : await fetch(`/api/worlds/${world.id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setRemoveError(data.error || "제거에 실패했습니다.");
        return;
      }
      setRemoveOpen(false);
      router.refresh();
    } catch {
      setRemoveError("네트워크 오류가 발생했습니다.");
    } finally {
      removeInFlight.current = false;
      setRemoveBusy(false);
    }
  }

  async function copyShareLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  const createHref =
    isBorrowed && world.borrowId
      ? `/create?worldBorrowId=${world.borrowId}`
      : `/create?worldId=${world.id}`;
  const simulationHref =
    isBorrowed && world.borrowId
      ? `/create?kind=simulation&worldBorrowId=${world.borrowId}`
      : `/create?kind=simulation&worldId=${world.id}`;

  const kind = isBorrowed ? "borrowed" : isLegacyBorrowed ? "legacy_borrowed" : "owned";

  const headerInner = (
    <>
      <div className="aspect-square w-16 shrink-0 overflow-hidden rounded-lg bg-black ring-1 ring-white/10">
        {world.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={world.coverUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {isBorrowed ? (
            <>
              <span className={cn(WORLD_CHIP, "bg-amber-500/10 text-amber-200 ring-amber-500/30")}>빌린 세계관</span>
              {borrowUnavailable ? (
                <span className={cn(WORLD_CHIP, "bg-rose-500/10 text-rose-200 ring-rose-500/30")}>
                  공유 종료 · 신규 제작 불가
                </span>
              ) : (
                <span className={cn(WORLD_CHIP, "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30")}>읽기 전용</span>
              )}
            </>
          ) : isLegacyBorrowed ? (
            <>
              <span className={cn(WORLD_CHIP, "bg-violet-500/10 text-violet-300 ring-violet-500/30")}>
                공유받은 세계관
              </span>
              <span className={cn(WORLD_CHIP, "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30")}>읽기 전용</span>
            </>
          ) : (
            <span className={cn(WORLD_CHIP, "bg-violet-500/10 text-violet-200 ring-violet-400/25")}>내 세계관</span>
          )}
        </div>
        <h3 className="mt-1.5 line-clamp-2 break-words text-[15px] font-semibold leading-snug text-zinc-50 [overflow-wrap:anywhere]">
          {world.name}
        </h3>
        {world.sharedFromNickname ? (
          <p className={cn(studioType.caption, "mt-0.5 truncate")}>by @{world.sharedFromNickname}</p>
        ) : null}
        <p className={cn(studioType.caption, "mt-1 line-clamp-2 break-words")}>{world.summary || world.content}</p>
      </div>
    </>
  );

  return (
    <article
      className={cn(studioSurface.card, "flex flex-col overflow-hidden")}
      data-testid="studio-world-card"
      data-world-kind={kind}
    >
      {readOnly ? (
        <div className="flex items-start gap-3 p-4">{headerInner}</div>
      ) : (
        <Link
          href={`/world/${world.id}/edit`}
          className="flex items-start gap-3 p-4 transition hover:bg-white/[0.03]"
        >
          {headerInner}
        </Link>
      )}
      {readOnly ? (
        <p
          className={cn(
            "mx-4 mb-3 text-xs leading-relaxed",
            borrowUnavailable ? "text-rose-200/90" : "text-zinc-400",
          )}
          data-testid="studio-world-readonly-note"
        >
          {borrowUnavailable
            ? "원본 공유가 종료되어 캐릭터·시뮬레이션 신규 제작에 사용할 수 없습니다. 라이브러리에서 제거할 수 있습니다."
            : "원작자가 관리하는 세계관이라 수정하거나 공유할 수 없습니다. 캐릭터·시뮬레이션 제작에만 사용할 수 있습니다."}
        </p>
      ) : null}
      <div className="mt-auto flex flex-col gap-2 border-t border-white/10 px-4 py-3">
        {readOnly ? (
          <>
            {borrowUnavailable ? null : (
              <div className="grid grid-cols-2 gap-2">
                <StudioButton href={createHref} size="sm" className="px-2 text-center leading-tight">
                  캐릭터 제작에 사용
                </StudioButton>
                <StudioButton
                  href={simulationHref}
                  variant="secondary"
                  size="sm"
                  className="px-2 text-center leading-tight"
                >
                  시뮬레이션 제작에 사용
                </StudioButton>
              </div>
            )}
            <StudioButton
              type="button"
              variant="secondary"
              size="sm"
              className="w-full border-rose-400/30 text-rose-200 hover:bg-rose-500/10"
              disabled={removeBusy}
              onClick={() => {
                setRemoveError("");
                setRemoveOpen(true);
              }}
            >
              {removeBusy ? "제거 중…" : "라이브러리에서 제거"}
            </StudioButton>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <StudioButton href={`/world/${world.id}/edit`} size="sm">
              수정하기
            </StudioButton>
            <StudioButton
              type="button"
              variant="secondary"
              size="sm"
              disabled={shareBusy}
              onClick={() => void shareWorld()}
            >
              {shareBusy ? "생성 중…" : copied ? "링크 복사됨" : "공유하기"}
            </StudioButton>
          </div>
        )}
        {shareError ? (
          <p role="alert" className="text-xs text-rose-400">
            {shareError}
          </p>
        ) : null}
      </div>
      {shareUrl ? (
        <div
          className="mx-4 mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3"
          data-testid="studio-world-share-result"
          role="status"
        >
          <p className="text-xs font-semibold text-zinc-300">공유 링크</p>
          <p className="mt-1 max-h-24 overflow-y-auto break-all text-xs text-zinc-300 [overflow-wrap:anywhere]">
            {shareUrl}
          </p>
          <button
            type="button"
            onClick={() => void copyShareLink()}
            className="mt-1 inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-semibold text-violet-300 hover:text-violet-200"
          >
            {copied ? "복사됨!" : "다시 복사"}
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={removeOpen}
        title="라이브러리에서 제거"
        message={
          <>
            <p>
              {isBorrowed
                ? `「${world.name}」 세계관을 내 라이브러리에서 제거할까요? 다시 사용하려면 공유 링크로 다시 추가해야 합니다.`
                : `「${world.name}」 세계관을 내 라이브러리에서 제거할까요? 공유받은 세계관 사본이 삭제되며 되돌릴 수 없습니다.`}
            </p>
            {removeError ? (
              <p role="alert" className="mt-3 rounded-lg bg-rose-950/70 px-3 py-2 text-[13px] text-rose-200">
                {removeError}
              </p>
            ) : null}
          </>
        }
        confirmLabel={removeBusy ? "제거 중…" : "제거"}
        cancelLabel="취소"
        danger
        confirmDisabled={removeBusy}
        onConfirm={() => void removeFromLibrary()}
        onCancel={() => {
          if (!removeBusy) setRemoveOpen(false);
        }}
      />
    </article>
  );
}

function formatLibraryDate(raw: string): string {
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.replace(/-/g, ".") : "";
}

function LorebooksPanel({ lorebooks }: { lorebooks: KeywordLorebookListItem[] }) {
  const list = useQueryList(lorebooks);
  return (
    <section>
      <h2 className="sr-only">내 로어북</h2>
      <p className={studioType.helper}>
        키워드 로어북입니다. 수정하거나 캐릭터에 연결해 사용할 수 있습니다.
      </p>
      {lorebooks.length === 0 ? (
        <StudioEmptyState
          icon={<IconStudioLorebook className="h-5 w-5" />}
          message="아직 만든 로어북이 없습니다."
          description="대화 중 정해 둔 키워드가 나오면 해당 설정을 참고하도록 만드는 설정 모음입니다."
          href="/lorebook/create"
          cta="로어북 제작하기"
        />
      ) : (
        <>
          <QueryTools list={list} placeholder="로어북 이름 검색" total={lorebooks.length} />
          {list.matched.length === 0 ? (
            <StudioNoMatches onReset={() => list.setQuery("")} />
          ) : (
            <ul className="mt-4 grid gap-3 lg:grid-cols-2">
              {list.shown.map((lb) => {
                const updated = formatLibraryDate(lb.updatedAt);
                return (
                  <li key={lb.id} className="min-w-0">
                    <Link
                      href={`/lorebook/${lb.id}/edit`}
                      className={cn(
                        studioSurface.card,
                        "flex h-full min-h-14 items-center justify-between gap-3 px-4 py-3.5 transition hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40",
                      )}
                      data-testid="studio-lorebook-item"
                    >
                      <div className="min-w-0">
                        <p className="line-clamp-2 break-words font-semibold leading-snug text-zinc-50 [overflow-wrap:anywhere]">
                          {lb.name}
                        </p>
                        {lb.summary ? (
                          <p className={cn(studioType.caption, "mt-0.5 line-clamp-2 break-words")}>{lb.summary}</p>
                        ) : (
                          <p className={cn(studioType.caption, "mt-0.5 text-zinc-500")}>설명 없음</p>
                        )}
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
                          <span
                            className={cn(
                              "inline-flex min-h-6 items-center rounded-md px-2 py-0.5 font-semibold ring-1 ring-inset",
                              lb.entryCount === 0
                                ? "bg-amber-500/10 text-amber-200 ring-amber-400/30"
                                : "bg-white/[0.04] text-zinc-200 ring-white/10",
                            )}
                          >
                            {lb.entryCount === 0 ? "항목 없음" : `${lb.entryCount}개 항목`}
                          </span>
                          {updated ? <span>수정 {updated}</span> : null}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-200">
                        수정
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {list.showTools ? (
            <StudioLoadMore remaining={list.matched.length - list.shown.length} onClick={list.showMore} />
          ) : null}
        </>
      )}
    </section>
  );
}
