import { redirect } from "next/navigation";
import { AppPageShell } from "@/components/AppPageShell";
import { getSessionUser } from "@/lib/auth";
import { canAccessTrpg } from "@/lib/trpg/access";
import { loadTrpgCatalog } from "@/lib/trpg/catalog";
import { listTrpgCampaigns } from "@/lib/trpg/engine";
import { getDb } from "@/lib/db";
import TrpgLobbyClient from "./TrpgLobbyClient";

export const dynamic = "force-dynamic";

export default async function TrpgLobbyPage({
  searchParams,
}: {
  searchParams?: Promise<{ characterId?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/trpg");
  if (!canAccessTrpg(user)) redirect("/");
  const characterIdRaw = Number((await searchParams)?.characterId);
  const characterId = Number.isInteger(characterIdRaw) && characterIdRaw > 0 ? characterIdRaw : null;
  const db = getDb();
  const campaigns = listTrpgCampaigns(db, user.id);
  const catalog = loadTrpgCatalog(db, user.id);

  return (
    <AppPageShell
      title="TRPG"
      description="1~4인 라운드제 캠페인. 공개 세계관·시나리오를 고르거나 전용 시나리오를 만들 수 있습니다. 관리자 전용 미리보기이며 일반 채팅과는 분리됩니다."
      narrow
    >
      <TrpgLobbyClient initialCampaigns={campaigns} catalog={catalog} characterId={characterId} />
    </AppPageShell>
  );
}
