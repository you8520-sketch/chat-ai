import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getCreatorDashboard } from "@/lib/creatorPoints";
import CreatorClient from "./CreatorClient";

export const dynamic = "force-dynamic";

export default async function CreatorPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/creator");

  // Non-creators can open the page to see tiers / how to start (sidebar is always visible).
  const dashboard = getCreatorDashboard(user.id);
  return <CreatorClient initial={dashboard} />;
}
