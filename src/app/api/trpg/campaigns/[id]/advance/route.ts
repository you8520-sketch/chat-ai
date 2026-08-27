import { NextResponse } from "next/server";
import { advanceTrpgCampaign } from "@/lib/trpg/engine";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const campaignId = campaignIdFromParams((await ctx.params).id);
    const campaign = await advanceTrpgCampaign(gate.db, {
      campaignId,
      userId: gate.user.id,
      source: "poll_advance",
    });
    return NextResponse.json({ ok: true, campaign });
  } catch (e) {
    return trpgFail(e);
  }
}
