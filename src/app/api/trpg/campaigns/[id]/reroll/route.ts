import { NextResponse } from "next/server";
import { regenerateTrpgNarration } from "@/lib/trpg/engine";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const body = (await req.json().catch(() => ({}))) as { roundNumber?: unknown };
    const roundNumber =
      typeof body.roundNumber === "number" && Number.isInteger(body.roundNumber) && body.roundNumber >= 0
        ? body.roundNumber
        : undefined;
    const campaign = await regenerateTrpgNarration(gate.db, {
      campaignId: id,
      userId: gate.user.id,
      roundNumber,
    });
    return NextResponse.json({ ok: true, campaign });
  } catch (e) {
    return trpgFail(e);
  }
}
