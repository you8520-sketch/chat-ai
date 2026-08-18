import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canAccessTrpg } from "@/lib/trpg/access";
import type { TrpgDiceLabRenderer } from "@/lib/trpg/diceRollUx";
import TrpgDiceLabClient from "./TrpgDiceLabClient";

export const dynamic = "force-dynamic";

function parseRenderer(value: string | undefined): TrpgDiceLabRenderer {
  if (value === "dice-box-threejs" || value === "b") return "dice-box-threejs";
  return "custom";
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
