/**
 * Deterministic temporal nature for episodic facts (recall filtering).
 * No LLM calls. No product DB schema.
 */

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
]);

type TemporalFactInput = {
  category?: string | null;
  attribute?: string | null;
  value?: string | null;
  fact_text?: string | null;
};

/**
 * Completed past event / transition narrative — preserve even if attribute is
 * on the temporary list (e.g. injury then recovery).
 * Conservative: requires explicit completed/result morphology.
 * Do NOT treat mere co-occurrence of "지만" + 이동/발견/중단/회복 as historical.
 */
export function looksLikeCompletedHistoricalEvent(factText: string): boolean {
  const t = factText.replace(/\s+/g, " ").trim();
  if (!t) return false;

  // Ongoing progressive / still-present state — never completed historical.
  if (
    /(?:이동|치료|느끼|진행)\s*중(?:이다|이다)?/.test(t) ||
    /지금도\s*(?:느끼|하고|있다)/.test(t)
  ) {
    return false;
  }

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

/**
 * Pure classifier — character/world/genre agnostic.
 *
 * clearly_temporary: exact temporary attribute AND not a completed historical event.
 * historical_event: completed event/outcome narrative (eligible for long-term recall).
 * durable: preference/rule/quest (or clear durable attribute prefix).
 * unknown: conservatively eligible for recall (not blocked).
 */
export function classifyEpisodicFactTemporalNature(
  fact: TemporalFactInput
): EpisodicFactTemporalNature {
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
