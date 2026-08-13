import { NextResponse } from "next/server";
import { advanceTrpgCampaign, submitTrpgAction } from "@/lib/trpg/engine";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const body = (await req.json()) as {
      body?: unknown;
      actionType?: unknown;
      selectedStat?: unknown;
      idempotencyKey?: unknown;
    };
    submitTrpgAction(gate.db, {
      campaignId: id,
      userId: gate.user.id,
      body: String(body.body ?? ""),
      actionType: typeof body.actionType === "string" ? body.actionType : null,
      selectedStat: typeof body.selectedStat === "string" ? body.selectedStat : null,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
    });
    const campaign = await advanceTrpgCampaign(gate.db, { campaignId: id, userId: gate.user.id });
    return NextResponse.json({ ok: true, campaign });
  } catch (e) {
    return trpgFail(e);
  }
}
