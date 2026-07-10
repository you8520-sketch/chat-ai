import Link from "next/link";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import HomeCreateEventBanner from "@/components/HomeCreateEventBanner";
import CharacterCard, { type CharacterRow } from "@/components/CharacterCard";
import HorizontalScrollRow from "@/components/HorizontalScrollRow";
import UserPreferenceControls from "@/components/UserPreferenceControls";
import { fetchHomeSections } from "@/lib/homeSections";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

export const dynamic = "force-dynamic";

/** 가로 스크롤 카드 폭 — CharacterCard 세로 2:3 비율 기준 */
const SCROLL_CARD_WIDTH = "w-[128px] sm:w-[150px] md:w-[168px]";

function SectionHeader({
  title,
  headerLink,
}: {
  title: string;
  headerLink?: { href: string; label: string };
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <h2 className={studioType.sectionTitle}>{title}</h2>
      {headerLink ? (
        <Link href={headerLink.href} className={studioSurface.linkQuiet}>
          {headerLink.label}
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
    <section className="mt-8">
      <SectionHeader title={title} headerLink={headerLink} />
      <HorizontalScrollRow className="gap-4">
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
    <section className="mt-8">
      <SectionHeader title={title} headerLink={headerLink} />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
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

  return (
    <div className="pb-2">
      <HomeCreateEventBanner />
      <div className="mt-6">
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
      />
      <ScrollSection
        title="공모전 캐릭터"
        chars={contest}
        blurNsfw={blurNsfw}
        loggedIn={loggedIn}
      />
      <GridSection
        title="신규 캐릭터"
        chars={newest}
        blurNsfw={blurNsfw}
        loggedIn={loggedIn}
        headerLink={{ href: "/tab/new", label: "더보기" }}
      />
      {recommended.length === 0 && contest.length === 0 && newest.length === 0 ? (
        <div className={cn(studioSurface.cardDashed, "mt-10 p-10 text-center")}>
          <p className={studioType.body}>표시할 캐릭터가 없습니다.</p>
          <Link href="/studio" className={cn(studioSurface.linkQuiet, "mt-3 inline-block text-sm")}>
            제작하러 가기
          </Link>
        </div>
      ) : null}
    </div>
  );
}
