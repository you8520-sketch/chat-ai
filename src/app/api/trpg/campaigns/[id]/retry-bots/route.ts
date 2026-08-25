import { NextResponse } from "next/server";
import { retryTrpgBots } from "@/lib/trpg/engine";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const campaign = await retryTrpgBots(gate.db, { campaignId: id, userId: gate.user.id });
    return NextResponse.json({ ok: true, campaign });
  } catch (e) {
    return trpgFail(e);
  }
}
