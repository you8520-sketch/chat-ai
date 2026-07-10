"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import MyCharacterCard, { type MyCharacterRow } from "@/components/MyCharacterCard";
import {
  IconSidebarStudio,
  IconStudioLorebook,
  IconStudioWorld,
} from "@/components/SidebarNavIcons";
import type { KeywordLorebookListItem } from "@/lib/keywordLorebooks";
import type { WorldListItem } from "@/lib/worlds";

export type StudioTab = "characters" | "worlds" | "lorebooks";

const TABS: {
  id: StudioTab;
  label: string;
  createHref: string;
  createLabel: string;
  createClass: string;
  Icon: typeof IconSidebarStudio;
  accent: string;
  activeTabClass: string;
}[] = [
  {
    id: "characters",
    label: "캐릭터",
    createHref: "/create",
    createLabel: "새 캐릭터 만들기",
    createClass: "bg-violet-600 hover:bg-violet-500 text-white shadow-violet-900/40",
    Icon: IconSidebarStudio,
    accent: "text-violet-300",
    activeTabClass: "border-violet-500/50 bg-violet-600/20 text-violet-50",
  },
  {
    id: "worlds",
    label: "세계관",
    createHref: "/world/create",
    createLabel: "새 세계관 만들기",
    createClass: "bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-900/40",
    Icon: IconStudioWorld,
    accent: "text-cyan-300",
    activeTabClass: "border-cyan-500/50 bg-cyan-500/20 text-cyan-50",
  },
  {
    id: "lorebooks",
    label: "로어북",
    createHref: "/lorebook/create",
    createLabel: "새 로어북 만들기",
    createClass: "bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/40",
    Icon: IconStudioLorebook,
    accent: "text-amber-300",
    activeTabClass: "border-amber-500/50 bg-amber-500/20 text-amber-50",
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
    [router, searchParams]
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2.5 text-2xl font-black text-white">
            <IconSidebarStudio className="h-6 w-6 shrink-0 text-zinc-400" />
            제작
          </h1>
          <p className="mt-1.5 text-sm text-zinc-500">
            탭을 바꿔 내가 만든 목록을 보고, 상단에서 바로 새로 만들 수 있습니다.
          </p>
        </div>
        <Link
          href={activeMeta.createHref}
          className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-5 py-3 text-sm font-black shadow-lg transition ${activeMeta.createClass}`}
        >
          <span className="text-base leading-none" aria-hidden>
            +
          </span>
          {activeMeta.createLabel}
        </Link>
      </div>

      <div
        role="tablist"
        aria-label="제작 종류"
        className="mt-6 flex gap-1.5 rounded-2xl border border-white/10 bg-[#0e1120] p-1.5"
      >
        {TABS.map((tab) => {
          const selected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(tab.id)}
              className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border px-2 py-2.5 text-sm font-bold transition sm:px-3 ${
                selected
                  ? tab.activeTabClass
                  : "border-transparent text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
              }`}
            >
              <tab.Icon className={`h-4 w-4 shrink-0 ${selected ? tab.accent : "text-zinc-500"}`} />
              <span className="truncate">{tab.label}</span>
              <span
                className={`hidden rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums sm:inline ${
                  selected ? "bg-black/25 text-white/80" : "bg-white/5 text-zinc-500"
                }`}
              >
                {tab.id === "characters"
                  ? characters.length
                  : tab.id === "worlds"
                    ? worlds.length
                    : lorebooks.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6" role="tabpanel">
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
      <p className="text-sm text-zinc-400">내가 만든 캐릭터입니다. 메인 홈에는 표시되지 않습니다.</p>
      {characters.length === 0 ? (
        <EmptyState
          Icon={IconSidebarStudio}
          message="아직 제작한 캐릭터가 없습니다."
          href="/create"
          cta="캐릭터 제작하기"
          ctaClass="bg-violet-600 hover:bg-violet-500"
        />
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
      <p className="text-sm text-zinc-400">
        저장한 세계관입니다. 캐릭터 제작의 「세계관 / 배경」에서 불러올 수 있습니다.
      </p>
      {worlds.length === 0 ? (
        <EmptyState
          Icon={IconStudioWorld}
          message="아직 제작한 세계관이 없습니다."
          href="/world/create"
          cta="세계관 제작하기"
          ctaClass="bg-cyan-600 hover:bg-cyan-500"
        />
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {worlds.map((world) => (
            <article
              key={world.id}
              className="rounded-2xl border border-cyan-500/20 bg-[#131626] p-4 shadow-sm shadow-black/20"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300">
                  <IconStudioWorld className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-bold text-white">{world.name}</h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-400">
                    {world.summary || world.content}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/create"
                  className="rounded-lg bg-violet-600/80 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500"
                >
                  캐릭터에 사용
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function LorebooksPanel({ lorebooks }: { lorebooks: KeywordLorebookListItem[] }) {
  return (
    <section>
      <h2 className="sr-only">내 로어북</h2>
      <p className="text-sm text-zinc-400">
        키워드 로어북입니다. 수정하거나 캐릭터에 연결해 사용할 수 있습니다.
      </p>
      {lorebooks.length === 0 ? (
        <EmptyState
          Icon={IconStudioLorebook}
          message="아직 만든 로어북이 없습니다."
          href="/lorebook/create"
          cta="로어북 제작하기"
          ctaClass="bg-amber-600 hover:bg-amber-500"
        />
      ) : (
        <ul className="mt-5 space-y-2">
          {lorebooks.map((lb) => (
            <li key={lb.id}>
              <Link
                href={`/lorebook/${lb.id}/edit`}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-[#131626] px-4 py-3.5 transition hover:border-amber-500/30"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">{lb.name}</p>
                  {lb.summary ? (
                    <p className="mt-0.5 truncate text-xs text-zinc-500">{lb.summary}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs font-semibold text-amber-400/90">
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

function EmptyState({
  Icon,
  message,
  href,
  cta,
  ctaClass,
}: {
  Icon: typeof IconSidebarStudio;
  message: string;
  href: string;
  cta: string;
  ctaClass: string;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-[#131626] p-10 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-500">
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm text-gray-400">{message}</p>
      <Link
        href={href}
        className={`mt-5 inline-block rounded-xl px-5 py-2.5 text-sm font-bold text-white ${ctaClass}`}
      >
        {cta}
      </Link>
    </div>
  );
}
