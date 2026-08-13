import { NextResponse } from "next/server";
import { joinTrpgCampaign, loadTrpgSnapshot } from "@/lib/trpg/engine";
import { requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";
import { assertNoTrpgForkRequest } from "@/lib/trpg/timeline";

export async function POST(req: Request) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    assertNoTrpgForkRequest(body);
    const campaignId = joinTrpgCampaign(gate.db, {
      code: String(body.code ?? ""),
      userId: gate.user.id,
      nickname: gate.user.nickname,
    });
    const campaign = loadTrpgSnapshot(gate.db, campaignId, gate.user.id);
    return NextResponse.json({ ok: true, campaignId, campaign });
  } catch (e) {
    return trpgFail(e);
  }
}
