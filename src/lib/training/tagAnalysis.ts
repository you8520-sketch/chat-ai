import { callGemini, DRAFT_FLASH_MODEL } from "@/lib/ai";
import { isAiTagAnalysisEnabled } from "./config";
import type { AnalysisCandidate, TagLabel, TagScore, TrainingTag } from "./types";
import { TRAINING_TAGS } from "./types";

const REASON_TO_TAG: Record<string, { tag: TrainingTag; delta: number }> = {
  speech_inconsistency: { tag: "speech_consistency", delta: -0.2 },
  character_break: { tag: "speech_consistency", delta: -0.15 },
  lore_break: { tag: "lore_consistency", delta: -0.2 },
  forced_romance: { tag: "forced_romance", delta: -0.25 },
  pacing_issue: { tag: "pacing", delta: -0.2 },
  user_over_control: { tag: "user_overcontrol", delta: -0.2 },
  unnatural_dialogue: { tag: "dialogue_realism", delta: -0.2 },
  repetition: { tag: "dialogue_realism", delta: -0.1 },
  bad_narration: { tag: "immersion_quality", delta: -0.15 },
  good_speech: { tag: "speech_consistency", delta: 0.2 },
  immersive_writing: { tag: "immersion_quality", delta: 0.2 },
  strong_characterization: { tag: "speech_consistency", delta: 0.15 },
  emotional_quality: { tag: "dialogue_realism", delta: 0.15 },
  good_pacing: { tag: "pacing", delta: 0.2 },
  atmosphere: { tag: "immersion_quality", delta: 0.15 },
  world_consistency: { tag: "lore_consistency", delta: 0.2 },
};

function scoreToLabel(score: number): TagLabel {
  if (score >= 0.6) return "positive";
  if (score <= 0.4) return "negative";
  return "neutral";
}

function heuristicTags(candidate: AnalysisCandidate): TagScore[] {
  const scores = new Map<TrainingTag, number>();
  for (const tag of TRAINING_TAGS) scores.set(tag, 0.5);

  for (const reasonId of candidate.reasons) {
    const mapping = REASON_TO_TAG[reasonId];
    if (!mapping) continue;
    const prev = scores.get(mapping.tag) ?? 0.5;
    scores.set(mapping.tag, Math.max(0, Math.min(1, prev + mapping.delta)));
  }

  if (candidate.completedTurns != null && candidate.completedTurns <= 1) {
    const prev = scores.get("first_turn_quality") ?? 0.5;
    if (candidate.vote === 1) scores.set("first_turn_quality", Math.min(1, prev + 0.2));
    else if (candidate.vote === -1) scores.set("first_turn_quality", Math.max(0, prev - 0.2));
    else if (candidate.qualityScore != null) {
      const adj = candidate.qualityScore > 0 ? 0.1 : candidate.qualityScore < 0 ? -0.1 : 0;
      scores.set("first_turn_quality", Math.max(0, Math.min(1, prev + adj)));
    }
  }

  if (candidate.isRefunded) {
    for (const tag of ["immersion_quality", "dialogue_realism"] as TrainingTag[]) {
      const prev = scores.get(tag) ?? 0.5;
      scores.set(tag, Math.max(0, prev - 0.15));
    }
  }

  if (candidate.regenerateCount >= 2) {
    const prev = scores.get("pacing") ?? 0.5;
    scores.set("pacing", Math.max(0, prev - 0.1));
  }

  if (candidate.vote === 1 && candidate.reasons.length === 0 && candidate.qualityScore != null) {
    const boost = candidate.qualityScore * 0.15;
    for (const tag of TRAINING_TAGS) {
      if (tag === "first_turn_quality" && candidate.completedTurns != null && candidate.completedTurns > 1) {
        continue;
      }
      const prev = scores.get(tag) ?? 0.5;
      scores.set(tag, Math.max(0, Math.min(1, prev + boost)));
    }
  }

  if (candidate.vote === -1 && candidate.reasons.length === 0) {
    for (const tag of TRAINING_TAGS) {
      const prev = scores.get(tag) ?? 0.5;
      scores.set(tag, Math.max(0, Math.min(1, prev - 0.1)));
    }
  }

  return TRAINING_TAGS.map((tag) => {
    const score = scores.get(tag) ?? 0.5;
    return { tag, score, label: scoreToLabel(score), source: "heuristic" as const };
  });
}

function summarizeContext(contextJson: string): string {
  try {
    const ctx = JSON.parse(contextJson) as Record<string, unknown>;
    const pick: Record<string, unknown> = {};
    for (const key of [
      "writingStyle",
      "completedTurns",
      "targetResponseChars",
      "route",
      "regenerate",
      "variantIndex",
      "truncatedMemory",
    ]) {
      if (ctx[key] != null) pick[key] = ctx[key];
    }
    return JSON.stringify(pick);
  } catch {
    return "{}";
  }
}

function needsAiRefinement(candidate: AnalysisCandidate, tags: TagScore[]): boolean {
  if (!isAiTagAnalysisEnabled()) return false;
  if (candidate.reasons.length > 0) return false;
  const borderline = tags.filter((t) => t.score > 0.35 && t.score < 0.65);
  return borderline.length >= 4;
}

async function refineTagsWithAi(
  candidate: AnalysisCandidate,
  base: TagScore[]
): Promise<TagScore[]> {
  const excerpt = candidate.content.slice(0, 1200);
  const contextSummary = summarizeContext(candidate.contextJson);
  const system = `You rate RP assistant messages on quality dimensions. Reply ONLY with compact JSON object mapping tag names to scores 0.0-1.0 (0.5=neutral). Tags: ${TRAINING_TAGS.join(", ")}.`;
  const user = `Vote: ${candidate.vote ?? "none"}\nQuality: ${candidate.qualityScore ?? "unknown"}\nContext: ${contextSummary}\nResponse excerpt:\n${excerpt}`;

  try {
    const { text } = await callGemini(system, [{ role: "user", content: user }], DRAFT_FLASH_MODEL);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return base;
    const parsed = JSON.parse(match[0]) as Record<string, number>;
    return TRAINING_TAGS.map((tag) => {
      const aiScore = parsed[tag];
      const baseTag = base.find((t) => t.tag === tag);
      if (typeof aiScore !== "number" || !Number.isFinite(aiScore)) return baseTag!;
      const blended = Math.max(0, Math.min(1, (baseTag!.score + aiScore) / 2));
      return { tag, score: blended, label: scoreToLabel(blended), source: "ai" as const };
    });
  } catch (e) {
    console.warn(`[training] AI tag refinement failed for message ${candidate.messageId}:`, e);
    return base;
  }
}

export async function analyzeMessageTags(candidate: AnalysisCandidate): Promise<TagScore[]> {
  const heuristic = heuristicTags(candidate);
  if (!needsAiRefinement(candidate, heuristic)) return heuristic;
  return refineTagsWithAi(candidate, heuristic);
}
