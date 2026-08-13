import { NextResponse } from "next/server";
import { loadTrpgSnapshot, saveTrpgSheet } from "@/lib/trpg/engine";
import { resolveTrpgHumanPersona } from "@/lib/trpg/hostPersona";
import { parseOptionalId } from "@/lib/trpg/requestIds";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const body = (await req.json()) as {
      name?: unknown;
      stats?: unknown;
      participantId?: unknown;
      personaId?: unknown;
    };
    const statsRaw = body.stats && typeof body.stats === "object" && !Array.isArray(body.stats) ? body.stats : {};
    const stats: Record<string, number> = {};
    for (const [key, value] of Object.entries(statsRaw as Record<string, unknown>)) {
      stats[key] = Number(value);
    }
    const participantIdRaw = Number(body.participantId);
    const personaId = parseOptionalId(body.personaId);
    const persona = personaId
      ? resolveTrpgHumanPersona(gate.user.id, gate.user.nickname, personaId)
      : null;
    saveTrpgSheet(gate.db, {
      campaignId: id,
      userId: gate.user.id,
      name: persona?.name ?? String(body.name ?? ""),
      stats,
      participantId: Number.isInteger(participantIdRaw) && participantIdRaw > 0 ? participantIdRaw : null,
      persona,
    });
    const campaign = loadTrpgSnapshot(gate.db, id, gate.user.id);
    return NextResponse.json({ ok: true, campaign });
  } catch (e) {
    return trpgFail(e);
  }
}
