import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import HomeCreateEventBanner from "@/components/HomeCreateEventBanner";
import CharacterCard, { type CharacterRow } from "@/components/CharacterCard";
import UserPreferenceControls from "@/components/UserPreferenceControls";
import { fetchHomeSections } from "@/lib/homeSections";

export const dynamic = "force-dynamic";

function Section({
  title,
  chars,
  blurNsfw,
  loggedIn,
}: {
  title: string;
  chars: CharacterRow[];
  blurNsfw: boolean;
  loggedIn: boolean;
}) {
  if (chars.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-bold text-white">{title}</h2>
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

  const { recommended, hotNew, newest } = fetchHomeSections(db, user, blurNsfw);

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
      <section className="mt-8">
        {tasteFilter}
        <h2 className="mt-4 mb-3 text-lg font-bold text-white">취향 기반 추천</h2>
        {recommended.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {recommended.map((c) => (
              <CharacterCard key={c.id} c={c} blurNsfw={blurNsfw} loggedIn={loggedIn} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">선택한 취향에 맞는 캐릭터가 없습니다.</p>
        )}
      </section>
      <Section title="현재 핫한 신작" chars={hotNew} blurNsfw={blurNsfw} loggedIn={loggedIn} />
      <Section title="최신 신작" chars={newest} blurNsfw={blurNsfw} loggedIn={loggedIn} />
    </div>
  );
}
