import { NextResponse } from "next/server";
import {
  canAccessTrpgScenarioTemplate,
  deleteScenarioTemplate,
  loadScenarioTemplate,
  rowToScenarioTemplate,
  updateScenarioTemplate,
} from "@/lib/trpg/scenarioTemplates";
import { requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";

type RouteCtx = { params: Promise<{ id: string }> };

function scenarioId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Error("잘못된 시나리오입니다.");
  return id;
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = scenarioId((await ctx.params).id);
    const row = loadScenarioTemplate(gate.db, id);
    if (!row || !canAccessTrpgScenarioTemplate(row, gate.user.id)) {
      return NextResponse.json({ error: "시나리오를 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json({
      scenario: rowToScenarioTemplate(row, { includeSecret: row.creator_id === gate.user.id }),
    });
  } catch (e) {
    return trpgFail(e);
  }
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = scenarioId((await ctx.params).id);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    updateScenarioTemplate(gate.db, id, gate.user.id, {
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
      assets: body.assets,
      scenarioPlan: body.scenarioPlan,
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

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = scenarioId((await ctx.params).id);
    deleteScenarioTemplate(gate.db, id, gate.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return trpgFail(e);
  }
}
