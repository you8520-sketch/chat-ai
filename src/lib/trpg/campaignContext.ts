import type Database from "better-sqlite3";
import { parseJson } from "./store";
import {
  applyStoryPhaseTransition,
  parseTrpgScenarioPlan,
  parseTrpgStoryPhase,
  type TrpgScenarioPlan,
  type TrpgStoryPhase,
} from "./scenarioPlan";
import { clipTrpgChars } from "./clip";

export const TRPG_CAMPAIGN_SOURCE_MODES = ["none", "sandbox", "scenario"] as const;
export type TrpgCampaignSourceMode = (typeof TRPG_CAMPAIGN_SOURCE_MODES)[number];

export type TrpgWorldSnapshot = {
  id: number | null;
  name: string;
  summary: string;
  content: string;
  updatedAt: string;
  hash: string;
};

export type TrpgScenarioSnapshot = {
  id: number | null;
  title: string;
  summary: string;
  content: string;
  secretContent: string;
  startLocation: string;
  startInventory: string[];
  plan: TrpgScenarioPlan | null;
  updatedAt: string;
};

export type TrpgEndingStatus = {
  finished: boolean;
  endingConditionId?: string;
  endingConditionText?: string;
};

export type TrpgCampaignContext = {
  campaignId: number;
  sourceMode: TrpgCampaignSourceMode;
  worldSnapshot: TrpgWorldSnapshot | null;
  scenarioSnapshot: TrpgScenarioSnapshot | null;
  directorPlan: TrpgScenarioPlan | null;
  storyPhase: TrpgStoryPhase;
  activeThreads: string[];
  resolvedThreads: string[];
  endingStatus: TrpgEndingStatus;
  directorError: string;
};

function parseMode(value: unknown): TrpgCampaignSourceMode {
  return (TRPG_CAMPAIGN_SOURCE_MODES as readonly string[]).includes(String(value))
    ? (value as TrpgCampaignSourceMode)
    : "none";
}

function parseThreads(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const text = clipTrpgChars(String(item ?? ""), 80);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= 12) break;
  }
  return out;
}

export function emptyCampaignContext(campaignId: number): TrpgCampaignContext {
  return {
    campaignId,
    sourceMode: "none",
    worldSnapshot: null,
    scenarioSnapshot: null,
    directorPlan: null,
    storyPhase: "INTRO",
    activeThreads: [],
    resolvedThreads: [],
    endingStatus: { finished: false },
    directorError: "",
  };
}

export function loadCampaignContext(db: Database.Database, campaignId: number): TrpgCampaignContext | null {
  const table = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='trpg_campaign_context'`)
    .get() as { ok: number } | undefined;
  if (!table) return null;
  const row = db
    .prepare(
      `SELECT campaign_id, source_mode, world_snapshot_json, scenario_snapshot_json, director_plan_json,
              story_phase, active_threads_json, resolved_threads_json, ending_status_json, director_error
       FROM trpg_campaign_context WHERE campaign_id=?`
    )
    .get(campaignId) as
    | {
        campaign_id: number;
        source_mode: string;
        world_snapshot_json: string | null;
        scenario_snapshot_json: string | null;
        director_plan_json: string | null;
        story_phase: string;
        active_threads_json: string;
        resolved_threads_json: string;
        ending_status_json: string;
        director_error: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    campaignId: row.campaign_id,
    sourceMode: parseMode(row.source_mode),
    worldSnapshot: parseJson(row.world_snapshot_json, null as TrpgWorldSnapshot | null),
    scenarioSnapshot: parseJson(row.scenario_snapshot_json, null as TrpgScenarioSnapshot | null),
    directorPlan: parseTrpgScenarioPlan(row.director_plan_json),
    storyPhase: parseTrpgStoryPhase(row.story_phase),
    activeThreads: parseThreads(parseJson(row.active_threads_json, [] as string[])),
    resolvedThreads: parseThreads(parseJson(row.resolved_threads_json, [] as string[])),
    endingStatus: parseJson(row.ending_status_json, { finished: false } as TrpgEndingStatus),
    directorError: row.director_error ?? "",
  };
}

export function persistCampaignContext(db: Database.Database, ctx: TrpgCampaignContext): void {
  db.prepare(
    `INSERT INTO trpg_campaign_context (
        campaign_id, source_mode, world_snapshot_json, scenario_snapshot_json, director_plan_json,
        story_phase, active_threads_json, resolved_threads_json, ending_status_json, director_error, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(campaign_id) DO UPDATE SET
        source_mode=excluded.source_mode,
        world_snapshot_json=excluded.world_snapshot_json,
        scenario_snapshot_json=excluded.scenario_snapshot_json,
        director_plan_json=excluded.director_plan_json,
        story_phase=excluded.story_phase,
        active_threads_json=excluded.active_threads_json,
        resolved_threads_json=excluded.resolved_threads_json,
        ending_status_json=excluded.ending_status_json,
        director_error=excluded.director_error,
        updated_at=datetime('now')`
  ).run(
    ctx.campaignId,
    ctx.sourceMode,
    ctx.worldSnapshot ? JSON.stringify(ctx.worldSnapshot) : null,
    ctx.scenarioSnapshot ? JSON.stringify(ctx.scenarioSnapshot) : null,
    ctx.directorPlan ? JSON.stringify(ctx.directorPlan) : null,
    ctx.storyPhase,
    JSON.stringify(ctx.activeThreads),
    JSON.stringify(ctx.resolvedThreads),
    JSON.stringify(ctx.endingStatus),
    ctx.directorError
  );
}

export function resolvedCampaignPlan(ctx: TrpgCampaignContext | null): TrpgScenarioPlan | null {
  if (!ctx) return null;
  return ctx.directorPlan ?? ctx.scenarioSnapshot?.plan ?? null;
}

export function applyCampaignStoryProgress(
  ctx: TrpgCampaignContext,
  opts: {
    storyPhase?: unknown;
    threadsAdd?: string[];
    threadsResolve?: string[];
    endingConditionId?: string;
    campaignFinished?: boolean;
  }
): TrpgCampaignContext {
  const nextPhase = applyStoryPhaseTransition(ctx.storyPhase, opts.storyPhase, {
    campaignFinished: opts.campaignFinished === true,
    forcedEnd: opts.campaignFinished === true,
  });
  const resolve = new Set((opts.threadsResolve ?? []).map((item) => clipTrpgChars(item, 80)).filter(Boolean));
  const active = parseThreads([
    ...ctx.activeThreads.filter((item) => !resolve.has(item)),
    ...(opts.threadsAdd ?? []),
  ]);
  const resolved = parseThreads([...ctx.resolvedThreads, ...resolve]);
  const endingStatus: TrpgEndingStatus = {
    finished: opts.campaignFinished === true || ctx.endingStatus.finished || nextPhase === "FINISHED",
    endingConditionId: opts.endingConditionId || ctx.endingStatus.endingConditionId,
    endingConditionText: ctx.endingStatus.endingConditionText,
  };
  if (opts.endingConditionId && ctx.directorPlan?.endingConditions.length) {
    const indexed = Number(opts.endingConditionId);
    if (Number.isInteger(indexed) && ctx.directorPlan.endingConditions[indexed]) {
      endingStatus.endingConditionText = ctx.directorPlan.endingConditions[indexed];
    } else {
      const match = ctx.directorPlan.endingConditions.find((item) => item === opts.endingConditionId);
      if (match) endingStatus.endingConditionText = match;
    }
  }
  return {
    ...ctx,
    storyPhase: endingStatus.finished && nextPhase !== "FINISHED" && nextPhase !== "EPILOGUE" ? "FINISHED" : nextPhase,
    activeThreads: active,
    resolvedThreads: resolved,
    endingStatus,
  };
}

export function serializeCampaignDirectorState(ctx: TrpgCampaignContext | null): string {
  if (!ctx) return "";
  const lines = [
    `이야기 단계: ${ctx.storyPhase}`,
    ctx.activeThreads.length ? `진행 중 실마리:\n${ctx.activeThreads.map((item) => `- ${item}`).join("\n")}` : "",
    ctx.resolvedThreads.length ? `회수된 실마리:\n${ctx.resolvedThreads.map((item) => `- ${item}`).join("\n")}` : "",
    ctx.endingStatus.endingConditionText ? `충족된 종료 조건: ${ctx.endingStatus.endingConditionText}` : "",
  ].filter(Boolean);
  if (lines.length === 0) return "";
  return `[CAMPAIGN DIRECTOR STATE]\n${lines.join("\n\n")}`;
}

export function serializeCampaignDirectorInstructions(hasPlan: boolean): string {
  if (!hasPlan) return "";
  return `[STORY DIRECTION — GM only]
- Prefer unresolved conflicts and recover dangling threads. Do not keep adding new main villains.
- Major events are possibilities, not a railroad.
- Do not decide player or AI-player feelings or future actions.
- In CLIMAX, do not suddenly add a new world-scale crisis.
- If the core conflict is resolved, allow EPILOGUE. In EPILOGUE do not start a new long plot.
- campaign_finished may be true only when an ending condition is actually met by play, or an existing forced end applies.
- Optional DELTA keys: storyPhase, threadsAdd, threadsResolve, endingConditionId. Never skip INTRO to FINISHED in one hop unless the campaign is actually ending.`;
}
