/**
 * Zero-cost immersive generation-preparation UI helpers.
 * Allowlisted badges only — never serialize directive prose / nextBeatHint / secrets.
 */

import type { ChatRuntimeMode } from "@/lib/chatRuntimeMode";
import type { SceneProgressionType } from "@/lib/sceneDirective";

export type GenerationSceneBadge =
  | "reaction"
  | "relationship"
  | "dialogue"
  | "action"
  | "combat"
  | "investigation"
  | "world"
  | "calm"
  | "tense"
  | "urgent";

export type GenerationPreparationPhase = "preparing" | "composing";

export type GenerationPreparationUiPayload = {
  phase: GenerationPreparationPhase;
  badges: GenerationSceneBadge[];
};

export const GENERATION_SCENE_BADGE_LABELS: Record<GenerationSceneBadge, string> = {
  reaction: "반응 중심",
  relationship: "인물 관계",
  dialogue: "대화",
  action: "행동",
  combat: "전투",
  investigation: "탐색",
  world: "세계관",
  calm: "잔잔함",
  tense: "긴장감",
  urgent: "긴박함",
};

const BADGE_ALLOWLIST = new Set<string>(Object.keys(GENERATION_SCENE_BADGE_LABELS));

const PROGRESSION_TO_BADGE: Partial<Record<SceneProgressionType, GenerationSceneBadge>> = {
  relationship: "relationship",
  lore_clue: "investigation",
  tactical_planning: "action",
  npc_action: "action",
  world_reaction: "world",
  environment: "world",
  daily_life: "calm",
  // consequence / comedy — omit (too vague or meta)
};

export type DeriveGenerationPreparationUiInput = {
  runtimeMode?: ChatRuntimeMode | null;
  progressionTypes?: readonly SceneProgressionType[] | null;
  recommendedIntensity?: number | null;
  /** Optional abstract phase; default preparing */
  phase?: GenerationPreparationPhase;
};

function intensityToneBadge(intensity: number | null | undefined): GenerationSceneBadge | null {
  if (intensity == null || !Number.isFinite(intensity)) return null;
  if (intensity >= 4) return "urgent";
  if (intensity >= 2) return "tense";
  if (intensity <= 1) return "calm";
  return null;
}

/** Map already-computed server signals → UI-safe badges (max 3). */
export function deriveGenerationPreparationUi(
  input: DeriveGenerationPreparationUiInput
): GenerationPreparationUiPayload {
  const badges: GenerationSceneBadge[] = [];
  const push = (b: GenerationSceneBadge | null | undefined) => {
    if (!b || badges.includes(b) || badges.length >= 3) return;
    badges.push(b);
  };

  if (input.runtimeMode === "interactive") {
    push("reaction");
  }

  for (const t of input.progressionTypes ?? []) {
    push(PROGRESSION_TO_BADGE[t]);
  }

  const tone = intensityToneBadge(input.recommendedIntensity);
  // Prefer scene foci over a second calm when daily_life already added calm.
  if (tone && !(tone === "calm" && badges.includes("calm"))) {
    push(tone);
  }

  return {
    phase: input.phase === "composing" ? "composing" : "preparing",
    badges,
  };
}

/** Strip unknown / unsafe values from wire payloads (Network-tab safe). */
export function sanitizeGenerationPreparationUi(
  raw: unknown
): GenerationPreparationUiPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const phase: GenerationPreparationPhase =
    obj.phase === "composing" ? "composing" : "preparing";
  const badgesIn = Array.isArray(obj.badges) ? obj.badges : [];
  const badges: GenerationSceneBadge[] = [];
  for (const b of badgesIn) {
    if (typeof b !== "string" || !BADGE_ALLOWLIST.has(b)) continue;
    if (!badges.includes(b as GenerationSceneBadge)) {
      badges.push(b as GenerationSceneBadge);
    }
    if (badges.length >= 3) break;
  }
  return { phase, badges };
}

export function generationPreparationTitle(phase: GenerationPreparationPhase): string {
  return phase === "composing" ? "이야기를 구성하고 있어요" : "장면을 준비하고 있어요";
}

export function generationPreparationSubtitle(phase: GenerationPreparationPhase): string {
  return phase === "composing"
    ? "현재 장면에 맞춰 다음 반응을 준비하는 중..."
    : "캐릭터와 장면의 흐름을 구성하는 중...";
}
