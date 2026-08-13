import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canAccessTrpg } from "@/lib/trpg/access";
import { loadTrpgCatalog } from "@/lib/trpg/catalog";
import { loadScenarioTemplate, rowToScenarioTemplate } from "@/lib/trpg/scenarioTemplates";
import TrpgScenarioEditor from "../../TrpgScenarioEditor";

export const dynamic = "force-dynamic";

export default async function EditTrpgScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/trpg");
  if (!canAccessTrpg(user)) redirect("/");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const row = loadScenarioTemplate(getDb(), id);
  if (!row || row.creator_id !== user.id) notFound();
  return (
    <TrpgScenarioEditor
      catalog={loadTrpgCatalog(getDb(), user.id)}
      initial={rowToScenarioTemplate(row)}
      returnHref="/studio?tab=worlds&kind=scenario"
    />
  );
}
