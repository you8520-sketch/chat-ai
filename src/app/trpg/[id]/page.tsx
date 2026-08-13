import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canAccessTrpg } from "@/lib/trpg/access";
import { loadTrpgSnapshot } from "@/lib/trpg/engine";
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

  return (
    <div className="w-full min-w-0 flex-1">
      <TrpgRoomClient initial={campaign} personas={personas} />
    </div>
  );
}
