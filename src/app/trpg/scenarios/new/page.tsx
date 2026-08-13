import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canAccessTrpg } from "@/lib/trpg/access";
import { loadTrpgCatalog } from "@/lib/trpg/catalog";
import TrpgScenarioEditor from "../../TrpgScenarioEditor";

export const dynamic = "force-dynamic";

export default async function NewTrpgScenarioPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/trpg/scenarios/new");
  if (!canAccessTrpg(user)) redirect("/");
  return <TrpgScenarioEditor catalog={loadTrpgCatalog(getDb(), user.id)} />;
}
