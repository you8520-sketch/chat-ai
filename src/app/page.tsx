import Link from "next/link";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import HomeCharacterStage from "@/components/HomeCharacterStage";
import HomeCreateEventBanner from "@/components/HomeCreateEventBanner";
import HomePopupNotice from "@/components/HomePopupNotice";
import CharacterCard, { type CharacterRow } from "@/components/CharacterCard";
import HorizontalScrollRow from "@/components/HorizontalScrollRow";
import UserPreferenceControls from "@/components/UserPreferenceControls";
import { canAccessAdultContent, shouldHideAdultListings } from "@/lib/adultVerification";
import { fetchHomeSections } from "@/lib/homeSections";
import { getActiveHomePopupNotice } from "@/lib/homePopupNotice";
import { toHomeStageCharacters } from "@/lib/homeStagePresentation";
import { cn, studioType } from "@/lib/studioDesign";

export const dynamic = "force-dynamic";

/** 소개와 태그를 충분히 읽을 수 있는 세로형 카드 폭 */
const SCROLL_CARD_WIDTH = "w-[168px] sm:w-[196px] xl:w-[216px]";

const MOBILE_DISCOVERY_TABS = [
  { href: "/", label: "추천" },
  { href: "/tab/new", label: "신작랭킹" },
  { href: "/tab/ranking", label: "랭킹" },
  { href: "/trpg", label: "TRPG" },
  { href: "/search", label: "검색" },
] as const;

const SECTION_META: Record<
  string,
  { index: string; eyebrow: string; description: string }
> = {
  "공모전 당선작": {
    index: "02",
    eyebrow: "SELECTED",
    description: "공모전에서 주목받은 캐릭터와 시뮬레이션",
  },
  "신규 캐릭터": {
    index: "03",
    eyebrow: "NEW STORIES",
    description: "방금 공개된 새로운 만남",
  },
};

function SectionHeader({
  title,
  headerLink,
}: {
  title: string;
  headerLink?: { href: string; label: string };
}) {
  const meta = SECTION_META[title];
  return (
    <div className="relative mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="relative min-w-0 flex-1">
        <div>
          {meta ? (
            <p className="mb-1.5 text-[10px] font-semibold tracking-[0.2em] text-zinc-500">
              {meta.index} / {meta.eyebrow}
            </p>
          ) : null}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-2xl">
              {title}
            </h2>
            {meta ? (
              <p className="hidden text-xs text-zinc-500 sm:block">{meta.description}</p>
            ) : null}
          </div>
        </div>
      </div>
      {headerLink ? (
        <Link
          href={headerLink.href}
          className="group relative z-10 inline-flex min-h-9 items-center gap-1 px-1 text-xs font-semibold text-zinc-400 underline decoration-white/15 underline-offset-4 transition hover:text-zinc-100 hover:decoration-white/40"
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
}: {
  title: string;
  chars: CharacterRow[];
  blurNsfw: boolean;
  loggedIn: boolean;
  headerLink?: { href: string; label: string };
}) {
  if (chars.length === 0) return null;
  return (
    <section className="mt-8 border-t border-white/10 pt-7 sm:mt-10">
      <SectionHeader title={title} headerLink={headerLink} />
      <HorizontalScrollRow className="home-card-row gap-3.5 pb-2 sm:gap-4">
        {chars.map((c) => (
          <div key={c.id} className={`${SCROLL_CARD_WIDTH} shrink-0`}>
            <CharacterCard c={c} blurNsfw={blurNsfw} loggedIn={loggedIn} variant="editorial" />
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
    <section className="mt-8 border-t border-white/10 pt-7 sm:mt-10">
      <SectionHeader title={title} headerLink={headerLink} />
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
        {chars.map((c) => (
          <CharacterCard key={c.id} c={c} blurNsfw={blurNsfw} loggedIn={loggedIn} variant="editorial" />
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
      <HomeCharacterStage
        characters={toHomeStageCharacters(recommended, { blurNsfw, loggedIn })}
      />
      <HomeCreateEventBanner />
      <div className="mt-6 border-b border-white/[0.07] pb-6 md:hidden">
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
      <div className="mt-6 hidden border-b border-white/[0.07] pb-6 md:block">
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
        title="공모전 당선작"
        chars={contest}
        blurNsfw={blurNsfw}
        loggedIn={loggedIn}
        headerLink={{ href: "/tab/ranking", label: "공모전 보기" }}
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
