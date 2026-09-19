import type { ChatMsg } from "@/lib/ai";
import { AUTO_PROGRESSION_SCENE_USER_CONTROL } from "@/lib/autoProgressionRules";
import type { SceneProgressionHistoryEntry } from "@/lib/sceneProgressionState";
import type { ContentKind } from "@/lib/simulationMode";

export type SceneDirectiveMode = "interactive" | "auto_progression";

export type SceneProgressionType =
  | "relationship"
  | "daily_life"
  | "lore_clue"
  | "npc_action"
  | "world_reaction"
  | "tactical_planning"
  | "consequence"
  | "comedy"
  | "environment";

export type SceneUserControl =
  | "no_user_control"
  | "limited_reactions"
  | "persona_based_dialogue_allowed";

export type SceneKind =
  | "rest"
  | "investigation"
  | "operation"
  | "climax"
  | "neutral";

/**
 * Cast mode from explicit character/chat settings only.
 * Never inferred from recent-message NPC counts or operation keywords.
 */
export type SceneCastMode = "single_primary" | "ensemble" | "simulation";

export type SceneCastFocus = {
  sceneCastMode: SceneCastMode;
  primaryCharacterName: string | null;
  /** Server/eval only — never rendered into the model prompt. */
  supportingCastBudget: number;
  /**
   * Server/eval only — active direct speakers for this turn.
   * single_primary: [primary, optionalSupporting?] (max 1 supporting).
   * ensemble/simulation: primary + established cast.
   * Never rendered into the model prompt.
   */
  activeSpeakingCast: string[];
};

/** Canonical motion decision — HOLD is a valid first-class outcome. */
export type SceneMotionDecision = "HOLD" | "MICRO_MOTION" | "SCENE_ADVANCE" | "ESCALATE";

export type SceneMotionReason =
  | "quiet_interaction"
  | "user_led_progress"
  | "repetition"
  | "trigger"
  | "stagnation"
  | "scene_kind_escalation"
  | "ensemble_mode";

export type NpcGroundingSource =
  | "known_cast_name"
  | "active_speaking_cast"
  | "trigger_named"
  | "user_named"
  | "lexical_only"
  | "none";

export type NpcGroundingResult = {
  existingNpcEligible: boolean;
  newNpcAllowed: boolean;
  eligibleActorNames: string[];
  sources: NpcGroundingSource[];
};

export type StagnationAnalysis = {
  recentStagnation: boolean;
  reasons: SceneMotionReason[];
};

export type SceneDirective = {
  mode: SceneDirectiveMode;
  recentStagnation: boolean;
  recommendedIntensity: 0 | 1 | 2 | 3 | 4 | 5;
  motionDecision: SceneMotionDecision;
  motionReasons: SceneMotionReason[];
  progressionTypes: SceneProgressionType[];
  avoid: string[];
  nextBeatHint?: string;
  userControl: SceneUserControl;
  /** Focus computed from settings — budget is never prompt-exposed. */
  castFocus: SceneCastFocus;
  /** Internal — never rendered into the model prompt. */
  npcGrounding: NpcGroundingResult;
};

export type SceneDirectiveInput = {
  mode: SceneDirectiveMode;
  recentMessages?: ChatMsg[];
  currentUserMessage?: string | null;
  memoryText?: string | null;
  relationshipMemoryText?: string | null;
  lorebookText?: string | null;
  triggeredEventText?: string | null;
  /** Chat id for seeded RNG + history (optional for pure unit callers). */
  chatId?: number | string | null;
  /** Source turn number (playableTurnCount + 1). */
  currentTurn?: number | null;
  /** Recent committed progression history (last ≤4 turns). */
  progressionHistory?: SceneProgressionHistoryEntry[] | null;
  /** Explicit content kind from character settings (`character` | `simulation`). */
  contentKind?: ContentKind | null;
  /** Representative character name for single-primary chats. */
  primaryCharacterName?: string | null;
  /** Explicit party/ensemble chat flag — not inferred from scene NPC count. */
  party?: boolean | null;
  /**
   * Established active cast names from settings (simulation cast / party members).
   * Used only for ensemble/simulation supportingCastBudget — not for mode detection.
   */
  establishedActiveCastNames?: string[] | null;
  /**
   * Known supporting NPC names from the character card / lore (single_primary).
   * Used only to select at most one optional supporting speaker per turn —
   * never rendered into the model prompt.
   */
  knownSupportingCastNames?: string[] | null;
};

/** Internal telemetry — never rendered into the model prompt. */
export type ProgressionSelectionMeta = {
  sceneKind: SceneKind;
  motionDecision: SceneMotionDecision;
  eligible: SceneProgressionType[];
  weights: Partial<Record<SceneProgressionType, number>>;
  cooldownOverrides: string[];
  seed: string;
  pickCount: number;
  npcGrounding: NpcGroundingResult;
};

export const SCENE_DIRECTIVE_VERSION = "world-motion-v1.2";

export const BASE_PROGRESSION_WEIGHTS: Record<SceneProgressionType, number> = {
  relationship: 1,
  daily_life: 1,
  lore_clue: 1,
  npc_action: 1,
  world_reaction: 1,
  tactical_planning: 1,
  consequence: 1,
  comedy: 0.5,
  environment: 1,
};

export const COOLDOWN_MULTIPLIERS = {
  lastTurn: 0.15,
  twoTurnsAgo: 0.4,
  threeTurnsAgo: 0.7,
  older: 1,
} as const;

const ALL_PROGRESSION_TYPES: SceneProgressionType[] = [
  "relationship",
  "daily_life",
  "lore_clue",
  "npc_action",
  "world_reaction",
  "tactical_planning",
  "consequence",
  "comedy",
  "environment",
];

const PROGRESSION_LABELS: Record<SceneProgressionType, string> = {
  relationship: "관계 변화",
  daily_life: "생활 변수",
  lore_clue: "단서",
  npc_action: "NPC 행동",
  world_reaction: "세계 반응",
  tactical_planning: "작전/조사",
  consequence: "이전 선택의 결과",
  comedy: "개그/오해",
  environment: "환경 변화",
};

const USER_CONTROL_LABELS: Record<SceneUserControl, string> = {
  no_user_control: "유저의 의도적 행동/대사/감정 결론은 쓰지 않는다.",
  limited_reactions: "유저의 의도는 쓰지 않고, 자연스러운 짧은 비자발 반응만 가능하다.",
  persona_based_dialogue_allowed: AUTO_PROGRESSION_SCENE_USER_CONTROL,
};

/** Shared motion body — full engine rule and compact [SCENE PACING] both consume this. */
export function renderSceneMotionBody(motionDecision: SceneMotionDecision): string {
  switch (motionDecision) {
    case "HOLD":
      return "현재 비트의 자연스러운 반응·대화·몸짓·감각을 이어간다. 별도 사건, 새 전개 축, 새 인물 도입 의무는 없다.";
    case "MICRO_MOTION":
      return "현재 상호작용 안에서 작은 관계·감각·환경 변화 하나를 조용히 이어간다. 새 인물·별도 사건은 만들지 않는다.";
    case "SCENE_ADVANCE":
      return "현재 인과에 맞는 장면 전개를 진행한다. 허용된 전개 축과 execution contract를 따른다.";
    case "ESCALATE":
      return "현재 인과와 직접 연결된 강한 외부 변화를 진행한다. execution contract 범위를 넘기지 않는다.";
    default: {
      const _exhaustive: never = motionDecision;
      return _exhaustive;
    }
  }
}

/** Motion-decision-aware scene engine rule — sole owner for mandatory-motion semantics. */
export function renderSceneEngineRule(motionDecision: SceneMotionDecision): string {
  return `[PRIVATE SCENE ENGINE RULE]\n${renderSceneMotionBody(motionDecision)}\n전개는 항상 전투나 대형 위기일 필요가 없다. 현재 모드와 유저 조종 범위를 따르고, 이 규칙을 본문에 언급하지 않는다.`;
}

const AUTO_PROGRESSION_ENSEMBLE_SCENE_RULE =
  "다인물: 전개는 현재 중심 인물 하나에 고정되지 않는다. 여러 AI 캐릭터·NPC의 대화·판단·갈등·협력·적대·세계 사건을 함께 진행할 수 있다. [B] 내면 시점으로 전환하지 않는다.";

const OPERATION_TERMS = ["작전", "임무", "침투", "추적", "협상", "함정", "구출", "제한시간", "전투"];
const INVESTIGATION_TERMS = ["조사", "단서", "기록", "소문", "흔적", "보고서", "메시지"];
const REST_TERMS = ["휴식", "식사", "잠", "치료", "회복", "데이트", "연인", "키스", "집"];
const QUIET_INTIMACY_TERMS = [
  "휴게실",
  "소파",
  "곁",
  "어깨",
  "손끝",
  "호흡",
  "가만히",
  "이대로",
  "손을",
  "손 ",
];
const CLIMAX_TERMS = ["결전", "최종", "붕괴", "배신", "대형 위기", "보스"];
const DANGER_TERMS = ["공격", "폭발", "붕괴", "배신", "납치", "전투", "함정", "추락", "경보", "습격", "위험"];
const RELATIONSHIP_TERMS = ["연인", "고백", "질투", "미안", "괜찮", "걱정", "친구", "관계"];
const DAILY_TERMS = ["식사", "잠", "집", "휴식", "회복", "정비"];
const NPC_GROUND_TERMS = ["NPC", "동료", "상관", "담당", "방문객", "손님", "병사", "경비", "의사", "점원"];
const COMEDY_BLOCK_TERMS = ["사망", "중상", "즉사", "대형 위기", "습격", "경보", "납치", "붕괴"];

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function countMatches(text: string, terms: string[]): number {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function compactText(messages: ChatMsg[] | undefined): string {
  return (messages ?? [])
    .slice(-8)
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeForRepeat(text: string): string {
  return text
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** Current-turn causal action cues — avoid broad substring collisions (문/열/잡). */
const USER_PROGRESS_ACTIONS = [
  "이동",
  "나가",
  "들어가",
  "들어간",
  "나간",
  "빠져",
  "전진",
  "도망",
  "추적",
  "조사",
  "발견",
  "공격",
  "전투",
  "문을 열",
  "문을 닫",
  "열어",
  "닫아",
  "계획",
  "결정",
  "시작",
  "요청",
  "보고",
  "뛰",
  "달리",
  "걸어",
  "전화",
  "메시지",
];

const EXPLICIT_ARRIVAL_ACTOR_PATTERNS = [
  /지원팀(?:이|은|가|을)?\s*(?:도착|찾아|들어|나타)/,
  /증원(?:이|은|가|을)?\s*(?:도착|찾아|들어|나타)/,
  /경비(?:가|는|들이)?\s*(?:도착|찾아|들어|나타|달려)/,
  /부대(?:가|는|들이)?\s*(?:도착|찾아|들어|나타)/,
  /의료(?:팀|진)?(?:이|가|는)?\s*(?:도착|찾아|들어|나타)/,
  /파견(?:이|은|가|을)?\s*(?:도착|찾아|들어|나타)/,
];

/** Deterministic stagnation axes — short replies alone are not stagnation. */
export function analyzeStagnation(recentMessages: ChatMsg[] | undefined): StagnationAnalysis {
  const recent = (recentMessages ?? []).slice(-8);
  const reasons: SceneMotionReason[] = [];
  if (recent.length < 4) {
    return { recentStagnation: false, reasons };
  }

  const assistantTurns = recent.filter((message) => message.role === "assistant");
  const userTurns = recent.filter((message) => message.role === "user");
  const reassuranceTerms = ["괜찮", "미안", "걱정", "말하지 않아도", "침묵"];
  const movementCount = countMatches(compactText(recent), USER_PROGRESS_ACTIONS);

  const reassuranceCount = assistantTurns.filter((message) =>
    includesAny(message.content, reassuranceTerms)
  ).length;
  const shortUserReplies = userTurns.filter((message) => message.content.trim().length <= 12).length;
  const normalizedAssistant = assistantTurns.map((message) => normalizeForRepeat(message.content));
  const repeatedAssistant =
    normalizedAssistant.length >= 3 &&
    new Set(normalizedAssistant.filter(Boolean)).size <= Math.max(1, normalizedAssistant.length - 2);

  if (reassuranceCount >= 2 && shortUserReplies >= 1) {
    reasons.push("repetition");
  }
  if (repeatedAssistant) {
    reasons.push("repetition");
  }
  // Short replies without reassurance/repetition = quiet intimacy, not stagnation.
  if (shortUserReplies >= 3 && movementCount <= 1 && reassuranceCount >= 1) {
    reasons.push("stagnation");
  }

  return { recentStagnation: reasons.length > 0, reasons };
}

export function detectSceneStagnation(recentMessages: ChatMsg[] | undefined): boolean {
  return analyzeStagnation(recentMessages).recentStagnation;
}

function includesCurrentTurnProgressAction(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return USER_PROGRESS_ACTIONS.some((term) => trimmed.includes(term));
}

/** Current turn only — prior-turn movement must not force HOLD on dialogue-only turns. */
export function detectUserLedProgress(input: {
  recentMessages?: ChatMsg[];
  currentUserMessage?: string | null;
}): boolean {
  return includesCurrentTurnProgressAction(input.currentUserMessage ?? "");
}

function triggerImpliesExplicitArrival(trigger: string): boolean {
  if (!trigger.trim()) return false;
  if (EXPLICIT_ARRIVAL_ACTOR_PATTERNS.some((pattern) => pattern.test(trigger))) return true;
  return TRIGGER_ARRIVAL_TERMS.some((term) => trigger.includes(term)) &&
    includesAny(trigger, ["팀", "부대", "경비", "의료", "파견", "증원", "지원", "병력", "요원"]);
}

/** Physical arrival cues — remote contact (연락/메시지/호출) is not new-actor arrival. */
const TRIGGER_PHYSICAL_ARRIVAL_TERMS = [
  "도착",
  "찾아왔",
  "노크",
  "들어왔",
  "나타났",
  "파견",
];

const TRIGGER_ARRIVAL_TERMS = [
  ...TRIGGER_PHYSICAL_ARRIVAL_TERMS,
  "지원",
  "증원",
];

/**
 * Entity-evidence NPC grounding.
 * knownSupportingCastNames = identity whitelist only — not scene presence proof.
 * Presence requires current scene signal, activeSpeakingCast, user target, or trigger.
 */
export function resolveNpcGrounding(input: {
  sceneSignalText: string;
  groundingText: string;
  triggeredEventText?: string | null;
  currentUserMessage?: string | null;
  knownSupportingCastNames?: string[] | null;
  activeSpeakingCast?: string[];
}): NpcGroundingResult {
  const sources: NpcGroundingSource[] = [];
  const eligibleActorNames: string[] = [];
  const primary = input.activeSpeakingCast?.[0];
  const supporting = (input.activeSpeakingCast ?? []).slice(1).filter(Boolean);
  const known = (input.knownSupportingCastNames ?? [])
    .map((name) => name.trim())
    .filter((name) => name && name !== primary);
  const userMsg = input.currentUserMessage ?? "";
  const trigger = input.triggeredEventText?.trim() ?? "";

  for (const name of supporting) {
    sources.push("active_speaking_cast");
    if (!eligibleActorNames.includes(name)) eligibleActorNames.push(name);
  }
  for (const name of known) {
    if (userMsg.includes(name)) {
      sources.push("user_named");
      if (!eligibleActorNames.includes(name)) eligibleActorNames.push(name);
    }
  }
  if (trigger && known.some((name) => trigger.includes(name))) {
    sources.push("trigger_named");
    for (const name of known) {
      if (trigger.includes(name) && !eligibleActorNames.includes(name)) {
        eligibleActorNames.push(name);
      }
    }
  }

  const lexicalOnly =
    eligibleActorNames.length === 0 &&
    (includesAny(input.sceneSignalText, NPC_GROUND_TERMS) ||
      includesAny(input.groundingText, NPC_GROUND_TERMS) ||
      includesAny(trigger, NPC_GROUND_TERMS));
  if (lexicalOnly) {
    sources.push("lexical_only");
  }

  const existingNpcEligible = eligibleActorNames.length > 0;
  const newNpcAllowed = Boolean(
    trigger &&
      (known.some(
        (name) => trigger.includes(name) && includesAny(trigger, TRIGGER_PHYSICAL_ARRIVAL_TERMS)
      ) ||
        triggerImpliesExplicitArrival(trigger))
  );

  return {
    existingNpcEligible,
    newNpcAllowed,
    eligibleActorNames,
    sources: sources.length > 0 ? sources : ["none"],
  };
}

export function resolveSceneMotionDecision(input: {
  sceneKind: SceneKind;
  sceneCastMode: SceneCastMode;
  intensity: number;
  stagnant: boolean;
  stagnationReasons: SceneMotionReason[];
  hasTrigger: boolean;
  userLedProgress: boolean;
  mode: SceneDirectiveMode;
}): { decision: SceneMotionDecision; reasons: SceneMotionReason[] } {
  const reasons = [...input.stagnationReasons];

  if (input.hasTrigger) {
    return {
      decision: input.intensity >= 4 ? "ESCALATE" : "SCENE_ADVANCE",
      reasons: [...reasons, "trigger"],
    };
  }

  // Auto progression: explicit continue contract — never HOLD (autoProgressionRules).
  if (input.mode === "auto_progression") {
    if (input.intensity === 0 && !input.stagnant) {
      return { decision: "MICRO_MOTION", reasons: ["quiet_interaction"] };
    }
    if (input.intensity <= 1 && input.stagnant) {
      return { decision: "MICRO_MOTION", reasons: [...reasons, "stagnation"] };
    }
    if (input.intensity <= 1) return { decision: "MICRO_MOTION", reasons };
    if (input.intensity <= 3) return { decision: "SCENE_ADVANCE", reasons };
    return { decision: "ESCALATE", reasons: [...reasons, "scene_kind_escalation"] };
  }

  // Simulation: autonomous multi-cast product mode — never HOLD.
  if (input.sceneCastMode === "simulation") {
    if (input.intensity === 0 && !input.stagnant) {
      return { decision: "MICRO_MOTION", reasons: ["ensemble_mode"] };
    }
  }

  // single_primary and party ensemble share motion policy; cast mode affects eligibility only.
  if (input.userLedProgress && !input.stagnant) {
    return { decision: "HOLD", reasons: ["user_led_progress"] };
  }

  if (input.intensity === 0 && !input.stagnant) {
    return { decision: "HOLD", reasons: ["quiet_interaction"] };
  }

  if (input.intensity <= 1 && input.stagnant) {
    return { decision: "MICRO_MOTION", reasons: [...reasons, "stagnation"] };
  }

  if (input.intensity <= 1) {
    return { decision: "MICRO_MOTION", reasons };
  }
  if (input.intensity <= 3) {
    return { decision: "SCENE_ADVANCE", reasons };
  }
  return { decision: "ESCALATE", reasons: [...reasons, "scene_kind_escalation"] };
}

/** Scene kind from current-scene signals only — never memory/lorebook. */
export function resolveSceneKind(text: string): SceneKind {
  if (includesAny(text, CLIMAX_TERMS)) return "climax";
  // Danger/operation terms only count from scene signal text (caller must isolate).
  if (includesAny(text, OPERATION_TERMS) || includesAny(text, DANGER_TERMS)) {
    // Prefer climax already handled; treat active danger as operation for boosts.
    if (includesAny(text, ["결전", "보스", "대형 위기"])) return "climax";
    return "operation";
  }
  if (includesAny(text, INVESTIGATION_TERMS)) return "investigation";
  if (
    includesAny(text, REST_TERMS) ||
    includesAny(text, RELATIONSHIP_TERMS) ||
    includesAny(text, QUIET_INTIMACY_TERMS)
  ) {
    return "rest";
  }
  return "neutral";
}

export function buildSceneSignalText(input: {
  recentMessages?: ChatMsg[];
  currentUserMessage?: string | null;
  triggeredEventText?: string | null;
}): string {
  return [
    compactText(input.recentMessages),
    input.currentUserMessage ?? "",
    input.triggeredEventText ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildGroundingText(input: {
  memoryText?: string | null;
  relationshipMemoryText?: string | null;
  lorebookText?: string | null;
}): string {
  return [input.memoryText ?? "", input.relationshipMemoryText ?? "", input.lorebookText ?? ""]
    .filter(Boolean)
    .join("\n");
}

export function selectSceneIntensity(input: {
  recentMessages?: ChatMsg[];
  currentUserMessage?: string | null;
  triggeredEventText?: string | null;
  recentStagnation?: boolean;
}): 0 | 1 | 2 | 3 | 4 | 5 {
  const text = buildSceneSignalText(input);
  const kind = resolveSceneKind(text);
  const recentHighIntensity = countMatches(text, DANGER_TERMS) >= 2;

  if (recentHighIntensity) return input.recentStagnation ? 1 : 0;
  if (kind === "rest") return input.recentStagnation ? 1 : 0;
  if (kind === "investigation") return input.recentStagnation ? 2 : 3;
  if (kind === "operation") return input.recentStagnation ? 3 : 4;
  if (kind === "climax") return 4;
  return input.recentStagnation ? 2 : 1;
}

/** FNV-1a 32-bit → mulberry32 seed. */
export function hashSeed(parts: Array<string | number>): number {
  const s = parts.map(String).join(":");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function sceneKindBoosts(kind: SceneKind): Partial<Record<SceneProgressionType, number>> {
  switch (kind) {
    case "rest":
      return {
        relationship: 4,
        daily_life: 3,
        environment: 2,
        lore_clue: 1,
        comedy: 1,
        // Quiet rest: ambient world_reaction only when stagnant (applied separately).
        world_reaction: -0.5,
        consequence: 0.5,
        tactical_planning: -10,
        npc_action: -2,
      };
    case "investigation":
      return {
        lore_clue: 5,
        world_reaction: 3,
        consequence: 2,
        environment: 2,
        relationship: 1,
        daily_life: 0.5,
        comedy: -2,
      };
    case "operation":
      return {
        tactical_planning: 5,
        npc_action: 4,
        consequence: 3,
        environment: 2,
        world_reaction: 2,
        relationship: 0.5,
        comedy: -5,
      };
    case "climax":
      return {
        world_reaction: 5,
        npc_action: 4,
        tactical_planning: 4,
        consequence: 4,
        environment: 2,
        comedy: -10,
        daily_life: -5,
      };
    default:
      return {
        environment: 3,
        relationship: 2,
        daily_life: 2,
        world_reaction: 1,
        lore_clue: 1,
        comedy: 0.5,
      };
  }
}

function stagnationBoosts(): Partial<Record<SceneProgressionType, number>> {
  return {
    environment: 3,
    world_reaction: 2.5,
    relationship: 2,
    daily_life: 2,
    lore_clue: 1.5,
    consequence: 1.5,
  };
}

function triggerBoosts(): Partial<Record<SceneProgressionType, number>> {
  return {
    consequence: 5,
    world_reaction: 4,
    npc_action: 3,
    tactical_planning: 2,
  };
}

function cooldownMultiplierForType(
  type: SceneProgressionType,
  history: SceneProgressionHistoryEntry[],
  currentTurn: number
): number {
  if (!history.length || !Number.isFinite(currentTurn) || currentTurn <= 0) {
    return COOLDOWN_MULTIPLIERS.older;
  }
  let best: number = COOLDOWN_MULTIPLIERS.older;
  for (const entry of history) {
    if (!entry.types.includes(type)) continue;
    const age = currentTurn - entry.turn;
    if (age <= 0) continue;
    if (age === 1) best = Math.min(best, COOLDOWN_MULTIPLIERS.lastTurn);
    else if (age === 2) best = Math.min(best, COOLDOWN_MULTIPLIERS.twoTurnsAgo);
    else if (age === 3) best = Math.min(best, COOLDOWN_MULTIPLIERS.threeTurnsAgo);
  }
  return best;
}

function pickCountForIntensity(
  intensity: number,
  motionDecision: SceneMotionDecision,
  rng: () => number
): number {
  if (motionDecision === "HOLD") return 0;
  if (motionDecision === "MICRO_MOTION") return 1;
  if (intensity <= 1) return 1;
  if (intensity === 2) return rng() < 0.55 ? 1 : 2;
  if (intensity === 3) return 2;
  return rng() < 0.55 ? 2 : 3;
}

function weightedPickWithoutReplacement(
  weights: Map<SceneProgressionType, number>,
  count: number,
  rng: () => number
): SceneProgressionType[] {
  const selected: SceneProgressionType[] = [];
  const pool = new Map(weights);
  for (let i = 0; i < count; i++) {
    let total = 0;
    for (const w of pool.values()) total += w;
    if (total <= 0) break;
    let r = rng() * total;
    let chosen: SceneProgressionType | null = null;
    for (const [type, w] of pool) {
      r -= w;
      if (r <= 0) {
        chosen = type;
        break;
      }
    }
    if (!chosen) {
      chosen = [...pool.keys()].pop() ?? null;
    }
    if (!chosen) break;
    selected.push(chosen);
    pool.delete(chosen);
  }
  return selected;
}

export function selectProgressionTypesWeighted(input: {
  sceneSignalText: string;
  groundingText: string;
  intensity: number;
  stagnant: boolean;
  triggeredEventText?: string | null;
  chatId?: number | string | null;
  currentTurn?: number | null;
  progressionHistory?: SceneProgressionHistoryEntry[] | null;
  /** Soft priority only — never used to flip cast mode. */
  sceneCastMode?: SceneCastMode | null;
  motionDecision?: SceneMotionDecision | null;
  npcGrounding?: NpcGroundingResult | null;
  knownSupportingCastNames?: string[] | null;
  activeSpeakingCast?: string[];
  currentUserMessage?: string | null;
}): { types: SceneProgressionType[]; meta: ProgressionSelectionMeta } {
  const sceneKind = resolveSceneKind(input.sceneSignalText);
  const hasTrigger = Boolean(input.triggeredEventText?.trim());
  const sceneCastMode = input.sceneCastMode ?? "single_primary";
  const npcGrounding =
    input.npcGrounding ??
    resolveNpcGrounding({
      sceneSignalText: input.sceneSignalText,
      groundingText: input.groundingText,
      triggeredEventText: input.triggeredEventText,
      currentUserMessage: input.currentUserMessage,
      knownSupportingCastNames: input.knownSupportingCastNames,
      activeSpeakingCast: input.activeSpeakingCast,
    });
  const motionDecision =
    input.motionDecision ??
    resolveSceneMotionDecision({
      sceneKind,
      sceneCastMode,
      intensity: input.intensity,
      stagnant: input.stagnant,
      stagnationReasons: input.stagnant ? (["stagnation"] as SceneMotionReason[]) : [],
      hasTrigger,
      userLedProgress: detectUserLedProgress({
        currentUserMessage: input.currentUserMessage,
      }),
      mode: "interactive",
    }).decision;

  if (motionDecision === "HOLD") {
    return {
      types: [],
      meta: {
        sceneKind,
        motionDecision,
        eligible: [],
        weights: {},
        cooldownOverrides: [],
        seed: `${input.chatId ?? 0}:${input.currentTurn ?? 0}:${SCENE_DIRECTIVE_VERSION}`,
        pickCount: 0,
        npcGrounding,
      },
    };
  }

  const dangerCue =
    includesAny(input.sceneSignalText, DANGER_TERMS) || sceneKind === "climax" || sceneKind === "operation";
  const npcActionAllowed =
    npcGrounding.existingNpcEligible || npcGrounding.newNpcAllowed;
  const loreGrounded =
    includesAny(input.groundingText, ["단서", "기록", "소문", "조직", "장소", "세계"]) ||
    includesAny(input.sceneSignalText, INVESTIGATION_TERMS);
  const comedyOk =
    (sceneKind === "rest" || sceneKind === "neutral") &&
    !dangerCue &&
    !hasTrigger &&
    !includesAny(input.sceneSignalText, COMEDY_BLOCK_TERMS);

  const weights = new Map<SceneProgressionType, number>();
  for (const type of ALL_PROGRESSION_TYPES) {
    weights.set(type, BASE_PROGRESSION_WEIGHTS[type]);
  }

  const applyBoost = (boost: Partial<Record<SceneProgressionType, number>>) => {
    for (const [type, delta] of Object.entries(boost) as Array<[SceneProgressionType, number]>) {
      weights.set(type, (weights.get(type) ?? 0) + delta);
    }
  };

  applyBoost(sceneKindBoosts(sceneKind));
  if (input.stagnant) applyBoost(stagnationBoosts());
  if (hasTrigger) applyBoost(triggerBoosts());

  // single_primary: prefer main interaction; npc_action only when entity-grounded.
  if (sceneCastMode === "single_primary" && !hasTrigger) {
    if (!npcActionAllowed) {
      weights.set("npc_action", 0);
    } else {
      const npc = weights.get("npc_action") ?? 0;
      if (npc > 0) weights.set("npc_action", npc * 0.55);
    }
    weights.set("relationship", (weights.get("relationship") ?? 0) * 1.2);
    weights.set("daily_life", (weights.get("daily_life") ?? 0) * 1.15);
  }

  // Entity-grounded NPC gate — all scene kinds (not only rest/neutral).
  if (!npcActionAllowed) {
    weights.set("npc_action", 0);
  }

  // Eligibility gates — zero unfit (memory/lore never force operation).
  if (sceneKind === "rest" || sceneKind === "neutral") {
    if (!dangerCue && !hasTrigger) {
      weights.set("tactical_planning", 0);
      // Quiet scenes: no ambient world crisis beat unless stagnant needs motion.
      if (!input.stagnant) weights.set("world_reaction", 0);
    }
  }
  if (!comedyOk) {
    weights.set("comedy", 0);
  }
  if (!loreGrounded && sceneKind === "rest" && !input.stagnant) {
    // Keep a thin lore weight via scene boost only when stagnant/investigation.
    const lore = weights.get("lore_clue") ?? 0;
    if (lore > 1.5) weights.set("lore_clue", 1);
  }
  if (hasTrigger) {
    // Prefer trigger aftermath — do not invent unrelated large plots.
    for (const type of ALL_PROGRESSION_TYPES) {
      if (
        type !== "consequence" &&
        type !== "world_reaction" &&
        type !== "npc_action" &&
        type !== "tactical_planning" &&
        type !== "relationship" &&
        type !== "environment"
      ) {
        const w = weights.get(type) ?? 0;
        weights.set(type, Math.min(w, 0.5));
      }
    }
  }

  const history = input.progressionHistory ?? [];
  const turn = Number(input.currentTurn ?? 0);
  const cooldownOverrides: string[] = [];
  const positiveBeforeCooldown = [...weights.entries()].filter(([, w]) => w > 0);
  const onlyOneEligible = positiveBeforeCooldown.length <= 1;

  for (const type of ALL_PROGRESSION_TYPES) {
    const base = weights.get(type) ?? 0;
    if (base <= 0) continue;
    const mult = cooldownMultiplierForType(type, history, turn);
    if (mult < 1) {
      const forceOverride =
        onlyOneEligible ||
        (hasTrigger &&
          (type === "consequence" || type === "world_reaction" || type === "npc_action")) ||
        (input.stagnant && positiveBeforeCooldown.length <= 2 && mult <= COOLDOWN_MULTIPLIERS.lastTurn);
      if (forceOverride) {
        cooldownOverrides.push(`${type}:override`);
      } else {
        weights.set(type, base * mult);
      }
    }
  }

  const eligible = ALL_PROGRESSION_TYPES.filter((t) => (weights.get(t) ?? 0) > 0);

  const chatKey = input.chatId == null || input.chatId === "" ? "0" : String(input.chatId);
  const seedStr = `${chatKey}:${turn || 0}:${SCENE_DIRECTIVE_VERSION}`;
  const seed = hashSeed([seedStr]);
  const rng = createSeededRng(seed);
  const pickCount = Math.min(
    pickCountForIntensity(input.intensity, motionDecision, rng),
    eligible.length
  );

  if (eligible.length === 0 || pickCount === 0) {
    return {
      types: [],
      meta: {
        sceneKind,
        motionDecision,
        eligible: [],
        weights: {},
        cooldownOverrides,
        seed: seedStr,
        pickCount: 0,
        npcGrounding,
      },
    };
  }

  const weightMap = new Map(
    eligible.map((t) => [t, Math.max(0, weights.get(t) ?? 0)] as const)
  );
  const types = weightedPickWithoutReplacement(weightMap, pickCount, rng);

  const weightSnapshot: Partial<Record<SceneProgressionType, number>> = {};
  for (const t of ALL_PROGRESSION_TYPES) {
    const w = weights.get(t) ?? 0;
    if (w > 0) weightSnapshot[t] = Math.round(w * 1000) / 1000;
  }

  return {
    types,
    meta: {
      sceneKind,
      motionDecision,
      eligible,
      weights: weightSnapshot,
      cooldownOverrides,
      seed: seedStr,
      pickCount,
      npcGrounding,
    },
  };
}

function buildAvoidList(mode: SceneDirectiveMode, intensity: number): string[] {
  const avoid = ["괜찮냐는 반복", "이미 지난 설명 반복", "트리거 조건 노출"];
  if (intensity <= 2) avoid.unshift("갑작스러운 납치", "대형 전투", "위기 남발");
  else avoid.unshift("즉시 정체 확정", "강제 고백");
  if (mode === "interactive") avoid.push("유저 의도 작성");
  if (mode === "auto_progression") {
    avoid.push("[B] 내면·감정 결론으로 분량 채우기");
    avoid.push("[B] 시점 전환으로 장면 이어가기");
  }
  return avoid.slice(0, 5);
}

function sanitizeHint(hint: string): string {
  const hasHiddenCountdownConsequence =
    /D-?DAY|디데이|카운트다운/i.test(hint) && /사망|죽는 날|사라진다|파멸/.test(hint);
  if (hasHiddenCountdownConsequence) {
    return "상태창 숫자의 결과를 확정하지 말고, 장면 안의 작은 불안감이나 시선 변화로만 드러낸다.";
  }
  return hint
    .replace(/\b[a-z][a-z0-9]+(?:_[a-z0-9]+)+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const HINT_BY_TYPE: Record<SceneProgressionType, string> = {
  tactical_planning: "작전 논의 중 작은 기록 하나가 이전 선택의 결과와 연결된다.",
  lore_clue: "조용한 순간, 이전 대화와 연결된 작은 단서 하나가 다시 눈에 띈다.",
  daily_life: "평범한 생활 변수 하나가 관계의 온도를 조금 바꾼다.",
  relationship: "반복 확인 대신 작은 행동 하나로 관계의 거리감이 미세하게 달라진다.",
  environment: "주변 환경의 작은 변화가 다음 대화의 방향을 자연스럽게 열어 준다.",
  world_reaction: "세계 쪽의 작은 반응 하나가 현재 장소의 분위기를 바꾼다.",
  npc_action: "이미 장면에 있는 인물의 짧은 행동이 다음 선택을 연다.",
  consequence: "직전 선택의 결과가 지금의 형태를 바꿔 놓는다.",
  comedy: "가벼운 오해나 엇갈림이 긴장 없이 장면을 한 박자 움직인다.",
};

/** Soft framing for single_primary — prefers expression through the main interaction, not bans. */
const SINGLE_PRIMARY_NPC_ACTION_HINT =
  "보조 인물의 움직임은 장면 밖 결과, 메시지·환경 변화, 또는 중심 인물의 대응으로 현재 상호작용을 전진시킨다.";

/**
 * Resolve cast focus from explicit character/chat settings only.
 * Does not inspect recent-message speaker counts or scene keywords.
 */
export function resolveSceneCastFocus(input: {
  contentKind?: ContentKind | null;
  primaryCharacterName?: string | null;
  party?: boolean | null;
  establishedActiveCastNames?: string[] | null;
}): SceneCastFocus {
  const primary =
    typeof input.primaryCharacterName === "string" && input.primaryCharacterName.trim()
      ? input.primaryCharacterName.trim()
      : null;
  const castNames = (input.establishedActiveCastNames ?? [])
    .map((name) => name.trim())
    .filter(Boolean);

  if (input.contentKind === "simulation") {
    const budget = Math.max(2, Math.min(6, castNames.length || 3));
    return {
      sceneCastMode: "simulation",
      primaryCharacterName: primary,
      supportingCastBudget: budget,
      activeSpeakingCast: primary ? [primary, ...castNames] : [...castNames],
    };
  }
  if (input.party === true) {
    const budget = Math.max(2, Math.min(6, castNames.length || 3));
    return {
      sceneCastMode: "ensemble",
      primaryCharacterName: primary,
      supportingCastBudget: budget,
      activeSpeakingCast: primary ? [primary, ...castNames] : [...castNames],
    };
  }
  return {
    sceneCastMode: "single_primary",
    primaryCharacterName: primary,
    supportingCastBudget: 1,
    activeSpeakingCast: primary ? [primary] : [],
  };
}

/**
 * For single_primary, select at most one optional supporting speaker based on:
 * current user cue or active triggered event only.
 * Prior-turn / recent-message name mentions are not scene-presence authority.
 * Never selects all grounded NPCs — only the one most relevant this turn.
 */
function resolveActiveSpeakingCast(
  focus: SceneCastFocus,
  input: SceneDirectiveInput
): SceneCastFocus {
  if (focus.sceneCastMode !== "single_primary") return focus;
  const primary = focus.primaryCharacterName;
  if (!primary) return focus;
  const candidates = (input.knownSupportingCastNames ?? [])
    .map((n) => n.trim())
    .filter((n) => n && n !== primary);
  if (candidates.length === 0) {
    return { ...focus, activeSpeakingCast: [primary] };
  }
  const userMsg = (input.currentUserMessage ?? "").trim();
  const triggered = (input.triggeredEventText ?? "").trim();

  const nameVariants = (name: string): string[] => {
    const n = name.replace(/\s+/g, "");
    const out = [n];
    if (n.length >= 3) out.push(n.slice(-2));
    if (n.length >= 4) out.push(n.slice(-3));
    return out.filter((x) => x.length >= 2);
  };

  let best: string | null = null;
  let bestScore = -1;
  for (const name of candidates) {
    const variants = nameVariants(name);
    let score = 0;
    for (const v of variants) {
      if (userMsg.includes(v)) score += 3;
      if (triggered.includes(v)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  // Only add a supporting speaker if there is a positive signal (score > 0).
  const optional = bestScore > 0 && best ? [best] : [];
  return { ...focus, activeSpeakingCast: [primary, ...optional] };
}

/** Direct-speaking-cast line for single_primary only — replaces the old focus line. */
export function renderPrimaryFocusLine(focus: SceneCastFocus): string | null {
  if (focus.sceneCastMode !== "single_primary") return null;
  const cast = focus.activeSpeakingCast.filter((n) => n.trim());
  if (cast.length === 0) return null;
  const names = cast.join(", ");
  return `직접 발화 중심: ${names}. 메인 캐릭터와 유저의 현재 상호작용을 이어가며, 그 밖의 인물과 세계 정보는 서술·메시지·환경 변화로 통합한다.`;
}

function buildNextBeatHint(
  types: SceneProgressionType[],
  intensity: number,
  triggeredEventText?: string | null,
  castFocus?: SceneCastFocus | null
): string {
  if (triggeredEventText?.trim()) {
    return "이미 발생한 사건의 여파를 우선 이어가며 장면은 그 결과에 맞춰 자연스럽게 진행한다.";
  }
  const primary = types[0];
  const support = types[1];
  if (!primary) return HINT_BY_TYPE.environment;
  if (primary === "tactical_planning" && intensity >= 4) {
    return "현재 작전의 빈틈 하나가 드러나며 외부 요청이나 시간 압박이 조용히 끼어든다.";
  }
  const preferPrimaryFramedNpc =
    castFocus?.sceneCastMode === "single_primary" && primary === "npc_action";
  const primaryHint = preferPrimaryFramedNpc
    ? SINGLE_PRIMARY_NPC_ACTION_HINT
    : HINT_BY_TYPE[primary];
  if (
    support &&
    support !== primary &&
    (support === "relationship" || support === "environment" || support === "consequence")
  ) {
    const shortSupport =
      support === "relationship"
        ? "관계 온도도 살짝 움직인다"
        : support === "consequence"
          ? "직전 선택의 여파가 겹친다"
          : "장소 감각도 조금 바뀐다";
    return `${primaryHint.replace(/다\.$/, "고, ")}${shortSupport}.`;
  }
  return primaryHint;
}

let lastSelectionMeta: ProgressionSelectionMeta | null = null;

/** Test/harness helper — last buildSceneDirective selection telemetry. */
export function getLastProgressionSelectionMeta(): ProgressionSelectionMeta | null {
  return lastSelectionMeta;
}

/** Canonical execution contract — shared by full and compact Standard renderers. */
export function renderSceneExecutionContract(input: {
  motionDecision: SceneMotionDecision;
  progressionTypes: SceneProgressionType[];
  npcGrounding: NpcGroundingResult;
}): string {
  if (input.motionDecision === "HOLD") {
    return [
      "전개 필요: 없음 (현재 비트 유지)",
      "기존 NPC 행동: 없음",
      "새 인물 도입: 없음",
    ].join("\n");
  }

  const allowedSources = input.progressionTypes
    .map((type) => PROGRESSION_LABELS[type])
    .join(" + ");
  const existingNpc =
    input.npcGrounding.eligibleActorNames.length > 0
      ? input.npcGrounding.eligibleActorNames.join(", ")
      : "없음";
  const newNpc = input.npcGrounding.newNpcAllowed ? "트리거·명시적 도착만" : "없음";
  const npcAction =
    input.progressionTypes.includes("npc_action") && input.npcGrounding.existingNpcEligible
      ? `기존 NPC (${existingNpc})의 행동만`
      : "없음";

  return [
    `전개 필요: ${input.motionDecision === "MICRO_MOTION" ? "MICRO" : input.motionDecision === "ESCALATE" ? "ESCALATE" : "ADVANCE"}`,
    `허용된 변화: ${allowedSources || "현재 캐릭터·환경"}`,
    `기존 NPC 행동: ${npcAction}`,
    `새 인물 도입: ${newNpc}`,
  ].join("\n");
}

export function buildSceneDirective(input: SceneDirectiveInput): SceneDirective {
  const stagnation = analyzeStagnation(input.recentMessages);
  const recentStagnation = stagnation.recentStagnation;
  const baseCastFocus = resolveSceneCastFocus({
    contentKind: input.contentKind,
    primaryCharacterName: input.primaryCharacterName,
    party: input.party,
    establishedActiveCastNames: input.establishedActiveCastNames,
  });
  const castFocus = resolveActiveSpeakingCast(baseCastFocus, input);
  const recommendedIntensity = selectSceneIntensity({
    recentMessages: input.recentMessages,
    currentUserMessage: input.currentUserMessage,
    triggeredEventText: input.triggeredEventText,
    recentStagnation,
  });
  const groundingText = buildGroundingText({
    memoryText: input.memoryText,
    relationshipMemoryText: input.relationshipMemoryText,
    lorebookText: input.lorebookText,
  });
  const sceneSignalText = buildSceneSignalText({
    recentMessages: input.recentMessages,
    currentUserMessage: input.currentUserMessage,
    triggeredEventText: input.triggeredEventText,
  });
  const sceneKind = resolveSceneKind(sceneSignalText);
  const hasTrigger = Boolean(input.triggeredEventText?.trim());
  const userLedProgress = detectUserLedProgress({
    recentMessages: input.recentMessages,
    currentUserMessage: input.currentUserMessage,
  });
  const npcGrounding = resolveNpcGrounding({
    sceneSignalText,
    groundingText,
    triggeredEventText: input.triggeredEventText,
    currentUserMessage: input.currentUserMessage,
    knownSupportingCastNames: input.knownSupportingCastNames,
    activeSpeakingCast: castFocus.activeSpeakingCast,
  });
  const { decision: motionDecision, reasons: motionReasons } = resolveSceneMotionDecision({
    sceneKind,
    sceneCastMode: castFocus.sceneCastMode,
    intensity: recommendedIntensity,
    stagnant: recentStagnation,
    stagnationReasons: stagnation.reasons,
    hasTrigger,
    userLedProgress,
    mode: input.mode,
  });
  const { types: progressionTypes, meta } = selectProgressionTypesWeighted({
    sceneSignalText,
    groundingText,
    intensity: recommendedIntensity,
    stagnant: recentStagnation,
    triggeredEventText: input.triggeredEventText,
    chatId: input.chatId,
    currentTurn: input.currentTurn,
    progressionHistory: input.progressionHistory,
    sceneCastMode: castFocus.sceneCastMode,
    motionDecision,
    npcGrounding,
    knownSupportingCastNames: input.knownSupportingCastNames,
    activeSpeakingCast: castFocus.activeSpeakingCast,
    currentUserMessage: input.currentUserMessage,
  });
  lastSelectionMeta = meta;

  const userControl: SceneUserControl =
    input.mode === "auto_progression" ? "persona_based_dialogue_allowed" : "no_user_control";

  return {
    mode: input.mode,
    recentStagnation,
    recommendedIntensity,
    motionDecision,
    motionReasons,
    progressionTypes,
    avoid: buildAvoidList(input.mode, recommendedIntensity),
    nextBeatHint: sanitizeHint(
      buildNextBeatHint(
        progressionTypes,
        recommendedIntensity,
        input.triggeredEventText,
        castFocus
      )
    ),
    userControl,
    castFocus,
    npcGrounding,
  };
}

function renderIntensity(value: SceneDirective["recommendedIntensity"], stagnant: boolean): string {
  if (stagnant && value >= 1 && value <= 2) return `${value}~${Math.min(3, value + 1)}`;
  return String(value);
}

export function renderSceneDirectiveForPrompt(directive: SceneDirective): string {
  const modeLabel = directive.mode === "auto_progression" ? "자동진행" : "일반 RP";
  const progression =
    directive.progressionTypes.length > 0
      ? directive.progressionTypes.map((type) => PROGRESSION_LABELS[type]).join(" + ")
      : "없음 (현재 비트 유지)";
  const primaryFocusLine = renderPrimaryFocusLine(directive.castFocus);
  const executionContract = renderSceneExecutionContract({
    motionDecision: directive.motionDecision,
    progressionTypes: directive.progressionTypes,
    npcGrounding: directive.npcGrounding,
  });
  return [
    renderSceneEngineRule(directive.motionDecision),
    "",
    "[이번 턴 장면 지시 - 비공개]",
    `모드: ${modeLabel}`,
    `정체 감지: ${directive.recentStagnation ? "있음" : "없음"}`,
    `권장 강도: ${renderIntensity(directive.recommendedIntensity, directive.recentStagnation)}`,
    executionContract,
    `전개 방향: ${progression}`,
    `피할 것: ${directive.avoid.join(", ")}`,
    directive.nextBeatHint && directive.motionDecision !== "HOLD"
      ? `다음 장면 힌트: ${directive.nextBeatHint}`
      : "",
    primaryFocusLine ?? "",
    `유저 조종: ${USER_CONTROL_LABELS[directive.userControl]}`,
    directive.mode === "auto_progression" ? AUTO_PROGRESSION_ENSEMBLE_SCENE_RULE : "",
    "트리거된 사건 지시가 있으면 이번 턴 장면 지시보다 우선한다.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSceneDirectivePromptBlock(input: SceneDirectiveInput): string {
  return renderSceneDirectiveForPrompt(buildSceneDirective(input));
}
