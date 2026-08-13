import { NextResponse } from "next/server";
import { addTrpgCompanions, loadTrpgSnapshot } from "@/lib/trpg/engine";
import { parseCompanionIds } from "@/lib/trpg/requestIds";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    addTrpgCompanions(gate.db, {
      campaignId: id,
      userId: gate.user.id,
      characterIds: parseCompanionIds(body.characterIds, body.characterId),
    });
    const campaign = loadTrpgSnapshot(gate.db, id, gate.user.id);
    return NextResponse.json({ ok: true, campaign });
  } catch (e) {
    return trpgFail(e);
  }
}
