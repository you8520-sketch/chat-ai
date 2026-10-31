import { NextResponse } from "next/server";
import { loadTrpgSnapshot } from "@/lib/trpg/engine";
import { spendTrpgStatPoint } from "@/lib/trpg/progression";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const body = (await req.json()) as { statKey?: unknown };
    const allocation = spendTrpgStatPoint(gate.db, {
      campaignId: id,
      userId: gate.user.id,
      statKey: String(body.statKey ?? ""),
    });
    const campaign = loadTrpgSnapshot(gate.db, id, gate.user.id);
    return NextResponse.json({ ok: true, allocation, campaign });
  } catch (e) {
    return trpgFail(e);
  }
}
