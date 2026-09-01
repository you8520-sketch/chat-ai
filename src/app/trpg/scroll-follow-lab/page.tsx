import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canAccessTrpg } from "@/lib/trpg/access";
import TrpgScrollFollowLabClient from "./TrpgScrollFollowLabClient";

export const dynamic = "force-dynamic";

export default async function TrpgScrollFollowLabPage() {
  if (process.env.NODE_ENV === "production") {
    const user = await getSessionUser();
    if (!user) redirect("/login?redirect=/trpg/scroll-follow-lab");
    if (!canAccessTrpg(user)) redirect("/");
  }
  return <TrpgScrollFollowLabClient />;
}
