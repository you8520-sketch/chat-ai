import { NextResponse } from "next/server";
import { loadTrpgSnapshot } from "@/lib/trpg/engine";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const campaign = loadTrpgSnapshot(gate.db, id, gate.user.id);
    if (!campaign) return NextResponse.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ campaign });
  } catch (e) {
    return trpgFail(e);
  }
}
