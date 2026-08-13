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
import { parseCompanionIds, parseOptionalId } from "@/lib/trpg/requestIds";
import { ensureDefaultPublicPersona } from "@/lib/userPersonas";
import TrpgLobbyClient from "./TrpgLobbyClient";

export const dynamic = "force-dynamic";

export default async function TrpgLobbyPage({
  searchParams,
}: {
  searchParams?: Promise<{ characterId?: string; personaId?: string; characterIds?: string; code?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/trpg");
  if (!canAccessTrpg(user)) redirect("/");
  const params = (await searchParams) ?? {};
  const inviteCode = parseTrpgInviteInput(params.code);
  if (inviteCode) redirect(`/trpg/join/${inviteCode}`);
  const seededIds = parseCompanionIds(
    typeof params.characterIds === "string"
      ? params.characterIds.split(",").map((s) => s.trim())
      : [],
    params.characterId
  );
  const personaId = parseOptionalId(params.personaId);
  const db = getDb();
  const campaigns = listTrpgCampaigns(db, user.id);
  const extras = seededIds.map((id) => loadAccessibleTrpgCharacter(db, id, user.id));
  const catalog = mergeCatalogCharacters(loadTrpgCatalog(db, user.id), extras);
  const personas = ensureDefaultPublicPersona(user.id, user.nickname);

  return (
    <AppPageShell
      title="TRPG"
      description="1~4인 라운드제 캠페인. 공개 세계관·시나리오를 카드로 고르거나 전용 시나리오를 만들 수 있습니다. 관리자 전용 미리보기이며 일반 채팅과는 분리됩니다."
    >
      <TrpgLobbyClient
        initialCampaigns={campaigns}
        catalog={catalog}
        characterIds={seededIds}
        personas={personas}
        initialPersonaId={personaId}
      />
    </AppPageShell>
  );
}
