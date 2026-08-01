import type { ChatMsg } from "@/lib/ai";
import { AUTO_PROGRESSION_SCENE_USER_CONTROL } from "@/lib/autoProgressionRules";
import { NO_FALSE_SHARED_MEMORY_RULE } from "@/lib/noGodmodding";
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
};

export type SceneDirective = {
  mode: SceneDirectiveMode;
  recentStagnation: boolean;
  recommendedIntensity: 0 | 1 | 2 | 3 | 4 | 5;
  progressionTypes: SceneProgressionType[];
  avoid: string[];
  nextBeatHint?: string;
  userControl: SceneUserControl;
  /** Focus computed from settings — budget is never prompt-exposed. */
  castFocus: SceneCastFocus;
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
};

/** Internal telemetry — never rendered into the model prompt. */
export type ProgressionSelectionMeta = {
  sceneKind: SceneKind;
  eligible: SceneProgressionType[];
  weights: Partial<Record<SceneProgressionType, number>>;
  cooldownOverrides: string[];
  seed: string;
  pickCount: number;
};

export const SCENE_DIRECTIVE_VERSION = "world-motion-v1.1";

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

const BASE_SCENE_ENGINE_RULE = [
  "[PRIVATE SCENE ENGINE RULE]",
  "반복된 감정 확인에 멈추지 말고 관계, 단서, 환경, NPC, 세계 반응, 생활 변수, 이전 선택의 결과 중 하나를 조용히 움직인다.",
  "전개는 항상 전투나 대형 위기일 필요가 없다. 현재 모드와 유저 조종 범위를 따르고, 이 규칙을 본문에 언급하지 않는다.",
].join("\n");

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

export function detectSceneStagnation(recentMessages: ChatMsg[] | undefined): boolean {
  const recent = (recentMessages ?? []).slice(-8);
  if (recent.length < 4) return false;

  const assistantTurns = recent.filter((message) => message.role === "assistant");
  const userTurns = recent.filter((message) => message.role === "user");
  const reassuranceTerms = ["괜찮", "미안", "걱정", "말하지 않아도", "침묵"];
  const movementTerms = [
    "이동",
    "나가",
    "들어",
    "문",
    "전화",
    "메시지",
    "발견",
    "단서",
    "기록",
    "계획",
    "추적",
    "요청",
    "보고",
    "시작",
    "결정",
  ];

  const reassuranceCount = assistantTurns.filter((message) =>
    includesAny(message.content, reassuranceTerms)
  ).length;
  const shortUserReplies = userTurns.filter((message) => message.content.trim().length <= 12).length;
  const movementCount = countMatches(compactText(recent), movementTerms);
  const normalizedAssistant = assistantTurns.map((message) => normalizeForRepeat(message.content));
  const repeatedAssistant =
    normalizedAssistant.length >= 3 &&
    new Set(normalizedAssistant.filter(Boolean)).size <= Math.max(1, normalizedAssistant.length - 2);

  return (
    (reassuranceCount >= 2 && shortUserReplies >= 1) ||
    (shortUserReplies >= 3 && movementCount <= 1) ||
    repeatedAssistant
  );
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

function pickCountForIntensity(intensity: number, rng: () => number): number {
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
}): { types: SceneProgressionType[]; meta: ProgressionSelectionMeta } {
  const sceneKind = resolveSceneKind(input.sceneSignalText);
  const hasTrigger = Boolean(input.triggeredEventText?.trim());
  const dangerCue =
    includesAny(input.sceneSignalText, DANGER_TERMS) || sceneKind === "climax" || sceneKind === "operation";
  const npcGrounded =
    includesAny(input.sceneSignalText, NPC_GROUND_TERMS) ||
    includesAny(input.groundingText, NPC_GROUND_TERMS) ||
    (hasTrigger && includesAny(input.triggeredEventText || "", NPC_GROUND_TERMS));
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

  // single_primary: keep npc_action available, but prefer advancing the main interaction.
  if (input.sceneCastMode === "single_primary" && !hasTrigger) {
    const npc = weights.get("npc_action") ?? 0;
    if (npc > 0) weights.set("npc_action", npc * 0.55);
    weights.set("relationship", (weights.get("relationship") ?? 0) * 1.2);
    weights.set("daily_life", (weights.get("daily_life") ?? 0) * 1.15);
  }

  // Eligibility gates — zero unfit (memory/lore never force operation).
  if (sceneKind === "rest" || sceneKind === "neutral") {
    if (!dangerCue && !hasTrigger) {
      weights.set("tactical_planning", 0);
      // Quiet scenes: no ambient world crisis beat unless stagnant needs motion.
      if (!input.stagnant) weights.set("world_reaction", 0);
    }
    if (!npcGrounded) {
      weights.set("npc_action", 0);
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

  // Floor: ensure at least one eligible candidate.
  let eligible = ALL_PROGRESSION_TYPES.filter((t) => (weights.get(t) ?? 0) > 0);
  if (eligible.length === 0) {
    weights.set("environment", 1);
    weights.set("relationship", 1);
    eligible = ["environment", "relationship"];
  }

  const chatKey = input.chatId == null || input.chatId === "" ? "0" : String(input.chatId);
  const seedStr = `${chatKey}:${turn || 0}:${SCENE_DIRECTIVE_VERSION}`;
  const seed = hashSeed([seedStr]);
  const rng = createSeededRng(seed);
  const pickCount = Math.min(
    pickCountForIntensity(input.intensity, rng),
    eligible.length
  );

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
      eligible,
      weights: weightSnapshot,
      cooldownOverrides,
      seed: seedStr,
      pickCount,
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
    };
  }
  if (input.party === true) {
    const budget = Math.max(2, Math.min(6, castNames.length || 3));
    return {
      sceneCastMode: "ensemble",
      primaryCharacterName: primary,
      supportingCastBudget: budget,
    };
  }
  return {
    sceneCastMode: "single_primary",
    primaryCharacterName: primary,
    supportingCastBudget: 1,
  };
}

/** Positive focus line for single_primary only — never a ban list. */
export function renderPrimaryFocusLine(focus: SceneCastFocus): string | null {
  if (focus.sceneCastMode !== "single_primary") return null;
  const name = focus.primaryCharacterName?.trim();
  if (!name) return null;
  return `장면 중심: ${name}와 유저의 현재 상호작용. 세계 변화와 보조 인물은 이 상호작용을 전진시키는 범위에서 사용한다.`;
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

export function buildSceneDirective(input: SceneDirectiveInput): SceneDirective {
  const recentStagnation = detectSceneStagnation(input.recentMessages);
  const castFocus = resolveSceneCastFocus({
    contentKind: input.contentKind,
    primaryCharacterName: input.primaryCharacterName,
    party: input.party,
    establishedActiveCastNames: input.establishedActiveCastNames,
  });
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
  });
  lastSelectionMeta = meta;

  const userControl: SceneUserControl =
    input.mode === "auto_progression" ? "persona_based_dialogue_allowed" : "no_user_control";

  return {
    mode: input.mode,
    recentStagnation,
    recommendedIntensity,
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
  };
}

function renderIntensity(value: SceneDirective["recommendedIntensity"], stagnant: boolean): string {
  if (stagnant && value >= 1 && value <= 2) return `${value}~${Math.min(3, value + 1)}`;
  return String(value);
}

export function renderSceneDirectiveForPrompt(directive: SceneDirective): string {
  const modeLabel = directive.mode === "auto_progression" ? "자동진행" : "일반 RP";
  const progression = directive.progressionTypes.map((type) => PROGRESSION_LABELS[type]).join(" + ");
  const primaryFocusLine = renderPrimaryFocusLine(directive.castFocus);
  return [
    BASE_SCENE_ENGINE_RULE,
    "",
    "[이번 턴 장면 지시 - 비공개]",
    `모드: ${modeLabel}`,
    `정체 감지: ${directive.recentStagnation ? "있음" : "없음"}`,
    `권장 강도: ${renderIntensity(directive.recommendedIntensity, directive.recentStagnation)}`,
    `전개 방향: ${progression}`,
    `피할 것: ${directive.avoid.join(", ")}`,
    directive.nextBeatHint ? `다음 장면 힌트: ${directive.nextBeatHint}` : "",
    primaryFocusLine ?? "",
    `유저 조종: ${USER_CONTROL_LABELS[directive.userControl]}`,
    directive.mode === "auto_progression" ? AUTO_PROGRESSION_ENSEMBLE_SCENE_RULE : "",
    directive.mode === "auto_progression" ? NO_FALSE_SHARED_MEMORY_RULE : "",
    "트리거된 사건 지시가 있으면 이번 턴 장면 지시보다 우선한다.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSceneDirectivePromptBlock(input: SceneDirectiveInput): string {
  return renderSceneDirectiveForPrompt(buildSceneDirective(input));
}
