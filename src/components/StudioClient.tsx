"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import MyCharacterCard, { type MyCharacterRow } from "@/components/MyCharacterCard";
import {
  IconSidebarStudio,
  IconStudioLorebook,
  IconStudioWorld,
} from "@/components/SidebarNavIcons";
import StudioButton from "@/components/studio/StudioButton";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import type { KeywordLorebookListItem } from "@/lib/keywordLorebooks";
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
};

export default function StudioClient({
  characters,
  simulations,
  worlds,
  lorebooks,
  blurNsfw,
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
    <div data-testid="studio-page-shell" className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className={cn(studioType.heading, "flex items-center gap-2.5")}>
            <IconSidebarStudio className="h-6 w-6 shrink-0 text-zinc-400" />
            제작
          </h1>
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
}: {
  characters: MyCharacterRow[];
  simulations: MyCharacterRow[];
  blurNsfw: boolean;
}) {
  const creations = [...characters, ...simulations].sort((a, b) => {
    const createdAtOrder = b.created_at.localeCompare(a.created_at);
    return createdAtOrder || b.id - a.id;
  });

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
          href="/create"
          cta="캐릭터·시뮬레이션 만들기"
        />
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {creations.map((creation) => {
            const isSimulation = creation.content_kind === "simulation";
            return (
              <MyCharacterCard
                key={creation.id}
                c={creation}
                blurNsfw={blurNsfw}
                editHref={`/create?edit=${creation.id}`}
                contentLabel={isSimulation ? "시뮬레이션" : "캐릭터"}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function WorldsPanel({ worlds }: { worlds: WorldListItem[] }) {
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
          href="/world/create"
          cta="세계관 제작하기"
        />
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {worlds.map((world) => (
            <WorldCard
              key={world.borrowId ? `borrow-${world.borrowId}` : `world-${world.id}`}
              world={world}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function WorldCard({ world }: { world: WorldListItem }) {
  const router = useRouter();
  const [shareBusy, setShareBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState("");
  const [copied, setCopied] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState("");

  const isBorrowed = world.libraryKind === "borrowed";
  const isLegacyBorrowed = world.libraryKind === "legacy_borrowed";
  const readOnly = world.readOnly === true || isBorrowed || isLegacyBorrowed;
  const borrowUnavailable = isBorrowed && world.shareAvailable === false;

  async function shareWorld() {
    if (readOnly || world.id <= 0) return;
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
      setShareBusy(false);
    }
  }

  async function removeFromLibrary() {
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
      router.refresh();
    } catch {
      setRemoveError("네트워크 오류가 발생했습니다.");
    } finally {
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

  const headerInner = (
    <>
      <div className="aspect-square w-14 shrink-0 overflow-hidden rounded-lg bg-black">
        {world.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={world.coverUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-zinc-50">{world.name}</h3>
          {isBorrowed ? (
            <>
              <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                빌린 세계관
              </span>
              {borrowUnavailable ? (
                <span className="shrink-0 rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200">
                  공유 종료 · 신규 제작 불가
                </span>
              ) : (
                <span className="shrink-0 rounded-md border border-zinc-500/30 bg-zinc-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300">
                  읽기 전용
                </span>
              )}
            </>
          ) : isLegacyBorrowed ? (
            <>
              <span className="shrink-0 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">
                공유받은 세계관
              </span>
              <span className="shrink-0 rounded-md border border-zinc-500/30 bg-zinc-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300">
                읽기 전용
              </span>
            </>
          ) : null}
        </div>
        {world.sharedFromNickname ? (
          <p className={cn(studioType.caption, "mt-0.5")}>by @{world.sharedFromNickname}</p>
        ) : null}
        <p className={cn(studioType.caption, "mt-1 line-clamp-2")}>
          {world.summary || world.content}
        </p>
      </div>
    </>
  );

  return (
    <article className={cn(studioSurface.card, "overflow-hidden")}>
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
      <div className="flex flex-wrap gap-2 border-t border-white/10 px-4 py-3">
        {readOnly ? (
          <>
            {borrowUnavailable ? (
              <p className="w-full text-[11px] leading-relaxed text-rose-200/90">
                원본 공유가 종료되어 캐릭터·시뮬레이션 신규 제작에 사용할 수 없습니다. 라이브러리에서 제거할 수
                있습니다.
              </p>
            ) : (
              <>
                <StudioButton href={createHref} size="sm" className="w-full sm:w-auto">
                  캐릭터 제작에 사용
                </StudioButton>
                <StudioButton href={simulationHref} variant="secondary" size="sm" className="w-full sm:w-auto">
                  시뮬레이션 제작에 사용
                </StudioButton>
              </>
            )}
            <StudioButton
              type="button"
              variant="secondary"
              size="sm"
              className="w-full sm:w-auto"
              disabled={removeBusy}
              onClick={() => void removeFromLibrary()}
            >
              {removeBusy ? "제거 중…" : "라이브러리에서 제거"}
            </StudioButton>
          </>
        ) : (
          <>
            <StudioButton href={`/world/${world.id}/edit`} size="sm" className="w-full sm:w-auto">
              수정하기
            </StudioButton>
            <StudioButton
              type="button"
              variant="secondary"
              size="sm"
              className="w-full sm:w-auto"
              disabled={shareBusy}
              onClick={() => void shareWorld()}
            >
              {shareBusy ? "생성 중…" : copied ? "링크 복사됨" : "공유하기"}
            </StudioButton>
          </>
        )}
      </div>
      {shareError ? <p className="px-4 pb-3 text-xs text-rose-400">{shareError}</p> : null}
      {removeError ? <p className="px-4 pb-3 text-xs text-rose-400">{removeError}</p> : null}
      {shareUrl ? (
        <div className="mx-4 mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-[11px] font-semibold text-zinc-400">공유 링크</p>
          <p className="mt-1 break-all text-xs text-zinc-300">{shareUrl}</p>
          <button
            type="button"
            onClick={() => void copyShareLink()}
            className="mt-2 text-xs font-semibold text-violet-300 hover:text-violet-200"
          >
            {copied ? "복사됨!" : "다시 복사"}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function LorebooksPanel({ lorebooks }: { lorebooks: KeywordLorebookListItem[] }) {
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
          href="/lorebook/create"
          cta="로어북 제작하기"
        />
      ) : (
        <ul className="mt-5 space-y-2">
          {lorebooks.map((lb) => (
            <li key={lb.id}>
              <Link
                href={`/lorebook/${lb.id}/edit`}
                className={cn(
                  studioSurface.card,
                  "flex min-h-14 items-center justify-between gap-3 px-4 py-3.5 transition hover:border-white/20",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-zinc-50">{lb.name}</p>
                  {lb.summary ? (
                    <p className={cn(studioType.caption, "mt-0.5 truncate")}>{lb.summary}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs font-semibold text-zinc-400">
                  {lb.entryCount}항목
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
