export const TRPG_SCENARIO_PLAN_VERSION = 1 as const;
export const TRPG_SCENARIO_PLAN_SCHEMA_VERSION = "trpg-scenario-plan-v1";

export const TRPG_STORY_PHASES = [
  "INTRO",
  "DEVELOPMENT",
  "ESCALATION",
  "CLIMAX_AVAILABLE",
  "CLIMAX",
  "EPILOGUE",
  "FINISHED",
] as const;

export type TrpgStoryPhase = (typeof TRPG_STORY_PHASES)[number];

export const TRPG_SCENARIO_DIFFICULTIES = ["easy", "normal", "hard", "deadly"] as const;
export type TrpgScenarioDifficulty = (typeof TRPG_SCENARIO_DIFFICULTIES)[number];

export const TRPG_SCENARIO_PLAY_LENGTHS = ["short", "medium", "long", "open_ended"] as const;
export type TrpgScenarioPlayLength = (typeof TRPG_SCENARIO_PLAY_LENGTHS)[number];

export const TRPG_PLAN_FIELD_LIMITS = {
  startingSituation: 800,
  centralConflict: 800,
  goal: 600,
  secret: 2000,
  endingCondition: 240,
  majorEvent: 280,
  clue: 240,
  forbiddenEvent: 240,
  boss: 400,
  specialRule: 240,
  climax: 600,
  endingCandidate: 240,
  factionChange: 240,
  gmDirection: 800,
  endingConditions: 8,
  majorEvents: 12,
  clues: 10,
  forbiddenEvents: 8,
  specialRules: 8,
  endingCandidates: 6,
  factionChanges: 8,
} as const;

export type TrpgScenarioPlanProvenance = {
  generatorModel: string;
  schemaVersion: string;
  generatedAt: string;
  sourceWorldId: number | null;
  sourceWorldUpdatedAt: string;
  sourceWorldHash: string;
};

export type TrpgScenarioPlan = {
  version: typeof TRPG_SCENARIO_PLAN_VERSION;
  startingSituation: string;
  centralConflict: string;
  goal: string;
  secret: string;
  endingConditions: string[];
  majorEvents: string[];
  clues: string[];
  forbiddenEvents: string[];
  boss: string;
  specialRules: string[];
  difficulty: TrpgScenarioDifficulty;
  climax: string;
  endingCandidates: string[];
  factionChanges: string[];
  gmDirection: string;
  playLength: TrpgScenarioPlayLength;
  provenance?: TrpgScenarioPlanProvenance | null;
};

export type TrpgScenarioPlanLintIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
};

function clip(text: string, max: number): string {
  return text.trim().slice(0, max);
}

function stringList(raw: unknown, itemMax: number, listMax: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const text = clip(String(item ?? ""), itemMax);
    if (!text) continue;
    out.push(text);
    if (out.length >= listMax) break;
  }
  return out;
}

export function isTrpgStoryPhase(value: unknown): value is TrpgStoryPhase {
  return typeof value === "string" && (TRPG_STORY_PHASES as readonly string[]).includes(value);
}

export function parseTrpgStoryPhase(value: unknown, fallback: TrpgStoryPhase = "INTRO"): TrpgStoryPhase {
  return isTrpgStoryPhase(value) ? value : fallback;
}

export function parseTrpgScenarioDifficulty(value: unknown): TrpgScenarioDifficulty {
  return (TRPG_SCENARIO_DIFFICULTIES as readonly string[]).includes(String(value))
    ? (value as TrpgScenarioDifficulty)
    : "normal";
}

export function parseTrpgScenarioPlayLength(value: unknown): TrpgScenarioPlayLength {
  return (TRPG_SCENARIO_PLAY_LENGTHS as readonly string[]).includes(String(value))
    ? (value as TrpgScenarioPlayLength)
    : "medium";
}

export function emptyTrpgScenarioPlan(): TrpgScenarioPlan {
  return {
    version: TRPG_SCENARIO_PLAN_VERSION,
    startingSituation: "",
    centralConflict: "",
    goal: "",
    secret: "",
    endingConditions: [],
    majorEvents: [],
    clues: [],
    forbiddenEvents: [],
    boss: "",
    specialRules: [],
    difficulty: "normal",
    climax: "",
    endingCandidates: [],
    factionChanges: [],
    gmDirection: "",
    playLength: "medium",
    provenance: null,
  };
}

function parseProvenance(raw: unknown): TrpgScenarioPlanProvenance | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const generatorModel = clip(String(row.generatorModel ?? ""), 80);
  if (!generatorModel) return null;
  return {
    generatorModel,
    schemaVersion: clip(String(row.schemaVersion ?? TRPG_SCENARIO_PLAN_SCHEMA_VERSION), 80),
    generatedAt: clip(String(row.generatedAt ?? ""), 40),
    sourceWorldId: Number.isInteger(Number(row.sourceWorldId)) && Number(row.sourceWorldId) > 0
      ? Number(row.sourceWorldId)
      : null,
    sourceWorldUpdatedAt: clip(String(row.sourceWorldUpdatedAt ?? ""), 40),
    sourceWorldHash: clip(String(row.sourceWorldHash ?? ""), 80),
  };
}

export function parseTrpgScenarioPlan(raw: unknown): TrpgScenarioPlan | null {
  if (raw == null || raw === "") return null;
  let value = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const plan: TrpgScenarioPlan = {
    version: TRPG_SCENARIO_PLAN_VERSION,
    startingSituation: clip(String(row.startingSituation ?? ""), TRPG_PLAN_FIELD_LIMITS.startingSituation),
    centralConflict: clip(String(row.centralConflict ?? ""), TRPG_PLAN_FIELD_LIMITS.centralConflict),
    goal: clip(String(row.goal ?? ""), TRPG_PLAN_FIELD_LIMITS.goal),
    secret: clip(String(row.secret ?? ""), TRPG_PLAN_FIELD_LIMITS.secret),
    endingConditions: stringList(row.endingConditions, TRPG_PLAN_FIELD_LIMITS.endingCondition, TRPG_PLAN_FIELD_LIMITS.endingConditions),
    majorEvents: stringList(row.majorEvents, TRPG_PLAN_FIELD_LIMITS.majorEvent, TRPG_PLAN_FIELD_LIMITS.majorEvents),
    clues: stringList(row.clues, TRPG_PLAN_FIELD_LIMITS.clue, TRPG_PLAN_FIELD_LIMITS.clues),
    forbiddenEvents: stringList(row.forbiddenEvents, TRPG_PLAN_FIELD_LIMITS.forbiddenEvent, TRPG_PLAN_FIELD_LIMITS.forbiddenEvents),
    boss: clip(String(row.boss ?? ""), TRPG_PLAN_FIELD_LIMITS.boss),
    specialRules: stringList(row.specialRules, TRPG_PLAN_FIELD_LIMITS.specialRule, TRPG_PLAN_FIELD_LIMITS.specialRules),
    difficulty: parseTrpgScenarioDifficulty(row.difficulty),
    climax: clip(String(row.climax ?? ""), TRPG_PLAN_FIELD_LIMITS.climax),
    endingCandidates: stringList(row.endingCandidates, TRPG_PLAN_FIELD_LIMITS.endingCandidate, TRPG_PLAN_FIELD_LIMITS.endingCandidates),
    factionChanges: stringList(row.factionChanges, TRPG_PLAN_FIELD_LIMITS.factionChange, TRPG_PLAN_FIELD_LIMITS.factionChanges),
    gmDirection: clip(String(row.gmDirection ?? ""), TRPG_PLAN_FIELD_LIMITS.gmDirection),
    playLength: parseTrpgScenarioPlayLength(row.playLength),
    provenance: parseProvenance(row.provenance),
  };
  return isTrpgScenarioPlanEmpty(plan) ? null : plan;
}

export function isTrpgScenarioPlanEmpty(plan: TrpgScenarioPlan | null | undefined): boolean {
  if (!plan) return true;
  return !(
    plan.startingSituation ||
    plan.centralConflict ||
    plan.goal ||
    plan.secret ||
    plan.endingConditions.length ||
    plan.majorEvents.length ||
    plan.clues.length ||
    plan.forbiddenEvents.length ||
    plan.boss ||
    plan.specialRules.length ||
    plan.climax ||
    plan.endingCandidates.length ||
    plan.factionChanges.length ||
    plan.gmDirection
  );
}

/** Enough authored story structure to play without legacy content. */
export function hasPlayableScenarioPlan(plan: TrpgScenarioPlan | null | undefined): boolean {
  if (!plan) return false;
  return Boolean(
    plan.startingSituation.trim() &&
      plan.centralConflict.trim() &&
      plan.goal.trim() &&
      plan.endingConditions.some((item) => item.trim())
  );
}

export function countScenarioPlanChars(plan: TrpgScenarioPlan | null | undefined): number {
  if (!plan) return 0;
  const lists = [
    plan.endingConditions,
    plan.majorEvents,
    plan.clues,
    plan.forbiddenEvents,
    plan.specialRules,
    plan.endingCandidates,
    plan.factionChanges,
  ];
  return (
    plan.startingSituation.trim().length +
    plan.centralConflict.trim().length +
    plan.goal.trim().length +
    plan.secret.trim().length +
    plan.boss.trim().length +
    plan.climax.trim().length +
    plan.gmDirection.trim().length +
    lists.reduce((n, list) => n + list.reduce((sum, item) => sum + item.trim().length, 0), 0)
  );
}

function line(label: string, value: string): string {
  const text = value.trim();
  return text ? `${label}\n${text}` : "";
}

function bullets(label: string, items: readonly string[]): string {
  const rows = items.map((item) => item.trim()).filter(Boolean);
  if (rows.length === 0) return "";
  return `${label}\n${rows.map((item) => `- ${item}`).join("\n")}`;
}

/** Compact GM-only serializer. Empty fields are omitted. Not raw JSON. */
export function serializeTrpgScenarioPlanForGm(plan: TrpgScenarioPlan | null | undefined): string {
  if (!plan || isTrpgScenarioPlanEmpty(plan)) return "";
  const body = [
    line("시작 상황:", plan.startingSituation),
    line("중심 갈등:", plan.centralConflict),
    line("목표:", plan.goal),
    line("GM만 아는 비밀:", plan.secret),
    bullets("종료 조건:", plan.endingConditions),
    bullets("현재 사용 가능한 주요 사건 (강제 순서가 아님):", plan.majorEvents),
    bullets("단서:", plan.clues),
    bullets("금지 사건:", plan.forbiddenEvents),
    line("보스:", plan.boss),
    bullets("특별 규칙:", plan.specialRules),
    plan.difficulty ? `난이도: ${plan.difficulty}` : "",
    line("클라이맥스:", plan.climax),
    bullets("엔딩 후보 (고정 분기가 아님):", plan.endingCandidates),
    bullets("세력 변화:", plan.factionChanges),
    line("GM 연출:", plan.gmDirection),
    plan.playLength ? `플레이 길이: ${plan.playLength}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return body ? `[SCENARIO PLAN]\n${body}` : "";
}

export function relatedEnough(a: string, b: string): boolean {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 || right.size === 0) return false;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap >= 1;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^0-9a-z가-힣]+/i)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2)
  );
}

export function lintTrpgScenarioPlan(opts: {
  plan: TrpgScenarioPlan | null | undefined;
  title?: string;
  summary?: string;
  content?: string;
  npcs?: unknown;
  startInventory?: unknown;
  bundleChars?: number;
  bundleLimit?: number;
}): TrpgScenarioPlanLintIssue[] {
  const issues: TrpgScenarioPlanLintIssue[] = [];
  const plan = opts.plan;
  if (!plan || isTrpgScenarioPlanEmpty(plan)) {
    if (!(opts.content ?? "").trim()) {
      issues.push({
        level: "error",
        code: "missing_plan_or_content",
        message: "시나리오 본문 또는 이야기 설계(시작 상황·중심 갈등·목표·종료 조건)가 필요합니다.",
      });
    }
    return issues;
  }
  if (!plan.startingSituation.trim()) {
    issues.push({ level: "error", code: "missing_start", message: "시작 상황이 없습니다." });
  }
  if (!plan.centralConflict.trim()) {
    issues.push({ level: "error", code: "missing_conflict", message: "중심 갈등이 없습니다." });
  }
  if (!plan.goal.trim()) {
    issues.push({ level: "error", code: "missing_goal", message: "목표가 없습니다." });
  }
  if (plan.endingConditions.length === 0) {
    issues.push({ level: "error", code: "missing_endings", message: "종료 조건이 없습니다." });
  }
  if (plan.goal && plan.endingConditions.length > 0 && !plan.endingConditions.some((item) => relatedEnough(plan.goal, item))) {
    issues.push({
      level: "warning",
      code: "goal_ending_unrelated",
      message: "목표와 종료 조건이 서로 잘 연결되지 않아 보입니다.",
    });
  }
  const publicStart = `${opts.summary ?? ""}\n${opts.content ?? ""}\n${plan.startingSituation}`;
  if (plan.secret.trim() && publicStart.includes(plan.secret.trim())) {
    issues.push({
      level: "error",
      code: "secret_in_public",
      message: "비밀이 시작 상황이나 공개 본문에 그대로 노출되어 있습니다.",
    });
  }
  if (plan.climax.trim() && plan.centralConflict.trim() && !relatedEnough(plan.climax, plan.centralConflict)) {
    issues.push({
      level: "warning",
      code: "climax_unrelated",
      message: "클라이맥스가 중심 갈등과 잘 연결되지 않아 보입니다.",
    });
  }
  if (plan.secret.trim() && plan.clues.length === 0) {
    issues.push({ level: "warning", code: "secret_without_clues", message: "비밀이 있는데 단서가 0개입니다." });
  }
  if (plan.endingConditions.length === 0) {
    issues.push({ level: "warning", code: "no_ending_conditions", message: "종료 조건이 없습니다." });
  }
  if (plan.majorEvents.length >= 8) {
    issues.push({
      level: "warning",
      code: "railroad_risk",
      message: "주요 사건이 너무 많아 레일로드가 될 수 있습니다.",
    });
  }
  if (plan.boss.trim() && !plan.climax.trim()) {
    issues.push({ level: "warning", code: "boss_without_climax", message: "보스가 있지만 클라이맥스가 비어 있습니다." });
  }
  if (plan.playLength === "long" && plan.majorEvents.length + plan.clues.length < 3) {
    issues.push({
      level: "warning",
      code: "long_too_thin",
      message: "LONG 캠페인인데 사건/단서가 지나치게 적습니다.",
    });
  }
  const npcCount = Array.isArray(opts.npcs)
    ? opts.npcs.filter((item) => item && typeof item === "object" && String((item as { name?: unknown }).name ?? "").trim()).length
    : 0;
  if (npcCount > 8) {
    issues.push({ level: "error", code: "npc_limit", message: "NPC 수가 제한을 초과합니다." });
  }
  const inventoryCount = Array.isArray(opts.startInventory)
    ? opts.startInventory.filter((item) => String(item ?? "").trim()).length
    : 0;
  if (inventoryCount > 12) {
    issues.push({ level: "error", code: "inventory_limit", message: "시작 아이템 수가 제한을 초과합니다." });
  }
  if (opts.bundleChars != null && opts.bundleLimit != null && opts.bundleChars > opts.bundleLimit) {
    issues.push({ level: "error", code: "bundle_limit", message: "시나리오 묶음 글자 수가 한도를 초과합니다." });
  }
  return issues;
}

export function scoreTrpgScenarioReadiness(issues: readonly TrpgScenarioPlanLintIssue[], plan: TrpgScenarioPlan | null): {
  score: number;
  checks: Array<{ ok: boolean; label: string }>;
} {
  const errorCodes = new Set(issues.filter((issue) => issue.level === "error").map((issue) => issue.code));
  const warningCodes = new Set(issues.filter((issue) => issue.level === "warning").map((issue) => issue.code));
  const checks = [
    { ok: Boolean(plan?.goal.trim()) && !errorCodes.has("missing_goal"), label: "목표 존재" },
    {
      ok: Boolean(plan?.endingConditions.length) && !errorCodes.has("missing_endings"),
      label: "종료 조건 존재",
    },
    { ok: Boolean(plan?.clues.length), label: plan?.clues.length ? `단서 ${plan.clues.length}개` : "단서 없음" },
    { ok: Boolean(plan?.climax.trim()), label: "클라이맥스 존재" },
    { ok: Boolean(plan?.factionChanges.length) && !warningCodes.has("long_too_thin"), label: "세력 변화" },
  ];
  const passed = checks.filter((check) => check.ok).length;
  const errorPenalty = issues.filter((issue) => issue.level === "error").length * 2;
  const warnPenalty = issues.filter((issue) => issue.level === "warning").length;
  const score = Math.max(0, Math.min(10, passed * 2 - errorPenalty - warnPenalty));
  return { score, checks };
}

export function publicTrpgScenarioPlan(): null {
  return null;
}

export function storyPhaseIndex(phase: TrpgStoryPhase): number {
  return TRPG_STORY_PHASES.indexOf(phase);
}

export function isAllowedStoryPhaseTransition(
  from: TrpgStoryPhase,
  to: TrpgStoryPhase,
  opts?: { campaignFinished?: boolean; forcedEnd?: boolean }
): boolean {
  if (from === to) return true;
  if (opts?.campaignFinished || opts?.forcedEnd) {
    return to === "EPILOGUE" || to === "FINISHED" || storyPhaseIndex(to) >= storyPhaseIndex(from);
  }
  const delta = storyPhaseIndex(to) - storyPhaseIndex(from);
  return delta === 1;
}

export function applyStoryPhaseTransition(
  from: TrpgStoryPhase,
  requested: unknown,
  opts?: { campaignFinished?: boolean; forcedEnd?: boolean }
): TrpgStoryPhase {
  if (!isTrpgStoryPhase(requested)) return from;
  return isAllowedStoryPhaseTransition(from, requested, opts) ? requested : from;
}

