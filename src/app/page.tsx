import Link from "next/link";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import HomeCreateEventBanner from "@/components/HomeCreateEventBanner";
import HomePopupNotice from "@/components/HomePopupNotice";
import CharacterCard, { type CharacterRow } from "@/components/CharacterCard";
import HorizontalScrollRow from "@/components/HorizontalScrollRow";
import UserPreferenceControls from "@/components/UserPreferenceControls";
import { fetchHomeSections } from "@/lib/homeSections";
import { getActiveHomePopupNotice } from "@/lib/homePopupNotice";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

export const dynamic = "force-dynamic";

/** 소개와 태그를 충분히 읽을 수 있는 세로형 카드 폭 */
const SCROLL_CARD_WIDTH = "w-[168px] sm:w-[196px] xl:w-[216px]";

const SECTION_META: Record<string, { eyebrow: string; description: string }> = {
  "추천 캐릭터": {
    eyebrow: "FOR YOU",
    description: "취향과 활동을 바탕으로 골라낸 이야기",
  },
  "공모전 당선작": {
    eyebrow: "AWARD WINNERS",
    description: "공모전에서 주목받은 캐릭터와 시뮬레이션",
  },
  "신규 캐릭터": {
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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {meta ? (
          <p className="mb-1.5 text-[10px] font-semibold tracking-[0.18em] text-violet-300/80">
            {meta.eyebrow}
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
      {headerLink ? (
        <Link
          href={headerLink.href}
          className="group inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
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
    <section className="mt-12 border-t border-white/[0.07] pt-9 first:border-0">
      <SectionHeader title={title} headerLink={headerLink} />
      <HorizontalScrollRow className="home-card-row gap-3.5 pb-2 sm:gap-4">
        {chars.map((c) => (
          <div key={c.id} className={`${SCROLL_CARD_WIDTH} shrink-0`}>
            <CharacterCard c={c} blurNsfw={blurNsfw} loggedIn={loggedIn} />
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
    <section className="mt-12 border-t border-white/[0.07] pt-9">
      <SectionHeader title={title} headerLink={headerLink} />
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
        {chars.map((c) => (
          <CharacterCard key={c.id} c={c} blurNsfw={blurNsfw} loggedIn={loggedIn} />
        ))}
      </div>
    </section>
  );
}

export default async function Home() {
  const db = getDb();
  const user = await getSessionUser();
  const blurNsfw = !user?.is_adult || !user?.nsfw_on;
  const loggedIn = !!user;

  const { recommended, contest, newest } = fetchHomeSections(db, user, blurNsfw);
  const popupNotice = getActiveHomePopupNotice(db);

  return (
    <div className="pb-6">
      <HomePopupNotice notice={popupNotice} />
      <HomeCreateEventBanner />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-6">
        <div>
          <p className="text-sm font-semibold text-zinc-100">어떤 이야기를 찾고 있나요?</p>
          <p className="mt-1 text-xs text-zinc-500">취향을 고르면 추천 목록이 더 정확해집니다.</p>
        </div>
        <UserPreferenceControls
          isAdult={!!user?.is_adult}
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
      />
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
        <div
          className={cn(
            studioSurface.cardDashed,
            "relative mt-12 overflow-hidden px-6 py-14 text-center",
          )}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(124,58,237,.14),transparent_48%)]" />
          <div className="relative">
            <p className="text-base font-semibold text-zinc-200">아직 공개된 이야기가 없습니다.</p>
            <p className={cn(studioType.caption, "mx-auto mt-2 max-w-md")}>
              첫 캐릭터나 시뮬레이션을 공개하면 이곳에서 바로 만날 수 있어요.
            </p>
            <Link
              href="/studio"
              className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white transition hover:bg-violet-500"
            >
              첫 이야기 만들기
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
