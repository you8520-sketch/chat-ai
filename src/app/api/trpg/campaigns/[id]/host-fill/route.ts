import { NextResponse } from "next/server";
import { advanceTrpgCampaign, hostFillBotAction } from "@/lib/trpg/engine";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const body = (await req.json()) as { participantId?: unknown; body?: unknown };
    hostFillBotAction(gate.db, {
      campaignId: id,
      userId: gate.user.id,
      participantId: Number(body.participantId),
      body: String(body.body ?? ""),
    });
    const campaign = await advanceTrpgCampaign(gate.db, { campaignId: id, userId: gate.user.id });
    return NextResponse.json({ ok: true, campaign });
  } catch (e) {
    return trpgFail(e);
  }
}
