import { NextResponse } from "next/server";
import { loadWorldForTrpg } from "@/lib/trpg/catalog";
import { requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";
import {
  assertScenarioDraftRateLimit,
  buildScenarioDraftSystemPrompt,
  buildScenarioDraftUserPrompt,
  hashWorldSnapshot,
  makeDraftProvenance,
  mergeScenarioDraft,
  parseDraftFields,
  parseTrpgScenarioDraftMode,
  previewDraftOverwrite,
  releaseScenarioDraftRateLimit,
  type TrpgScenarioDraftExisting,
} from "@/lib/trpg/scenarioDraft";
import { completeTrpgAuthoringJson } from "@/lib/trpg/scenarioDraftCall";
import { lintTrpgScenarioPlan, parseTrpgScenarioPlan, scoreTrpgScenarioReadiness } from "@/lib/trpg/scenarioPlan";
import { parseInventory, parseScenarioNpcs } from "@/lib/trpg/scenarioTypes";

export async function POST(req: Request) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  let locked = false;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const worldId = Number(body.worldId);
    if (!Number.isInteger(worldId) || worldId <= 0) {
      return NextResponse.json({ error: "세계관을 선택한 뒤 AI 초안을 만들 수 있습니다." }, { status: 400 });
    }
    const world = loadWorldForTrpg(gate.db, worldId);
    if (!world || world.creator_id !== gate.user.id) {
      return NextResponse.json({ error: "이 세계관으로 시나리오 초안을 만들 수 없습니다." }, { status: 403 });
    }
    const mode = parseTrpgScenarioDraftMode(body.mode);
    const selectedFields = parseDraftFields(body.selectedFields);
    const lockedFields = parseDraftFields(body.lockedFields);
    const existingDraft = (body.existingDraft && typeof body.existingDraft === "object"
      ? body.existingDraft
      : {}) as Record<string, unknown>;
    const existing: TrpgScenarioDraftExisting = {
      title: String(existingDraft.title ?? ""),
      summary: String(existingDraft.summary ?? ""),
      startLocation: String(existingDraft.startLocation ?? ""),
      startInventory: parseInventory(existingDraft.startInventory),
      npcs: parseScenarioNpcs(existingDraft.npcs),
      plan: parseTrpgScenarioPlan(existingDraft.plan ?? existingDraft),
    };
    if (mode === "regenerate_selected" && selectedFields.length === 0) {
      return NextResponse.json({ error: "다시 만들 항목을 선택해 주세요." }, { status: 400 });
    }
    assertScenarioDraftRateLimit(gate.user.id);
    locked = true;
    const extra = gate.db
      .prepare(`SELECT name, COALESCE(updated_at, '') AS updated_at FROM worlds WHERE id=?`)
      .get(worldId) as { name?: string; updated_at?: string } | undefined;
    const worldName = extra?.name ?? "";
    const worldUpdatedAt = extra?.updated_at ?? "";
    const worldHash = hashWorldSnapshot({
      name: worldName,
      summary: world.summary,
      content: world.content,
      updatedAt: worldUpdatedAt,
    });
    const generated = await completeTrpgAuthoringJson({
      kind: "scenario_draft",
      system: buildScenarioDraftSystemPrompt(),
      user: buildScenarioDraftUserPrompt({
        worldName,
        worldSummary: world.summary,
        worldContent: world.content,
        mode,
        existing,
        selectedFields,
        lockedFields,
      }),
    });
    const merged = mergeScenarioDraft({
      mode,
      existing,
      generated,
      selectedFields,
      lockedFields,
      provenance: makeDraftProvenance({
        worldId,
        worldUpdatedAt,
        worldHash,
      }),
    });
    const issues = lintTrpgScenarioPlan({
      plan: merged.plan,
      title: merged.title,
      summary: merged.summary,
      npcs: merged.npcs,
      startInventory: merged.startInventory,
    });
    releaseScenarioDraftRateLimit(gate.user.id, false);
    return NextResponse.json({
      ok: true,
      saved: false,
      model: merged.plan.provenance?.generatorModel,
      changedFields: previewDraftOverwrite({ mode, existing, selectedFields, lockedFields }),
      draft: merged,
      lint: issues,
      readiness: scoreTrpgScenarioReadiness(issues, merged.plan),
    });
  } catch (e) {
    if (locked) releaseScenarioDraftRateLimit(gate.user.id, true);
    return trpgFail(e);
  }
}
