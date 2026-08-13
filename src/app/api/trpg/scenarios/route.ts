import { NextResponse } from "next/server";
import {
  insertScenarioTemplate,
  listMyScenarioTemplates,
  listPublicScenarioTemplates,
  loadScenarioTemplate,
  rowToScenarioTemplate,
} from "@/lib/trpg/scenarioTemplates";
import { requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

export async function GET() {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    return NextResponse.json({
      mine: listMyScenarioTemplates(gate.db, gate.user.id),
      public: listPublicScenarioTemplates(gate.db),
    });
  } catch (e) {
    return trpgFail(e);
  }
}

export async function POST(req: Request) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = insertScenarioTemplate(gate.db, gate.user.id, {
      title: String(body.title ?? ""),
      summary: String(body.summary ?? ""),
      content: String(body.content ?? ""),
      secretContent: String(body.secretContent ?? ""),
      worldId: body.worldId as number | null,
      visibility: body.visibility,
      startLocation: String(body.startLocation ?? ""),
      startInventory: Array.isArray(body.startInventory) ? body.startInventory.map(String) : [],
      defaultPcStats: (body.defaultPcStats as Record<string, number> | null) ?? null,
      statKeys: body.statKeys,
      npcs: body.npcs,
      characterIds: body.characterIds,
      genres: body.genres,
    });
    const row = loadScenarioTemplate(gate.db, id);
    return NextResponse.json({
      ok: true,
      scenario: row ? rowToScenarioTemplate(row, { includeSecret: true }) : null,
    });
  } catch (e) {
    return trpgFail(e);
  }
}
