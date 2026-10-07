import { NextResponse } from "next/server";
import { setTrpgInventoryEquipped } from "@/lib/trpg/engineInventory";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const body = (await req.json().catch(() => ({}))) as { entryId?: unknown; equipped?: unknown };
    const campaign = setTrpgInventoryEquipped(gate.db, {
      campaignId: id,
      userId: gate.user.id,
      entryId: String(body.entryId ?? ""),
      equipped: body.equipped,
    });
    return NextResponse.json({ ok: true, campaign });
  } catch (e) {
    return trpgFail(e);
  }
}
