import type Database from "better-sqlite3";
import { canUseWorldForTrpg, loadWorldForTrpg } from "./catalog";
import {
  emptyCampaignContext,
  loadCampaignContext,
  persistCampaignContext,
  type TrpgCampaignContext,
  type TrpgScenarioSnapshot,
  type TrpgWorldSnapshot,
} from "./campaignContext";
import { hashWorldSnapshot, makeDraftProvenance } from "./scenarioDraft";
import {
  buildSandboxDirectorSystemPrompt,
  buildSandboxDirectorUserPrompt,
} from "./scenarioDraft";
import { completeTrpgAuthoringJson, type TrpgAuthoringComplete } from "./scenarioDraftCall";
import { evaluateSandboxBlueprint, parseTrpgScenarioPlan } from "./scenarioPlan";
import { loadScenarioTemplate, rowToScenarioTemplate } from "./scenarioTemplates";
import { loadCampaign } from "./store";

export type TrpgDirectorDeps = {
  directorCall?: TrpgAuthoringComplete;
};

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { ok: number } | undefined;
  return Boolean(row);
}

function loadWorldSnapshot(db: Database.Database, worldId: number | null): TrpgWorldSnapshot | null {
  if (!worldId || !tableExists(db, "worlds")) return null;
  const world = loadWorldForTrpg(db, worldId);
  if (!world) return null;
  const extra = db
    .prepare(`SELECT name, COALESCE(updated_at, '') AS updated_at FROM worlds WHERE id=?`)
    .get(worldId) as { name?: string; updated_at?: string } | undefined;
  const name = extra?.name ?? "";
  const updatedAt = extra?.updated_at ?? "";
  return {
    id: world.id,
    name,
    summary: world.summary,
    content: world.content,
    updatedAt,
    hash: hashWorldSnapshot({
      name,
      summary: world.summary,
      content: world.content,
      updatedAt,
    }),
  };
}

function loadScenarioSnapshot(db: Database.Database, templateId: number | null): TrpgScenarioSnapshot | null {
  if (!templateId) return null;
  const row = loadScenarioTemplate(db, templateId);
  if (!row) return null;
  const template = rowToScenarioTemplate(row, { includeSecret: true });
  return {
    id: template.id,
    title: template.title,
    summary: template.summary,
    content: template.content,
    secretContent: template.secretContent,
    startLocation: template.startLocation,
    startInventory: template.startInventory,
    plan: template.scenarioPlan,
    updatedAt: template.updatedAt,
  };
}

/**
 * One-shot campaign context. Never called per round.
 * Scenario campaigns copy the authored plan. World-only sandbox may generate a blueprint once.
 * Failure never blocks campaign start.
 */
export async function ensureCampaignDirectorContext(
  db: Database.Database,
  campaignId: number,
  deps?: TrpgDirectorDeps
): Promise<TrpgCampaignContext> {
  const existing = loadCampaignContext(db, campaignId);
  if (existing) return existing;

  const campaign = loadCampaign(db, campaignId);
  const ctx = emptyCampaignContext(campaignId);
  if (!campaign) {
    persistCampaignContext(db, ctx);
    return ctx;
  }

  ctx.worldSnapshot = loadWorldSnapshot(db, campaign.source_world_id);
  ctx.scenarioSnapshot = loadScenarioSnapshot(db, campaign.template_id);
  if (campaign.template_id) {
    ctx.sourceMode = "scenario";
    ctx.directorPlan = ctx.scenarioSnapshot?.plan ?? null;
    persistCampaignContext(db, ctx);
    return ctx;
  }
  if (!campaign.source_world_id || !ctx.worldSnapshot) {
    ctx.sourceMode = "none";
    persistCampaignContext(db, ctx);
    return ctx;
  }

  ctx.sourceMode = "sandbox";
  try {
    const generated = await completeTrpgAuthoringJson({
      kind: "sandbox_blueprint",
      system: buildSandboxDirectorSystemPrompt(),
      user: buildSandboxDirectorUserPrompt({
        worldName: ctx.worldSnapshot.name,
        worldSummary: ctx.worldSnapshot.summary,
        worldContent: ctx.worldSnapshot.content,
      }),
      complete: deps?.directorCall,
    });
    const plan = parseTrpgScenarioPlan(generated.plan) ?? generated.plan;
    const accepted = evaluateSandboxBlueprint(plan);
    if (!accepted.ok) {
      ctx.directorPlan = null;
      ctx.directorError = accepted.error;
    } else {
      plan.provenance = makeDraftProvenance({
        worldId: ctx.worldSnapshot.id,
        worldUpdatedAt: ctx.worldSnapshot.updatedAt,
        worldHash: ctx.worldSnapshot.hash,
      });
      ctx.directorPlan = plan;
    }
  } catch (error) {
    ctx.directorError = error instanceof Error ? error.message : "sandbox director failed";
    ctx.directorPlan = null;
  }
  persistCampaignContext(db, ctx);
  return ctx;
}

export function canAuthorUseWorld(
  world: { creator_id: number; trpg_enabled?: number | null; trpg_visibility?: string | null },
  userId: number
): boolean {
  return canUseWorldForTrpg(world, userId);
}
