import type Database from "better-sqlite3";
import { canUseWorldForTrpg } from "./catalog";
import {
  emptyCampaignContext,
  loadCampaignContext,
  persistCampaignContext,
  type TrpgCampaignContext,
  type TrpgScenarioSnapshot,
} from "./campaignContext";
import { loadScenarioTemplate, rowToScenarioTemplate } from "./scenarioTemplates";
import { loadCampaign } from "./store";
import {
  copyWorldBlueprintPlan,
  loadValidWorldBlueprintPlan,
  loadWorldSnapshotForBlueprint,
} from "./worldBlueprintArtifact";
import { generateWorldSandboxBlueprint } from "./worldBlueprintGeneration";
import type { TrpgAuthoringComplete } from "./scenarioDraftCall";

export type TrpgDirectorDeps = {
  directorCall?: TrpgAuthoringComplete;
};

export const TRPG_SANDBOX_DIRECTOR_ENABLED_ENV = "TRPG_SANDBOX_DIRECTOR_ENABLED";

/** World-only Blueprint only. Default off. Scenario campaigns and Scenario Draft ignore this. */
export function isTrpgSandboxDirectorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[TRPG_SANDBOX_DIRECTOR_ENABLED_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
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
 * Scenario campaigns copy the authored plan. World-only sandbox may copy a pre-generated
 * world-revision Blueprint or fall back to synchronous generation when none is valid.
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

  ctx.worldSnapshot = loadWorldSnapshotForBlueprint(db, campaign.source_world_id);
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
  if (!isTrpgSandboxDirectorEnabled()) {
    ctx.directorPlan = null;
    persistCampaignContext(db, ctx);
    return ctx;
  }

  const artifactPlan = loadValidWorldBlueprintPlan(db, campaign.source_world_id, ctx.worldSnapshot);
  if (artifactPlan) {
    ctx.directorPlan = copyWorldBlueprintPlan(artifactPlan);
    persistCampaignContext(db, ctx);
    return ctx;
  }

  const generated = await generateWorldSandboxBlueprint(
    {
      worldId: ctx.worldSnapshot.id ?? campaign.source_world_id,
      worldName: ctx.worldSnapshot.name,
      worldSummary: ctx.worldSnapshot.summary,
      worldContent: ctx.worldSnapshot.content,
      worldUpdatedAt: ctx.worldSnapshot.updatedAt,
      worldHash: ctx.worldSnapshot.sourceFingerprint,
    },
    { complete: deps?.directorCall }
  );
  if (!generated.ok) {
    ctx.directorError = generated.error;
    ctx.directorPlan = null;
  } else {
    ctx.directorPlan = generated.plan;
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
