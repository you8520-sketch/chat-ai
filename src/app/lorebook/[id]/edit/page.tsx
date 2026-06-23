import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { isDemoEnv } from "@/lib/demo";
import DemoAdultSkip from "@/components/DemoAdultSkip";
import CreateKeywordLorebook from "@/components/CreateKeywordLorebook";

export const dynamic = "force-dynamic";

export default async function LorebookEditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const { id } = await params;
  const lorebookId = Number(id);
  if (!user) redirect(`/login?redirect=/lorebook/${id}/edit`);
  if (!Number.isFinite(lorebookId)) redirect("/studio");

  if (!user.is_adult) {
    return (
      <div className="mx-auto mt-20 max-w-sm rounded-2xl border border-amber-500/30 bg-[#131626] p-8 text-center">
        <p className="text-4xl">🔒</p>
        <h1 className="mt-3 text-xl font-black text-white">성인인증이 필요합니다</h1>
        <Link href="/verify" className="mt-6 inline-block w-full rounded-xl bg-rose-600 py-3 font-bold text-white">
          성인인증 하러 가기
        </Link>
        {isDemoEnv() && <DemoAdultSkip redirectTo={`/lorebook/${id}/edit`} label="데모: 인증 없이 수정" />}
      </div>
    );
  }

  return <CreateKeywordLorebook lorebookId={lorebookId} />;
}
