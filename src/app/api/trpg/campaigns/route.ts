import { NextResponse } from "next/server";
import {
  createTrpgCampaign,
  listTrpgCampaigns,
} from "@/lib/trpg/engine";
import { resolveTrpgHumanPersona } from "@/lib/trpg/hostPersona";
import { parseCompanionIds, parseOptionalId } from "@/lib/trpg/requestIds";
import { requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";
import { assertNoTrpgForkRequest } from "@/lib/trpg/timeline";
import { parseTrpgBillingMode } from "@/lib/trpg/types";

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
    const characterIds = parseCompanionIds(body.characterIds, body.characterId);
    const worldId = parseOptionalId(body.worldId);
    const templateId = parseOptionalId(body.templateId);
    const personaId = parseOptionalId(body.personaId);
    const title = typeof body.title === "string" ? body.title : null;
    const billingMode = parseTrpgBillingMode(body.billingMode);
    const hostPersona = resolveTrpgHumanPersona(gate.user.id, gate.user.nickname, personaId);
    const campaignId = createTrpgCampaign(gate.db, {
      hostUserId: gate.user.id,
      hostNickname: gate.user.nickname,
      hostPersona,
      characterIds,
      worldId,
      templateId,
      title,
      viewerUserId: gate.user.id,
      ...(billingMode ? { billingMode } : {}),
    });
    return NextResponse.json({ ok: true, campaignId });
  } catch (e) {
    return trpgFail(e);
  }
}
