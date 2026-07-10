import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import MyCharacterCard, { type MyCharacterRow } from "@/components/MyCharacterCard";
import StudioButton from "@/components/studio/StudioButton";
import StudioEmptyState, { StudioBackLink } from "@/components/studio/StudioEmptyState";
import { IconSidebarStudio } from "@/components/SidebarNavIcons";
import { studioType } from "@/lib/studioDesign";

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
    <div className="w-full pb-8">
      <StudioBackLink href="/studio">← 제작 메뉴</StudioBackLink>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className={studioType.heading}>내 제작 캐릭터</h1>
          <p className={`${studioType.helper} mt-2`}>
            내가 만든 캐릭터만 모아 둔 목록입니다. 메인 홈에는 표시되지 않습니다.
          </p>
        </div>
        <StudioButton href="/create">+ 새 캐릭터</StudioButton>
      </div>

      {chars.length === 0 ? (
        <StudioEmptyState
          icon={<IconSidebarStudio className="h-5 w-5" />}
          message="아직 제작한 캐릭터가 없습니다."
          href="/create"
          cta="캐릭터 제작하기"
        />
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {chars.map((c) => (
            <MyCharacterCard key={c.id} c={c} blurNsfw={blurNsfw} />
          ))}
        </div>
      )}
    </div>
  );
}
