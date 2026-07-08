import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isDemoEnv } from "@/lib/demo";
import DemoAdultSkip from "@/components/DemoAdultSkip";
import MyCharacterCard, { type MyCharacterRow } from "@/components/MyCharacterCard";
import StudioCreateNav from "@/components/StudioCreateNav";
import {
  IconSidebarStudio,
  IconSidebarVerify,
  IconStudioWorld,
} from "@/components/SidebarNavIcons";
import { rowToWorldListItem, type WorldRow } from "@/lib/worlds";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/studio");

  if (!user.is_adult) {
    return (
      <div className="mx-auto mt-20 max-w-sm rounded-2xl border border-white/10 bg-[#131626] p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.04] text-zinc-400">
          <IconSidebarVerify className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-black text-white">성인인증이 필요합니다</h1>
        <p className="mt-2 text-sm text-gray-400">제작 메뉴는 성인인증을 완료한 회원만 이용할 수 있습니다.</p>
        <Link href="/verify" className="mt-6 inline-block w-full rounded-xl bg-violet-600 py-3 font-bold text-white hover:bg-violet-500">
          성인인증 하러 가기
        </Link>
        {isDemoEnv() && <DemoAdultSkip redirectTo="/studio" label="데모: 인증 없이 제작 메뉴 보기" />}
      </div>
    );
  }

  const blurNsfw = !user.nsfw_on;
  const db = getDb();
  const chars = db
    .prepare(`SELECT * FROM characters WHERE creator_id = ? ORDER BY created_at DESC, id DESC`)
    .all(user.id) as MyCharacterRow[];
  const worlds = (
    db
      .prepare(
        `SELECT id, creator_id, name, summary, content, created_at, updated_at
         FROM worlds WHERE creator_id = ? ORDER BY updated_at DESC, id DESC`
      )
      .all(user.id) as WorldRow[]
  ).map(rowToWorldListItem);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="flex items-center gap-2.5 text-2xl font-black text-white">
        <IconSidebarStudio className="h-6 w-6 shrink-0 text-zinc-400" />
        제작
      </h1>

      <div className="mt-5">
        <StudioCreateNav />
      </div>

      <section className="mt-10">
        <div>
          <h2 className="text-lg font-bold text-white">내 제작 캐릭터</h2>
          <p className="mt-1 text-sm text-gray-400">
            내가 만든 캐릭터입니다. 메인 홈에는 표시되지 않습니다.
          </p>
        </div>

        {chars.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-white/10 bg-[#131626] p-10 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-500">
              <IconSidebarStudio className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm text-gray-400">아직 제작한 캐릭터가 없습니다.</p>
            <Link
              href="/create"
              className="mt-5 inline-block rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500"
            >
              캐릭터 제작하기
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {chars.map((c) => (
              <MyCharacterCard key={c.id} c={c} blurNsfw={blurNsfw} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">내 제작 세계관</h2>
            <p className="mt-1 text-sm text-gray-400">
              저장한 세계관입니다. 캐릭터 제작의 「세계관 / 배경」에서 불러올 수 있습니다.
            </p>
          </div>
          <Link
            href="/world/create"
            className="rounded-xl border border-cyan-500/35 bg-cyan-500/15 px-4 py-2 text-sm font-bold text-cyan-50 hover:bg-cyan-500/25"
          >
            + 새 세계관
          </Link>
        </div>

        {worlds.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-[#131626] p-8 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-500">
              <IconStudioWorld className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm text-gray-400">아직 제작한 세계관이 없습니다.</p>
            <Link
              href="/world/create"
              className="mt-5 inline-block rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-cyan-500"
            >
              세계관 제작하기
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                  <Link
                    href="/world/create"
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/5"
                  >
                    세계관 추가 제작
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
