import { hasPlayableScenarioPlan, lintTrpgScenarioPlan, type TrpgScenarioPlan } from "./scenarioPlan";
import {
  TRPG_SCENARIO_BUNDLE_LIMIT,
  TRPG_SCENARIO_MAX_NPCS,
  scenarioBundleLimitError,
} from "./scenarioTypes";
import { SCENARIO_PUBLIC_INTRO_REQUIRED, validateScenarioPublicationTransition } from "./trpgPublication";
import type { TrpgVisibility } from "./types";

export type ScenarioReadinessStatus = "playable" | "recommended" | "blocked";

export type ScenarioReadinessField =
  | "title"
  | "summary"
  | "startingSituation"
  | "centralConflict"
  | "goal"
  | "endingConditions"
  | "content"
  | "bundle"
  | "npcs"
  | "advanced";

export type ScenarioReadinessItem = {
  id: string;
  message: string;
  field: ScenarioReadinessField;
  section: "story" | "details";
};

export type ScenarioReadinessInput = {
  title: string;
  content: string;
  summary?: string;
  visibility?: TrpgVisibility;
  /** Saved visibility before unsaved edits; defaults to private for new scenarios. */
  previousVisibility?: TrpgVisibility;
  scenarioPlan: TrpgScenarioPlan | null | undefined;
  npcs?: unknown;
  startInventory?: unknown;
  bundleChars?: number;
  bundleLimit?: number;
};

export type ScenarioReadiness = {
  status: ScenarioReadinessStatus;
  blockers: ScenarioReadinessItem[];
  recommendations: ScenarioReadinessItem[];
  canSave: boolean;
  canPlay: boolean;
};

/** First-create writing decisions for the simplified basic authoring UI. */
export const FIRST_CREATE_VISIBLE_FIELDS = ["title", "startingSituation", "goal"] as const;

export function namedNpcCount(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return raw.filter(
    (item) => item && typeof item === "object" && String((item as { name?: unknown }).name ?? "").trim()
  ).length;
}

function firstMissingPlanField(plan: TrpgScenarioPlan | null | undefined): ScenarioReadinessField {
  if (!plan || !plan.startingSituation.trim()) return "startingSituation";
  if (!plan.goal.trim()) return "goal";
  return "startingSituation";
}

function fieldForLintCode(code: string): ScenarioReadinessField {
  switch (code) {
    case "missing_start":
      return "startingSituation";
    case "missing_conflict":
      return "centralConflict";
    case "missing_goal":
      return "goal";
    case "missing_endings":
    case "no_ending_conditions":
      return "endingConditions";
    case "missing_plan_or_content":
      return "startingSituation";
    case "npc_limit":
      return "npcs";
    case "bundle_limit":
      return "bundle";
    default:
      return "advanced";
  }
}

function sectionForField(field: ScenarioReadinessField): ScenarioReadinessItem["section"] {
  switch (field) {
    case "title":
    case "summary":
    case "startingSituation":
    case "centralConflict":
    case "goal":
    case "endingConditions":
      return "story";
    default:
      return "details";
  }
}

/**
 * Editor / save / play readiness from the same save-gate predicates.
 * BLOCKED = normalizeScenarioTemplateInput + bundle limit would reject.
 * RECOMMENDED = lint quality only; never blocks play.
 */
export function evaluateScenarioReadiness(input: ScenarioReadinessInput): ScenarioReadiness {
  const title = String(input.title ?? "").trim();
  const content = String(input.content ?? "").trim();
  const plan = input.scenarioPlan ?? null;
  const bundleLimit = input.bundleLimit ?? TRPG_SCENARIO_BUNDLE_LIMIT;
  const blockers: ScenarioReadinessItem[] = [];

  if (!title) {
    blockers.push({
      id: "missing_title",
      message: "시나리오 제목을 입력해 주세요.",
      field: "title",
      section: "story",
    });
  }
  try {
    validateScenarioPublicationTransition({
      previousVisibility: input.previousVisibility ?? "private",
      nextVisibility: input.visibility ?? "private",
      summary: String(input.summary ?? ""),
    });
  } catch (error) {
    blockers.push({
      id: "missing_public_intro",
      message: error instanceof Error ? error.message : SCENARIO_PUBLIC_INTRO_REQUIRED,
      field: "summary",
      section: "story",
    });
  }
  if (!content && !hasPlayableScenarioPlan(plan)) {
    const field = firstMissingPlanField(plan);
    blockers.push({
      id: "missing_plan_or_content",
      message: "시작 상황과 플레이어 목표를 입력해 주세요.",
      field,
      section: sectionForField(field),
    });
  }
  if (namedNpcCount(input.npcs) > TRPG_SCENARIO_MAX_NPCS) {
    blockers.push({
      id: "npc_limit",
      message: `모브 NPC는 최대 ${TRPG_SCENARIO_MAX_NPCS}명입니다.`,
      field: "npcs",
      section: "details",
    });
  }
  if (input.bundleChars != null && input.bundleChars > bundleLimit) {
    blockers.push({
      id: "bundle_limit",
      message: scenarioBundleLimitError(input.bundleChars),
      field: "bundle",
      section: "details",
    });
  }

  const canSave = blockers.length === 0;
  const lint = lintTrpgScenarioPlan({
    plan,
    title,
    summary: input.summary,
    content,
    npcs: input.npcs,
    startInventory: input.startInventory,
    bundleChars: input.bundleChars,
    bundleLimit,
  });
  const blockerIds = new Set(blockers.map((item) => item.id));
  const recommendations: ScenarioReadinessItem[] = [];
  for (const issue of lint) {
    if (blockerIds.has(issue.code)) continue;
    if (issue.code === "recovery_path_unclear") continue;
    const isQualityOnly = issue.level === "warning" || (issue.level === "error" && canSave);
    if (!isQualityOnly) continue;
    const field = fieldForLintCode(issue.code);
    recommendations.push({
      id: issue.code,
      message: issue.message,
      field,
      section: sectionForField(field),
    });
  }

  const status: ScenarioReadinessStatus = !canSave
    ? "blocked"
    : recommendations.length > 0
      ? "recommended"
      : "playable";

  return {
    status,
    blockers,
    recommendations,
    canSave,
    canPlay: canSave,
  };
}

export function countFirstCreateFilledFields(input: {
  title: string;
  scenarioPlan: TrpgScenarioPlan | null | undefined;
}): number {
  const plan = input.scenarioPlan;
  return [
    Boolean(String(input.title ?? "").trim()),
    Boolean(plan?.startingSituation.trim()),
    Boolean(plan?.goal.trim()),
  ].filter(Boolean).length;
}

export function countFirstCreateRemainingFields(input: {
  title: string;
  scenarioPlan: TrpgScenarioPlan | null | undefined;
}): number {
  return FIRST_CREATE_VISIBLE_FIELDS.length - countFirstCreateFilledFields(input);
}

export type ScenarioReadinessHeadlineOptions = {
  firstCreateRemaining?: number;
};

export function scenarioReadinessHeadline(
  readiness: ScenarioReadiness,
  options?: ScenarioReadinessHeadlineOptions
): string {
  if (readiness.status === "blocked") {
    const remaining = options?.firstCreateRemaining;
    if (remaining != null && remaining > 0) {
      return `아직 ${remaining}개 항목이 필요합니다`;
    }
    return readiness.blockers.length > 1
      ? `아직 ${readiness.blockers.length}개 항목이 필요합니다`
      : "아직 플레이할 수 없습니다";
  }
  if (readiness.status === "recommended") {
    return `플레이 가능 · 보완 ${readiness.recommendations.length}`;
  }
  return "플레이 가능";
}
