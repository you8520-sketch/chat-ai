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
  scenarioDraftOutputMaxTokens,
  scenarioDraftPrimaryTimeoutMs,
  TRPG_SCENARIO_DRAFT_REPAIR_OUTPUT_TOKENS,
  TRPG_SCENARIO_DRAFT_REPAIR_TIMEOUT_MS,
  type TrpgScenarioDraftExisting,
} from "@/lib/trpg/scenarioDraft";
import {
  completeTrpgAuthoringJson,
  isTrpgAuthoringTimeoutError,
  TrpgAuthoringTruncatedError,
  TRPG_SCENARIO_DRAFT_TIMEOUT_MESSAGE,
  TRPG_SCENARIO_DRAFT_TRUNCATED_MESSAGE,
} from "@/lib/trpg/scenarioDraftCall";
import { lintTrpgScenarioPlan, parseTrpgScenarioPlan, scoreTrpgScenarioReadiness } from "@/lib/trpg/scenarioPlan";
import { parseInventory, parseScenarioNpcs } from "@/lib/trpg/scenarioTypes";

export async function POST(req: Request) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  let locked = false;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawWorldId = body.worldId;
    const worldId = rawWorldId == null || rawWorldId === "" ? null : Number(rawWorldId);
    if (worldId != null && (!Number.isInteger(worldId) || worldId <= 0)) {
      return NextResponse.json({ error: "선택한 세계관을 확인해 주세요." }, { status: 400 });
    }
    const world = worldId == null ? null : loadWorldForTrpg(gate.db, worldId);
    if (worldId != null && (!world || world.creator_id !== gate.user.id)) {
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
      content: String(existingDraft.content ?? ""),
      secretContent: String(existingDraft.secretContent ?? ""),
      startLocation: String(existingDraft.startLocation ?? ""),
      startInventory: parseInventory(existingDraft.startInventory),
      npcs: parseScenarioNpcs(existingDraft.npcs),
      plan: parseTrpgScenarioPlan(existingDraft.plan ?? existingDraft),
      touchedFields: parseDraftFields(existingDraft.touchedFields ?? body.touchedFields),
    };
    if (mode === "regenerate_selected" && selectedFields.length === 0) {
      return NextResponse.json({ error: "다시 만들 항목을 선택해 주세요." }, { status: 400 });
    }
    assertScenarioDraftRateLimit(gate.user.id);
    locked = true;
    const extra =
      worldId == null
        ? undefined
        : (gate.db
            .prepare(`SELECT name, COALESCE(updated_at, '') AS updated_at FROM worlds WHERE id=?`)
            .get(worldId) as { name?: string; updated_at?: string } | undefined);
    const worldName = extra?.name ?? "";
    const worldUpdatedAt = extra?.updated_at ?? "";
    const worldSummary = world?.summary ?? "";
    const worldContent = world?.content ?? "";
    const worldHash =
      worldId == null
        ? ""
        : hashWorldSnapshot({
            name: worldName,
            summary: worldSummary,
            content: worldContent,
            updatedAt: worldUpdatedAt,
          });
    const changingFields = previewDraftOverwrite({ mode, existing, selectedFields, lockedFields });
    const primaryMaxTokens = scenarioDraftOutputMaxTokens({ mode, changingFields });
    const primaryTimeoutMs = scenarioDraftPrimaryTimeoutMs({ mode, changingFields });
    const userPrompt = buildScenarioDraftUserPrompt({
      worldName,
      worldSummary,
      worldContent,
      worldSelected: worldId != null,
      mode,
      existing,
      selectedFields,
      lockedFields,
    });
    console.info("[trpg-scenario-draft]", {
      STAGE: "primary",
      WORLD_SELECTED: worldId != null,
      WORLD_SUMMARY_CHARS: worldSummary.length,
      WORLD_CONTENT_CHARS: worldContent.length,
      EXISTING_TITLE_CHARS: existing.title?.length ?? 0,
      EXISTING_SUMMARY_CHARS: existing.summary?.length ?? 0,
      EXISTING_CONTENT_CHARS: existing.content?.length ?? 0,
      EXISTING_SECRET_CONTENT_CHARS: existing.secretContent?.length ?? 0,
      PROMPT_CHARS: buildScenarioDraftSystemPrompt().length + userPrompt.length,
      MAX_TOKENS: primaryMaxTokens,
      TIMEOUT_MS: primaryTimeoutMs,
    });
    const generated = await completeTrpgAuthoringJson({
      kind: "scenario_draft",
      system: buildScenarioDraftSystemPrompt(),
      user: userPrompt,
      expectedFields: changingFields,
      primaryMaxTokens,
      primaryTimeoutMs,
      repairMaxTokens: Math.min(primaryMaxTokens, TRPG_SCENARIO_DRAFT_REPAIR_OUTPUT_TOKENS),
      repairTimeoutMs: TRPG_SCENARIO_DRAFT_REPAIR_TIMEOUT_MS,
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
    if (isTrpgAuthoringTimeoutError(e)) {
      return NextResponse.json(
        { error: TRPG_SCENARIO_DRAFT_TIMEOUT_MESSAGE, code: "SCENARIO_DRAFT_TIMEOUT" },
        { status: 504 }
      );
    }
    if (e instanceof TrpgAuthoringTruncatedError) {
      return NextResponse.json(
        { error: TRPG_SCENARIO_DRAFT_TRUNCATED_MESSAGE, code: "SCENARIO_DRAFT_TRUNCATED" },
        { status: 422 }
      );
    }
    return trpgFail(e);
  }
}
