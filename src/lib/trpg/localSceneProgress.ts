import { clipTrpgChars } from "./clip";

export const TRPG_LOCAL_SCENE_OBJECTIVE_MAX_CHARS = 120;
export const TRPG_LOCAL_SCENE_ITEM_MAX_CHARS = 80;
export const TRPG_LOCAL_SCENE_LIST_MAX = 8;

export const TRPG_LOCAL_SCENE_STATES = ["active", "transition_ready"] as const;
export type TrpgLocalSceneState = (typeof TRPG_LOCAL_SCENE_STATES)[number];

export type TrpgLocalSceneProgressV1 = {
  version: 1;
  objective: string;
  resolvedObstacles: string[];
  openRoutes: string[];
  remainingBlockers: string[];
  sceneState: TrpgLocalSceneState;
};

export type TrpgLocalSceneProgressDelta = {
  /** Refine current local objective without resetting collections. */
  objectiveSet?: string;
  /** Explicit new local dramatic situation — replaces objective and resets collections. */
  sceneTransitionTo?: string;
  resolvedObstaclesAdd?: string[];
  resolvedObstaclesRemove?: string[];
  openRoutesAdd?: string[];
  openRoutesRemove?: string[];
  remainingBlockersAdd?: string[];
  remainingBlockersRemove?: string[];
  sceneStateSet?: TrpgLocalSceneState;
};

function clipObjective(raw: string): string {
  return clipTrpgChars(raw, TRPG_LOCAL_SCENE_OBJECTIVE_MAX_CHARS);
}

function clipItem(raw: string): string {
  return clipTrpgChars(raw, TRPG_LOCAL_SCENE_ITEM_MAX_CHARS);
}

function mergeList(
  current: string[],
  add: string[] | undefined,
  remove: string[] | undefined,
  maxItems: number
): string[] {
  const drop = new Set((remove ?? []).map(clipItem).filter(Boolean));
  const next: string[] = [];
  const seen = new Set<string>();
  for (const item of [...current, ...(add ?? [])]) {
    const t = clipItem(item);
    if (!t || drop.has(t) || seen.has(t)) continue;
    seen.add(t);
    next.push(t);
    if (next.length >= maxItems) break;
  }
  return next;
}

function parseSceneState(raw: unknown): TrpgLocalSceneState | undefined {
  if (raw === "active" || raw === "transition_ready") return raw;
  return undefined;
}

function boundedStringList(raw: unknown, maxItems: number): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = clipItem(item);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out.length ? out : undefined;
}

export function emptyLocalSceneProgress(): TrpgLocalSceneProgressV1 {
  return {
    version: 1,
    objective: "",
    resolvedObstacles: [],
    openRoutes: [],
    remainingBlockers: [],
    sceneState: "active",
  };
}

export function parseLocalSceneProgress(raw: unknown): TrpgLocalSceneProgressV1 {
  const empty = emptyLocalSceneProgress();
  if (raw == null) return empty;
  if (typeof raw === "string") {
    try {
      return parseLocalSceneProgress(JSON.parse(raw));
    } catch {
      return empty;
    }
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return empty;
  const obj = raw as Record<string, unknown>;
  if (obj.version != null && Number(obj.version) !== 1) return empty;
  const sceneState = parseSceneState(obj.sceneState ?? obj.scene_state) ?? "active";
  return {
    version: 1,
    objective: clipObjective(String(obj.objective ?? "")),
    resolvedObstacles: mergeList([], boundedStringList(obj.resolvedObstacles ?? obj.resolved_obstacles, TRPG_LOCAL_SCENE_LIST_MAX), undefined, TRPG_LOCAL_SCENE_LIST_MAX),
    openRoutes: mergeList([], boundedStringList(obj.openRoutes ?? obj.open_routes, TRPG_LOCAL_SCENE_LIST_MAX), undefined, TRPG_LOCAL_SCENE_LIST_MAX),
    remainingBlockers: mergeList([], boundedStringList(obj.remainingBlockers ?? obj.remaining_blockers, TRPG_LOCAL_SCENE_LIST_MAX), undefined, TRPG_LOCAL_SCENE_LIST_MAX),
    sceneState,
  };
}

export function parseLocalSceneProgressDelta(raw: unknown): TrpgLocalSceneProgressDelta | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const delta: TrpgLocalSceneProgressDelta = {};
  if (typeof obj.objectiveSet === "string") delta.objectiveSet = obj.objectiveSet;
  else if (typeof obj.objective_set === "string") delta.objectiveSet = obj.objective_set;
  if (typeof obj.sceneTransitionTo === "string") delta.sceneTransitionTo = obj.sceneTransitionTo;
  else if (typeof obj.scene_transition_to === "string") delta.sceneTransitionTo = obj.scene_transition_to;
  const resolvedAdd =
    boundedStringList(obj.resolvedObstaclesAdd, TRPG_LOCAL_SCENE_LIST_MAX) ??
    boundedStringList(obj.resolved_obstacles_add, TRPG_LOCAL_SCENE_LIST_MAX);
  const resolvedRemove =
    boundedStringList(obj.resolvedObstaclesRemove, TRPG_LOCAL_SCENE_LIST_MAX) ??
    boundedStringList(obj.resolved_obstacles_remove, TRPG_LOCAL_SCENE_LIST_MAX);
  const routesAdd =
    boundedStringList(obj.openRoutesAdd, TRPG_LOCAL_SCENE_LIST_MAX) ??
    boundedStringList(obj.open_routes_add, TRPG_LOCAL_SCENE_LIST_MAX);
  const routesRemove =
    boundedStringList(obj.openRoutesRemove, TRPG_LOCAL_SCENE_LIST_MAX) ??
    boundedStringList(obj.open_routes_remove, TRPG_LOCAL_SCENE_LIST_MAX);
  const blockersAdd =
    boundedStringList(obj.remainingBlockersAdd, TRPG_LOCAL_SCENE_LIST_MAX) ??
    boundedStringList(obj.remaining_blockers_add, TRPG_LOCAL_SCENE_LIST_MAX);
  const blockersRemove =
    boundedStringList(obj.remainingBlockersRemove, TRPG_LOCAL_SCENE_LIST_MAX) ??
    boundedStringList(obj.remaining_blockers_remove, TRPG_LOCAL_SCENE_LIST_MAX);
  if (resolvedAdd) delta.resolvedObstaclesAdd = resolvedAdd;
  if (resolvedRemove) delta.resolvedObstaclesRemove = resolvedRemove;
  if (routesAdd) delta.openRoutesAdd = routesAdd;
  if (routesRemove) delta.openRoutesRemove = routesRemove;
  if (blockersAdd) delta.remainingBlockersAdd = blockersAdd;
  if (blockersRemove) delta.remainingBlockersRemove = blockersRemove;
  const sceneState = parseSceneState(obj.sceneStateSet ?? obj.scene_state_set);
  if (sceneState) delta.sceneStateSet = sceneState;
  return Object.keys(delta).length > 0 ? delta : undefined;
}

export function hasLocalSceneProgressDelta(delta: TrpgLocalSceneProgressDelta | undefined): boolean {
  return delta != null && Object.keys(delta).length > 0;
}

export function applyLocalSceneProgressDelta(
  current: TrpgLocalSceneProgressV1,
  delta: TrpgLocalSceneProgressDelta | undefined
): TrpgLocalSceneProgressV1 {
  if (!hasLocalSceneProgressDelta(delta)) return current;
  const d = delta!;
  let base: TrpgLocalSceneProgressV1;
  if (d.sceneTransitionTo != null) {
    const nextObjective = clipObjective(d.sceneTransitionTo);
    base = {
      ...emptyLocalSceneProgress(),
      objective: nextObjective,
      sceneState: d.sceneStateSet ?? "active",
    };
  } else {
    base = { ...current };
    if (d.objectiveSet != null) {
      const nextObjective = clipObjective(d.objectiveSet);
      if (nextObjective) base.objective = nextObjective;
    }
  }
  return {
    version: 1,
    objective: base.objective,
    resolvedObstacles: mergeList(
      base.resolvedObstacles,
      d.resolvedObstaclesAdd,
      d.resolvedObstaclesRemove,
      TRPG_LOCAL_SCENE_LIST_MAX
    ),
    openRoutes: mergeList(base.openRoutes, d.openRoutesAdd, d.openRoutesRemove, TRPG_LOCAL_SCENE_LIST_MAX),
    remainingBlockers: mergeList(
      base.remainingBlockers,
      d.remainingBlockersAdd,
      d.remainingBlockersRemove,
      TRPG_LOCAL_SCENE_LIST_MAX
    ),
    sceneState: d.sceneTransitionTo == null && d.sceneStateSet ? d.sceneStateSet : base.sceneState,
  };
}

export function hasLocalSceneProgressContent(progress: TrpgLocalSceneProgressV1): boolean {
  return (
    progress.objective.trim().length > 0 ||
    progress.resolvedObstacles.length > 0 ||
    progress.openRoutes.length > 0 ||
    progress.remainingBlockers.length > 0 ||
    progress.sceneState === "transition_ready"
  );
}

export function serializeLocalSceneStateForGm(progress: TrpgLocalSceneProgressV1): string {
  if (!hasLocalSceneProgressContent(progress)) return "";
  const lines = ["[LOCAL SCENE STATE]"];
  if (progress.objective) lines.push(`현재 목표:\n${progress.objective}`);
  if (progress.resolvedObstacles.length) {
    lines.push(`이미 해결됨:\n${progress.resolvedObstacles.map((item) => `- ${item}`).join("\n")}`);
  }
  if (progress.openRoutes.length) {
    lines.push(`열린 경로/기회:\n${progress.openRoutes.map((item) => `- ${item}`).join("\n")}`);
  }
  if (progress.remainingBlockers.length) {
    lines.push(`남은 장애:\n${progress.remainingBlockers.map((item) => `- ${item}`).join("\n")}`);
  }
  lines.push(`상태:\n${progress.sceneState}`);
  return lines.join("\n\n");
}

export function serializeLocalSceneDeltaContract(): string {
  return `[LOCAL SCENE DELTA CONTRACT]
Optional nested "localScene" in <<<DELTA>>> JSON. Omission is not deletion — persist prior routes/obstacles unless explicitly removed.
Fields: objectiveSet (refine objective only), sceneTransitionTo (new local scene — resets collections), resolvedObstaclesAdd/Remove, openRoutesAdd/Remove, remainingBlockersAdd/Remove, sceneStateSet ("active"|"transition_ready").
When removing an item, copy the exact label from [LOCAL SCENE STATE]; non-matching remove values are no-ops.
Record world/scene availability only — not unsubmitted PC decisions or movement.
Example:
{"players":[],"location":"","next_round_context":"","localScene":{"objectiveSet":"건물 탈출 경로 확보","openRoutesAdd":["우측 환풍구"],"remainingBlockersAdd":["환풍구 앞 기생종"],"sceneStateSet":"active"}}`;
}
