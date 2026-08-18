import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canAccessTrpg } from "@/lib/trpg/access";
import TrpgResultLabClient from "./TrpgResultLabClient";

export const dynamic = "force-dynamic";

export default async function TrpgResultLabPage() {
  if (process.env.NODE_ENV === "production") {
    const user = await getSessionUser();
    if (!user) redirect("/login?redirect=/trpg/result-lab");
    if (!canAccessTrpg(user)) redirect("/");
  }
  return <TrpgResultLabClient />;
}
