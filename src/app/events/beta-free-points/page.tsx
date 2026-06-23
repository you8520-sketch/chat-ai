import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import BetaFreePointApplicationClient from "./BetaFreePointApplicationClient";

export const dynamic = "force-dynamic";

export default async function BetaFreePointApplicationPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/events/beta-free-points");

  return <BetaFreePointApplicationClient />;
}
