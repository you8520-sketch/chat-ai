import { NextResponse } from "next/server";
import {
  createTrpgCampaign,
  listTrpgCampaigns,
} from "@/lib/trpg/engine";
import { requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";
import { assertNoTrpgForkRequest } from "@/lib/trpg/timeline";

export async function GET() {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    return NextResponse.json({ campaigns: listTrpgCampaigns(gate.db, gate.user.id) });
  } catch (e) {
    return trpgFail(e);
  }
}

export async function POST(req: Request) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    assertNoTrpgForkRequest(body);
    const characterIdRaw = Number(body.characterId);
    const characterId = Number.isInteger(characterIdRaw) && characterIdRaw > 0 ? characterIdRaw : null;
    const campaignId = createTrpgCampaign(gate.db, {
      hostUserId: gate.user.id,
      hostNickname: gate.user.nickname,
      characterId,
      viewerUserId: gate.user.id,
    });
    return NextResponse.json({ ok: true, campaignId });
  } catch (e) {
    return trpgFail(e);
  }
}
