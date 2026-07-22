import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import AdultVerifyGate from "@/components/AdultVerifyGate";
import StudioClient from "@/components/StudioClient";
import type { MyCharacterRow } from "@/components/MyCharacterCard";
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
      <AdultVerifyGate
        message="제작 메뉴는 성인인증을 완료한 회원만 이용할 수 있습니다."
        redirectTo="/studio"
        demoLabel="데모: 인증 없이 제작 메뉴 보기"
      />
    );
  }

  const blurNsfw = !user.nsfw_on;
  const db = getDb();
  const characters = db
    .prepare(`SELECT * FROM characters WHERE creator_id = ? AND COALESCE(content_kind, 'character') = 'character' ORDER BY created_at DESC, id DESC`)
    .all(user.id) as MyCharacterRow[];
  const simulations = db
    .prepare(`SELECT * FROM characters WHERE creator_id = ? AND content_kind = 'simulation' ORDER BY created_at DESC, id DESC`)
    .all(user.id) as MyCharacterRow[];
  const worlds = (
    db
      .prepare(
        `SELECT id, creator_id, name, summary, content, created_at, updated_at,
                COALESCE(shared_from_nickname, '') AS shared_from_nickname
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
        simulations={simulations}
        worlds={worlds}
        lorebooks={lorebooks}
        blurNsfw={blurNsfw}
      />
    </Suspense>
  );
}
