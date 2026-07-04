import Link from "next/link";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import HomeCreateEventBanner from "@/components/HomeCreateEventBanner";
import CharacterCard, { type CharacterRow } from "@/components/CharacterCard";
import HorizontalScrollRow from "@/components/HorizontalScrollRow";
import UserPreferenceControls from "@/components/UserPreferenceControls";
import { fetchHomeSections } from "@/lib/homeSections";

export const dynamic = "force-dynamic";

/** 가로 스크롤 카드 폭 — CharacterCard 세로 2:3 비율 기준 */
const SCROLL_CARD_WIDTH = "w-[128px] sm:w-[150px] md:w-[168px]";

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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        {headerLink && (
          <Link href={headerLink.href} className="text-xs text-violet-400 hover:underline">
            {headerLink.label}
          </Link>
        )}
      </div>
      <HorizontalScrollRow>
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        {headerLink && (
          <Link href={headerLink.href} className="text-xs text-violet-400 hover:underline">
            {headerLink.label}
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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

  const tasteFilter = (
    <UserPreferenceControls
      isAdult={!!user?.is_adult}
      nsfwOn={!!user?.nsfw_on}
      pref={(user?.pref as "female" | "male" | null) ?? null}
      loggedIn={!!user}
      variant="homeRow"
    />
  );

  return (
    <div>
      <HomeCreateEventBanner />
      <div className="mt-6">{tasteFilter}</div>
      <ScrollSection title="추천 캐릭터" chars={recommended} blurNsfw={blurNsfw} loggedIn={loggedIn} />
      <ScrollSection title="공모전 캐릭터" chars={contest} blurNsfw={blurNsfw} loggedIn={loggedIn} />
      <GridSection title="신규 캐릭터" chars={newest} blurNsfw={blurNsfw} loggedIn={loggedIn} />
    </div>
  );
}
