/**
 * Deterministic temporal nature for episodic facts (recall filtering).
 * No LLM calls. No product DB schema.
 */

import { readVerifiedEvidence } from "@/lib/memory/memory-episodic-evidence";

export type EpisodicFactTemporalNature =
  | "durable"
  | "historical_event"
  | "clearly_temporary"
  | "unknown";

/**
 * Exact attribute allowlist for clearly momentary scene state.
 * Do NOT match broad substrings like location / condition / status / state.
 */
export const CLEARLY_TEMPORARY_EPISODIC_ATTRIBUTES = new Set<string>([
  "current_emotion",
  "emotional_state",
  "current_mood",
  "current_action",
  "current_posture",
  "current_pose",
  "facial_expression",
  "current_expression",
  "current_gaze",
  "current_sensation",
  "scene_state",
  "temporary_condition",
  "current_weather",
  "current_time_of_day",
  "current_attitude",
  "current_hostility",
  "current_aggression",
  "current_possessiveness",
  "current_jealousy",
  "current_control_intent",
  "current_attachment",
  "current_relationship_tension",
]);

type TemporalFactInput = {
  category?: string | null;
  attribute?: string | null;
  value?: string | null;
  fact_text?: string | null;
  evidence_type?: string | null;
  /** Stored row metadata; carries the server-verified evidence quote and authority. */
  metadata?: string | null;
};

/** Completed scene events — distinct source turns must not collapse under latest-wins. */
export const COMPLETED_SCENE_EVENT_ATTRIBUTES = new Set<string>([
  "action",
  "response",
  "scene_event",
  "encounter_event",
  "role_direction",
]);

/**
 * Completed past event / transition narrative — preserve even if attribute is
 * on the temporary list (e.g. injury then recovery).
 * Conservative: requires explicit completed/result morphology.
 * Do NOT treat mere co-occurrence of "지만" + 이동/발견/중단/회복 as historical.
 */
function describesOngoingState(text: string): boolean {
  return (
    /(?:이동|치료|느끼|진행)\s*중(?:이다|이다)?/.test(text) ||
    /지금도\s*(?:느끼|하고|있다)/.test(text)
  );
}

export function looksLikeCompletedHistoricalEvent(factText: string): boolean {
  const t = factText.replace(/\s+/g, " ").trim();
  if (!t) return false;

  // Ongoing progressive / still-present state — never completed historical.
  if (describesOngoingState(t)) return false;

  // Explicit completed recovery after treatment / injury.
  if (/(?:치료\s*후|이후)\s*회복(?:함|했다|하였다)/.test(t)) return true;
  if (/(?:부상을\s*입었으나|다쳤으나).{0,40}회복(?:함|했다|하였다)/.test(t)) {
    return true;
  }
  // Completed discovery → relocation (requires completed 이동/떠남 morphology).
  if (
    /(?:발견한\s*뒤|단서를\s*발견(?:한\s*뒤|하고)).{0,40}(?:이동(?:함|했다|하였다)|떠났(?:다|습니다)?)/.test(
      t
    )
  ) {
    return true;
  }
  if (/다른\s*장소로\s*이동(?:함|했다|하였다)/.test(t)) return true;
  // Completed mission abort.
  if (/임무를\s*중단(?:함|했다|하였다)/.test(t)) return true;
  if (/회복(?:함|했다|하였다)\.?$/.test(t)) return true;
  return false;
}

const HANGUL_SYLLABLE_FIRST = 0xac00;
const HANGUL_SYLLABLE_COUNT = 11172;
/** Final consonant ㅆ: the past-tense marker 았/었/였/했 (also the stem 있 and the modal 겠). */
const HANGUL_FINAL_SSANG_SIOT = 20;

/**
 * The gloss closes on a past-tense action or change ("찔렸다", "접질렀다", "봉합되었다"),
 * i.e. it reports something that happened at its turn. A resultative/existential or
 * copula past ("변해 있었다", "인턴이었다"), any present form ("일한다", "앉아 있다")
 * and an intention ("돌아오겠다") describe a state, which later values of the same key replace.
 */
export function looksLikeCompletedOccurrence(factText: string): boolean {
  const t = factText.replace(/[\s.。!?"'”’)]+$/u, "");
  if (t.length < 2 || !t.endsWith("다") || describesOngoingState(t)) return false;
  const syllable = t.charCodeAt(t.length - 2) - HANGUL_SYLLABLE_FIRST;
  if (syllable < 0 || syllable >= HANGUL_SYLLABLE_COUNT) return false;
  if (syllable % 28 !== HANGUL_FINAL_SSANG_SIOT) return false;
  if (/(?:있|겠|있었|없었)다$/u.test(t)) return false;
  if (/(?:이었|였)다$/u.test(t) && !/하였다$/u.test(t)) return false;
  return true;
}

/**
 * A scene record whose quote the server matched to the assistant scene or the user's
 * message. A character's word does not count.
 */
export function isVerifiedSceneRecord(fact: TemporalFactInput): boolean {
  if (String(fact.evidence_type ?? "").trim().toLowerCase() !== "explicit_scene_event") return false;
  const evidence = readVerifiedEvidence(fact.metadata);
  return evidence != null && evidence.authority !== "CHARACTER_CLAIM";
}

/**
 * Its attribute and wording alone do not make it history or durable, so its standing as a
 * kept occurrence rests on the verified source. An explicit user statement of the same key
 * made later outranks that source.
 */
export function isUserCorrectableSceneRecord(fact: TemporalFactInput): boolean {
  return classifyIntrinsicNature(fact) === "unknown" && isVerifiedSceneRecord(fact);
}

/**
 * Pure classifier — character/world/genre agnostic.
 *
 * clearly_temporary: exact temporary attribute AND not a completed historical event.
 * historical_event: completed event/outcome narrative, or a source-verified scene
 *   occurrence (eligible for long-term recall; a later separate occurrence of the same
 *   key does not replace it).
 * durable: preference/rule/quest (or clear durable attribute prefix).
 * unknown: conservatively eligible for recall (not blocked).
 */
export function classifyEpisodicFactTemporalNature(
  fact: TemporalFactInput
): EpisodicFactTemporalNature {
  const nature = classifyIntrinsicNature(fact);
  // The extractor files observed occurrences under free-form attributes (`injury`,
  // `ability_use`, ...). Legacy rows, claims and state-shaped glosses keep latest-wins.
  if (
    nature === "unknown" &&
    looksLikeCompletedOccurrence(String(fact.fact_text ?? "")) &&
    isVerifiedSceneRecord(fact)
  ) {
    return "historical_event";
  }
  return nature;
}

function classifyIntrinsicNature(fact: TemporalFactInput): EpisodicFactTemporalNature {
  const attribute = String(fact.attribute ?? "")
    .trim()
    .toLowerCase();
  const category = String(fact.category ?? "")
    .trim()
    .toLowerCase();
  const factText = String(fact.fact_text ?? "");

  if (CLEARLY_TEMPORARY_EPISODIC_ATTRIBUTES.has(attribute)) {
    if (looksLikeCompletedHistoricalEvent(factText)) return "historical_event";
    return "clearly_temporary";
  }

  if (looksLikeCompletedHistoricalEvent(factText)) return "historical_event";

  const evidenceType = String(fact.evidence_type ?? "")
    .trim()
    .toLowerCase();
  if (
    evidenceType === "explicit_scene_event" &&
    COMPLETED_SCENE_EVENT_ATTRIBUTES.has(attribute)
  ) {
    return "historical_event";
  }

  if (category === "preference" || category === "rule" || category === "quest") {
    return "durable";
  }
  if (
    attribute === "speech_style" ||
    attribute.startsWith("favorite_") ||
    attribute.startsWith("preference_") ||
    attribute.startsWith("commitment_") ||
    attribute.startsWith("ownership_")
  ) {
    return "durable";
  }

  return "unknown";
}

export function isClearlyTemporaryEpisodicFact(fact: TemporalFactInput): boolean {
  return classifyEpisodicFactTemporalNature(fact) === "clearly_temporary";
}
