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

export type StudioTab = "characters" | "worlds" | "lorebooks";

const TABS: {
  id: StudioTab;
  label: string;
  createHref: string;
  createLabel: string;
  Icon: typeof IconSidebarStudio;
}[] = [
  {
    id: "characters",
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
  if (raw === "characters" || raw === "character") return "characters";
  return "characters";
}

type Props = {
  characters: MyCharacterRow[];
  worlds: WorldListItem[];
  lorebooks: KeywordLorebookListItem[];
  blurNsfw: boolean;
};

export default function StudioClient({ characters, worlds, lorebooks, blurNsfw }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = useMemo(() => parseTab(searchParams.get("tab")), [searchParams]);
  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]!;

  const setTab = useCallback(
    (tab: StudioTab) => {
      const next = new URLSearchParams(searchParams.toString());
      if (tab === "characters") next.delete("tab");
      else next.set("tab", tab);
      const qs = next.toString();
      router.replace(qs ? `/studio?${qs}` : "/studio", { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <div data-testid="studio-page-shell" className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className={cn(studioType.heading, "flex items-center gap-2.5")}>
            <IconSidebarStudio className="h-6 w-6 shrink-0 text-zinc-400" />
            제작
          </h1>
          <p className={cn(studioType.helper, "mt-2")}>
            탭을 바꿔 내가 만든 목록을 보고, 상단에서 바로 새로 만들 수 있습니다.
          </p>
        </div>
        <StudioButton href={activeMeta.createHref} size="lg">
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
        className={cn(studioSurface.tabList, "mt-6")}
        style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
      >
        {TABS.map((tab) => {
          const selected = tab.id === activeTab;
          const count =
            tab.id === "characters"
              ? characters.length
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
                "flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-2 text-sm font-semibold transition sm:px-3",
                selected ? studioSurface.tabActive : studioSurface.tabIdle,
              )}
            >
              <tab.Icon
                className={cn("h-4 w-4 shrink-0", selected ? "text-white" : "text-zinc-500")}
              />
              <span className="truncate">{tab.label}</span>
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
        {activeTab === "characters" && (
          <CharactersPanel characters={characters} blurNsfw={blurNsfw} />
        )}
        {activeTab === "worlds" && <WorldsPanel worlds={worlds} />}
        {activeTab === "lorebooks" && <LorebooksPanel lorebooks={lorebooks} />}
      </div>
    </div>
  );
}

function CharactersPanel({
  characters,
  blurNsfw,
}: {
  characters: MyCharacterRow[];
  blurNsfw: boolean;
}) {
  return (
    <section>
      <h2 className="sr-only">내 제작 캐릭터</h2>
      <p className={studioType.helper}>
        내가 만든 캐릭터입니다. 메인 홈에는 표시되지 않습니다.
      </p>
      {characters.length === 0 ? (
        <StudioEmptyState
          icon={<IconSidebarStudio className="h-5 w-5" />}
          message="아직 제작한 캐릭터가 없습니다."
          href="/create"
          cta="캐릭터 제작하기"
        />
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {characters.map((c) => (
            <MyCharacterCard key={c.id} c={c} blurNsfw={blurNsfw} />
          ))}
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
        저장한 세계관입니다. 캐릭터 제작의 「세계관 / 배경」에서 불러올 수 있습니다. 공유하기
        링크로 다른 유저가 공유받은 세계관으로 추가할 수 있습니다.
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
            <WorldCard key={world.id} world={world} />
          ))}
        </div>
      )}
    </section>
  );
}

function WorldCard({ world }: { world: WorldListItem }) {
  const [shareBusy, setShareBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState("");
  const [copied, setCopied] = useState(false);

  async function shareWorld() {
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

  return (
    <article className={cn(studioSurface.card, "p-4")}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-300">
          <IconStudioWorld className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-zinc-50">{world.name}</h3>
            {world.sharedFromNickname ? (
              <span className="shrink-0 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">
                공유받은 세계관
              </span>
            ) : null}
          </div>
          {world.sharedFromNickname ? (
            <p className={cn(studioType.caption, "mt-0.5")}>@{world.sharedFromNickname}님 공유</p>
          ) : null}
          <p className={cn(studioType.caption, "mt-1 line-clamp-2")}>
            {world.summary || world.content}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <StudioButton href="/create" size="sm" className="w-full sm:w-auto">
          캐릭터에 사용
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
      </div>
      {shareError ? <p className="mt-2 text-xs text-rose-400">{shareError}</p> : null}
      {shareUrl ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
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
