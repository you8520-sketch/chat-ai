import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import AdultVerifyGate from "@/components/AdultVerifyGate";
import CreateWorld from "@/components/CreateWorld";

export const dynamic = "force-dynamic";

export default async function WorldEditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const { id } = await params;
  const worldId = Number(id);
  if (!user) redirect(`/login?redirect=/world/${id}/edit`);
  if (!Number.isFinite(worldId) || worldId <= 0) redirect("/studio?tab=worlds");

  if (!user.is_adult) {
    return (
      <AdultVerifyGate
        message="세계관 수정은 성인인증을 완료한 회원만 가능합니다."
        redirectTo={`/world/${id}/edit`}
        demoLabel="데모: 인증 없이 수정"
      />
    );
  }

  return (
    <Suspense fallback={<p className="mx-auto max-w-2xl px-4 py-12 text-sm text-zinc-500">불러오는 중…</p>}>
      <CreateWorld worldId={worldId} />
    </Suspense>
  );
}
