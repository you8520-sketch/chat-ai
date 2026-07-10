import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isDemoEnv } from "@/lib/demo";
import DemoAdultSkip from "@/components/DemoAdultSkip";
import StudioClient from "@/components/StudioClient";
import type { MyCharacterRow } from "@/components/MyCharacterCard";
import { IconSidebarVerify } from "@/components/SidebarNavIcons";
import {
  rowToLorebookListItem,
  type KeywordLorebookRow,
} from "@/lib/keywordLorebooks";
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
  const characters = db
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
  const lorebooks = (
    db
      .prepare(
        `SELECT id, creator_id, name, summary, entries_json, created_at, updated_at
         FROM keyword_lorebooks WHERE creator_id = ? ORDER BY updated_at DESC, id DESC`
      )
      .all(user.id) as KeywordLorebookRow[]
  ).map(rowToLorebookListItem);

  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-zinc-500">불러오는 중…</div>
      }
    >
      <StudioClient
        characters={characters}
        worlds={worlds}
        lorebooks={lorebooks}
        blurNsfw={blurNsfw}
      />
    </Suspense>
  );
}
