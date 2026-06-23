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
} from "@/components/SidebarNavIcons";

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
    </div>
  );
}
