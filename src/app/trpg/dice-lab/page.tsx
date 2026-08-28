import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canAccessTrpg } from "@/lib/trpg/access";
import TrpgDiceLabClient from "./TrpgDiceLabClient";

export const dynamic = "force-dynamic";

export default async function TrpgDiceLabPage() {
  if (process.env.NODE_ENV === "production") {
    const user = await getSessionUser();
    if (!user) redirect("/login?redirect=/trpg/dice-lab");
    if (!canAccessTrpg(user)) redirect("/");
  }
  return <TrpgDiceLabClient />;
}
