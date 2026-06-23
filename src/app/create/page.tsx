import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { resolveViewerDisplayNameForUser } from "@/lib/viewerDisplayName";
import { isDemoEnv } from "@/lib/demo";
import DemoAdultSkip from "@/components/DemoAdultSkip";
import CreateCharacter from "@/components/CreateCharacter";

export const dynamic = "force-dynamic";

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/create");

  const { edit: editParam } = await searchParams;
  const editId = editParam ? Number(editParam) : null;
  const editCharacterId =
    editId != null && Number.isFinite(editId) && editId > 0 ? editId : null;

  if (!user.is_adult) {
    return (
      <div className="mx-auto mt-20 max-w-sm rounded-2xl border border-amber-500/30 bg-[#131626] p-8 text-center">
        <p className="text-4xl">🔒</p>
        <h1 className="mt-3 text-xl font-black text-white">성인인증이 필요합니다</h1>
        <p className="mt-2 text-sm text-gray-400">캐릭터 제작은 성인인증을 완료한 회원만 가능합니다.</p>
        <Link href="/verify" className="mt-6 inline-block w-full rounded-xl bg-rose-600 py-3 font-bold text-white">
          성인인증 하러 가기
        </Link>
        {isDemoEnv() && <DemoAdultSkip redirectTo="/create" label="데모: 인증 없이 제작 페이지 보기" />}
      </div>
    );
  }
  return (
    <CreateCharacter
      editCharacterId={editCharacterId}
      viewerDisplayName={resolveViewerDisplayNameForUser(user)}
      creatorDisplayName={user.nickname}
      userId={user.id}
    />
  );
}
