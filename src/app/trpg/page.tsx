import { redirect } from "next/navigation";
import { AppPageShell } from "@/components/AppPageShell";
import { getSessionUser } from "@/lib/auth";
import { canAccessTrpg } from "@/lib/trpg/access";
import {
  loadAccessibleTrpgCharacter,
  loadTrpgCatalog,
  mergeCatalogCharacters,
} from "@/lib/trpg/catalog";
import { listTrpgCampaigns } from "@/lib/trpg/engine";
import { getDb } from "@/lib/db";
import { parseTrpgInviteInput } from "@/lib/trpg/invite";
import { parseCompanionIds } from "@/lib/trpg/requestIds";
import { TRPG_MAX_SLOTS } from "@/lib/trpg/types";
import TrpgLobbyClient from "./TrpgLobbyClient";

export const dynamic = "force-dynamic";

export default async function TrpgLobbyPage({
  searchParams,
}: {
  searchParams?: Promise<{
    characterId?: string;
    personaId?: string;
    characterIds?: string;
    code?: string;
    q?: string;
    scenarioId?: string;
  }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/trpg");
  if (!canAccessTrpg(user)) redirect("/");
  const params = (await searchParams) ?? {};
  const campaignQuery = typeof params.q === "string" ? params.q : "";
  const inviteCode = parseTrpgInviteInput(params.code);
  if (inviteCode) redirect(`/trpg/join/${inviteCode}`);
  const seededIds = parseCompanionIds(
    typeof params.characterIds === "string"
      ? params.characterIds.split(",").map((s) => s.trim())
      : [],
    params.characterId
  );
  const db = getDb();
  const campaigns = listTrpgCampaigns(db, user.id);
  const extras = seededIds.map((id) => loadAccessibleTrpgCharacter(db, id, user.id));
  const catalog = mergeCatalogCharacters(loadTrpgCatalog(db, user.id), extras);

  return (
    <AppPageShell
      title="TRPG"
      description={`세계관·시나리오 카드를 눌러 본문을 읽은 뒤 캠페인을 시작합니다. 최대 참가인원은 ${TRPG_MAX_SLOTS}명입니다.`}
    >
      <TrpgLobbyClient
        initialCampaigns={campaigns}
        initialCampaignQuery={campaignQuery}
        catalog={catalog}
        characterIds={seededIds}
        initialScenarioId={params.scenarioId}
      />
    </AppPageShell>
  );
}
