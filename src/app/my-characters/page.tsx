import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import MyCharacterCard, { type MyCharacterRow } from "@/components/MyCharacterCard";
import { IconSidebarStudio } from "@/components/SidebarNavIcons";

export const dynamic = "force-dynamic";

export default async function MyCharactersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/my-characters");

  const blurNsfw = !user.is_adult || !user.nsfw_on;
  const db = getDb();
  const chars = db
    .prepare(`SELECT * FROM characters WHERE creator_id = ? ORDER BY created_at DESC, id DESC`)
    .all(user.id) as MyCharacterRow[];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/studio" className="text-sm text-zinc-500 hover:text-zinc-300">
            ← 제작 메뉴
          </Link>
          <h1 className="mt-2 text-2xl font-black text-white">내 제작 캐릭터</h1>
          <p className="mt-2 text-sm text-gray-400">
            내가 만든 캐릭터만 모아 둔 목록입니다. 메인 홈에는 표시되지 않습니다.
          </p>
        </div>
        <Link
          href="/create"
          className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500"
        >
          + 새 캐릭터
        </Link>
      </div>

      {chars.length === 0 ? (
        <div className="mt-16 rounded-2xl border border-dashed border-white/10 bg-[#131626] p-12 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-500">
            <IconSidebarStudio className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm text-gray-400">아직 제작한 캐릭터가 없습니다.</p>
          <Link href="/create" className="mt-6 inline-block rounded-xl bg-violet-600 px-6 py-3 font-bold text-white">
            캐릭터 제작하기
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {chars.map((c) => (
            <MyCharacterCard key={c.id} c={c} blurNsfw={blurNsfw} />
          ))}
        </div>
      )}
    </div>
  );
}
