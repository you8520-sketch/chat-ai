import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canAccessTrpg } from "@/lib/trpg/access";
import type { TrpgDiceRenderer } from "../TrpgDiceOverlay";
import TrpgDiceLabClient from "./TrpgDiceLabClient";

export const dynamic = "force-dynamic";

function parseRenderer(value: string | undefined): TrpgDiceRenderer {
  return value === "custom" || value === "a" ? "custom" : "dice-box-threejs";
}

export default async function TrpgDiceLabPage({
  searchParams,
}: {
  searchParams?: Promise<{ proto?: string; renderer?: string }>;
}) {
  if (process.env.NODE_ENV === "production") {
    const user = await getSessionUser();
    if (!user) redirect("/login?redirect=/trpg/dice-lab");
    if (!canAccessTrpg(user)) redirect("/");
  }
  const params = (await searchParams) ?? {};
  return <TrpgDiceLabClient initialRenderer={parseRenderer(params.proto ?? params.renderer)} />;
}
