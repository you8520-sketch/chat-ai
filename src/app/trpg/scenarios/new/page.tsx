import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canAccessTrpg } from "@/lib/trpg/access";

export const dynamic = "force-dynamic";

export default async function NewTrpgScenarioPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/world/create?tab=scenario");
  if (!canAccessTrpg(user)) redirect("/");
  redirect("/world/create?tab=scenario");
}
