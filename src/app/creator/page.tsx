import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { userHasCreatedCharacters } from "@/lib/creatorAccess";
import { getCreatorDashboard } from "@/lib/creatorPoints";
import CreatorClient from "./CreatorClient";

export const dynamic = "force-dynamic";

export default async function CreatorPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/creator");
  if (!userHasCreatedCharacters(user.id)) redirect("/studio");

  const dashboard = getCreatorDashboard(user.id);
  return <CreatorClient initial={dashboard} />;
}
