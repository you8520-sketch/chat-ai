import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isAdminUser } from "@/lib/isAdminUser";
import { canAccessTrpg } from "@/lib/trpg/access";
import { loadTrpgSnapshot } from "@/lib/trpg/engine";
import {
  canUseTrpgAiFocusAdminExperiment,
  resolveTrpgAiFocusExperimentConfig,
} from "@/lib/trpg/trpgImageSceneMode";
import { ensureDefaultPublicPersona } from "@/lib/userPersonas";
import TrpgRoomClient from "./TrpgRoomClient";

export const dynamic = "force-dynamic";

export default async function TrpgRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/trpg");
  if (!canAccessTrpg(user)) redirect("/");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const campaign = loadTrpgSnapshot(getDb(), id, user.id);
  if (!campaign) notFound();
  const personas = ensureDefaultPublicPersona(user.id, user.nickname);
  const adminRow = getDb()
    .prepare("SELECT is_admin FROM users WHERE id = ?")
    .get(user.id) as { is_admin: number } | undefined;
  const trpgAiFocusExperimentAccess = canUseTrpgAiFocusAdminExperiment({
    config: resolveTrpgAiFocusExperimentConfig(),
    isAdmin: isAdminUser({
      email: user.email,
      is_admin: adminRow?.is_admin ?? 0,
    }),
    userId: user.id,
    campaignId: id,
  });

  return (
    <div className="w-full min-w-0 flex-1">
      <TrpgRoomClient
        initial={campaign}
        personas={personas}
        trpgAiFocusExperimentAccess={trpgAiFocusExperimentAccess}
      />
    </div>
  );
}
