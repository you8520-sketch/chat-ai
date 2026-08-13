import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import AdultVerifyGate from "@/components/AdultVerifyGate";
import CreateWorld from "@/components/CreateWorld";
import { canAccessTrpg } from "@/lib/trpg/access";
import { loadTrpgCatalog } from "@/lib/trpg/catalog";
import { parseWorldStudioKind } from "@/lib/worlds";

export const dynamic = "force-dynamic";

export default async function WorldCreatePage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/world/create");

  if (!user.is_adult) {
    return (
      <AdultVerifyGate
        message="세계관 제작은 성인인증을 완료한 회원만 가능합니다."
        redirectTo="/world/create"
        demoLabel="데모: 인증 없이 세계관 제작 보기"
      />
    );
  }

  const db = getDb();
  const adminRow = db
    .prepare("SELECT is_admin FROM users WHERE id = ?")
    .get(user.id) as { is_admin: number } | undefined;
  const showTrpg = canAccessTrpg({ email: user.email, is_admin: adminRow?.is_admin ?? 0 });
  const tab = parseWorldStudioKind((await searchParams)?.tab);
  if (tab === "scenario" && !showTrpg) redirect("/world/create");

  return (
    <Suspense fallback={<p className="mx-auto max-w-2xl px-4 py-12 text-sm text-zinc-500">불러오는 중…</p>}>
      <CreateWorld showTrpg={showTrpg} catalog={showTrpg ? loadTrpgCatalog(db, user.id) : null} />
    </Suspense>
  );
}
