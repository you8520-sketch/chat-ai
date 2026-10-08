import Link from "next/link";
import type { CSSProperties } from "react";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import HomeCreateEventBanner from "@/components/HomeCreateEventBanner";
import HomePopupNotice from "@/components/HomePopupNotice";
import CharacterCard, { type CharacterRow } from "@/components/CharacterCard";
import HorizontalScrollRow from "@/components/HorizontalScrollRow";
import UserPreferenceControls from "@/components/UserPreferenceControls";
import { canAccessAdultContent, shouldHideAdultListings } from "@/lib/adultVerification";
import { fetchHomeSections } from "@/lib/homeSections";
import { getActiveHomePopupNotice } from "@/lib/homePopupNotice";
import { cn, studioType } from "@/lib/studioDesign";

export const dynamic = "force-dynamic";

/** 변형별 카드 폭 — 추천은 일러스트 중심의 세로형, 공모전은 더 넓은 전시 프레임 */
const CARD_WIDTH = {
  editorial: "w-[172px] sm:w-[208px] xl:w-[232px]",
  exhibit: "w-[224px] sm:w-[268px] xl:w-[300px]",
} as const;

const MOBILE_DISCOVERY_TABS = [
  { href: "/", label: "추천" },
  { href: "/tab/new", label: "신작랭킹" },
  { href: "/tab/ranking", label: "랭킹" },
  { href: "/trpg", label: "TRPG" },
  { href: "/search", label: "검색" },
] as const;

type SectionMeta = {
  index: string;
  eyebrow: string;
  description: string;
  slab: CSSProperties;
  numeral: string;
};

const SECTION_META: Record<string, SectionMeta> = {
  "추천 캐릭터": {
    index: "01",
    eyebrow: "FOR YOU",
    description: "취향과 활동을 바탕으로 골라낸 이야기",
    slab: { "--slab-bg": "#7c3aed", "--slab-ink": "#fff" } as CSSProperties,
    numeral: "#a78bfa",
  },
  "공모전 당선작": {
    index: "02",
    eyebrow: "SELECTED",
    description: "공모전에서 주목받은 캐릭터와 시뮬레이션",
    slab: { "--slab-bg": "#fafafa", "--slab-ink": "#09090b" } as CSSProperties,
    numeral: "#fafafa",
  },
  "신규 캐릭터": {
    index: "03",
    eyebrow: "NEW STORIES",
    description: "방금 공개된 새로운 만남",
    slab: {
      "--slab-bg": "transparent",
      "--slab-border": "1px solid rgba(255,255,255,.45)",
      "--slab-ink": "#fff",
    } as CSSProperties,
    numeral: "#71717a",
  },
};

function SectionHeader({
  title,
  headerLink,
  level = "h2",
}: {
  title: string;
  headerLink?: { href: string; label: string };
  level?: "h1" | "h2";
}) {
  const meta = SECTION_META[title];
  const Heading = level;
  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-2 sm:flex-nowrap">
      {meta ? (
        <span
          aria-hidden="true"
          className="home-section-num text-[3.5rem] sm:text-[5.25rem]"
          style={{ "--num-color": meta.numeral } as CSSProperties}
        >
          {meta.index}
        </span>
      ) : null}
      <div className="min-w-0 pb-1">
        {meta ? (
          <p className="text-[10px] font-bold tracking-[0.26em] text-zinc-400">{meta.eyebrow}</p>
        ) : null}
        <Heading
          className="home-slab mt-1 text-[1.6rem] font-black leading-tight tracking-[-0.05em] sm:text-[2.5rem]"
          style={meta?.slab}
        >
          {title}
        </Heading>
      </div>
      {meta ? (
        <p className="hidden max-w-[15rem] pb-1.5 text-xs leading-5 text-zinc-500 lg:block">{meta.description}</p>
      ) : null}
      <span aria-hidden className="mb-3 hidden h-px min-w-6 flex-1 bg-white/15 sm:block" />
      {headerLink ? (
        <Link
          href={headerLink.href}
          className="group relative z-10 ml-auto inline-flex min-h-11 items-center gap-1 px-1 text-xs font-semibold text-zinc-300 underline decoration-white/20 underline-offset-4 transition hover:text-white hover:decoration-white/60 sm:ml-0"
        >
          {headerLink.label}
          <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
            →
          </span>
        </Link>
      ) : null}
    </div>
  );
}

function MobileDiscoveryNav() {
  return (
    <nav
      className="grid grid-cols-5 gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-1.5 md:hidden"
      aria-label="콘텐츠 탐색"
      data-menu-transition=""
    >
      {MOBILE_DISCOVERY_TABS.map((tab, index) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={index === 0 ? "page" : undefined}
          className={cn(
            "flex min-h-11 min-w-0 items-center justify-center rounded-xl px-1 text-center text-[11px] font-semibold tracking-[-0.03em] transition",
            index === 0
              ? "bg-violet-600 text-white shadow-[0_6px_18px_rgba(124,58,237,.22)]"
              : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

function ScrollSection({
  title,
  chars,
  blurNsfw,
  loggedIn,
  headerLink,
  variant,
  level,
  staggered = false,
  band = false,
  first = false,
}: {
  title: string;
  chars: CharacterRow[];
  blurNsfw: boolean;
  loggedIn: boolean;
  headerLink?: { href: string; label: string };
  variant: keyof typeof CARD_WIDTH;
  level?: "h1" | "h2";
  staggered?: boolean;
  band?: boolean;
  first?: boolean;
}) {
  if (chars.length === 0) return null;
  return (
    <section className={cn(first ? "mt-8 sm:mt-10" : "mt-12 sm:mt-16", band && "home-band -mx-3 px-3 sm:-mx-5 sm:px-5")}>
      <SectionHeader title={title} headerLink={headerLink} level={level} />
      <HorizontalScrollRow
        className={cn(
          "home-card-row home-card-group -mx-1 gap-4 px-1 pb-3 pt-2 sm:gap-5",
          staggered && "home-row-stagger pb-10",
        )}
      >
        {chars.map((c, index) => (
          <div key={c.id} className={`${CARD_WIDTH[variant]} shrink-0`}>
            <CharacterCard
              c={c}
              blurNsfw={blurNsfw}
              loggedIn={loggedIn}
              variant={variant}
              order={index + 1}
            />
          </div>
        ))}
      </HorizontalScrollRow>
    </section>
  );
}

function GridSection({
  title,
  chars,
  blurNsfw,
  loggedIn,
  headerLink,
}: {
  title: string;
  chars: CharacterRow[];
  blurNsfw: boolean;
  loggedIn: boolean;
  headerLink?: { href: string; label: string };
}) {
  if (chars.length === 0) return null;
  return (
    <section className="mt-12 sm:mt-16">
      <SectionHeader title={title} headerLink={headerLink} />
      <div className="home-card-group home-grid-stagger grid grid-cols-2 gap-x-3.5 gap-y-7 sm:grid-cols-3 sm:gap-x-5 xl:grid-cols-4">
        {chars.map((c, index) => (
          <CharacterCard
            key={c.id}
            c={c}
            blurNsfw={blurNsfw}
            loggedIn={loggedIn}
            variant="index"
            order={index + 1}
          />
        ))}
      </div>
    </section>
  );
}

export default async function Home() {
  const db = getDb();
  const user = await getSessionUser();
  const blurNsfw = shouldHideAdultListings(user);
  const canDisableSafetyFilter = canAccessAdultContent(user);
  const loggedIn = !!user;

  const { recommended, contest, newest } = fetchHomeSections(db, user, blurNsfw);
  const popupNotice = getActiveHomePopupNotice(db);

  return (
    <div className="pb-6">
      <HomePopupNotice notice={popupNotice} />
      <HomeCreateEventBanner />
      <div className="border-b border-white/[0.07] py-4 md:hidden">
        <MobileDiscoveryNav />
        <div className="mt-3 flex min-h-9 items-center justify-between gap-3 px-1">
          <UserPreferenceControls
            isAdult={!!user?.is_adult}
            canDisableSafetyFilter={canDisableSafetyFilter}
            nsfwOn={!!user?.nsfw_on}
            pref={(user?.pref as "female" | "male" | null) ?? null}
            loggedIn={loggedIn}
            variant="homeBanner"
          />
          <Link
            href="/settings"
            className="shrink-0 text-[11px] font-medium text-zinc-500 transition hover:text-zinc-300"
          >
            취향 설정
          </Link>
        </div>
      </div>
      <div className="hidden border-b border-white/[0.07] py-3 md:block">
        <UserPreferenceControls
          isAdult={!!user?.is_adult}
          canDisableSafetyFilter={canDisableSafetyFilter}
          nsfwOn={!!user?.nsfw_on}
          pref={(user?.pref as "female" | "male" | null) ?? null}
          loggedIn={!!user}
          variant="homeRow"
        />
      </div>
      <ScrollSection
        title="추천 캐릭터"
        chars={recommended}
        blurNsfw={blurNsfw}
        loggedIn={loggedIn}
        headerLink={{ href: "/tab/ranking", label: "전체보기" }}
        variant="editorial"
        level="h1"
        staggered
        first
      />
      <ScrollSection
        title="공모전 당선작"
        chars={contest}
        blurNsfw={blurNsfw}
        loggedIn={loggedIn}
        headerLink={{ href: "/tab/ranking", label: "공모전 보기" }}
        variant="exhibit"
        band
      />
      <GridSection
        title="신규 캐릭터"
        chars={newest}
        blurNsfw={blurNsfw}
        loggedIn={loggedIn}
        headerLink={{ href: "/tab/new", label: "더보기" }}
      />
      {recommended.length === 0 && contest.length === 0 && newest.length === 0 ? (
        <div className="mt-10 border border-white/10 px-6 py-12 text-center">
          <p className="text-base font-semibold text-zinc-200">아직 공개된 이야기가 없습니다.</p>
          <p className={cn(studioType.caption, "mx-auto mt-2 max-w-md")}>
            첫 캐릭터나 시뮬레이션을 공개하면 이곳에서 바로 만날 수 있어요.
          </p>
          <Link
            href="/studio"
            className="mt-5 inline-flex min-h-11 items-center bg-white px-5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
          >
            첫 이야기 만들기
          </Link>
        </div>
      ) : null}
    </div>
  );
}
