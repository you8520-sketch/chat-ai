import { NextResponse } from "next/server";
import { startTrpgCampaign } from "@/lib/trpg/engine";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";
import { parseTrpgStartFailureJson, sanitizeTrpgFailureHint } from "@/lib/trpg/startFailure";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  let id = 0;
  try {
    id = campaignIdFromParams((await ctx.params).id);
    const campaign = await startTrpgCampaign(gate.db, { campaignId: id, userId: gate.user.id });
    return NextResponse.json({ ok: true, campaign });
  } catch (e) {
    try {
      if (id <= 0) return trpgFail(e);
      const row = gate.db
        .prepare(`SELECT error_json FROM trpg_rounds WHERE campaign_id=? AND round_number=0`)
        .get(id) as { error_json: string | null } | undefined;
      const failure = parseTrpgStartFailureJson(row?.error_json);
      if (failure) {
        return NextResponse.json(
          { error: sanitizeTrpgFailureHint(failure), failureClass: failure.class },
          { status: failure.class === "B" ? 502 : 400 }
        );
      }
    } catch {
      /* fall through to generic fail */
    }
    return trpgFail(e);
  }
}
