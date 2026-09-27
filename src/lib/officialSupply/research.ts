import type { CharacterGenre } from "@/lib/characterGenres";
import { qaResult, type QaIssue, type QaResult } from "@/lib/officialSupply/types";

export type ResearchAutomationPolicy = "allows_automation" | "restricts_automation" | "unclear" | "not_checked";
export type ResearchCollectionMethod = "manual_curated" | "automated";

export type ResearchPlatform = {
  name: string;
  region: "KR" | "GLOBAL";
  url: string;
  automationPolicy: ResearchAutomationPolicy;
  collectionMethod: ResearchCollectionMethod;
  notes: string;
};

/** Trope-level public signal. Full prompts, greetings, lorebooks or images are never stored. */
export type ResearchSignal = {
  /** Stable key so market-fit briefs can cite the exact signal they build on. */
  signalId: string;
  source: string;
  sourceUrl: string;
  region: "KR" | "GLOBAL";
  genre: string;
  audience: "female_oriented" | "male_oriented" | "mixed";
  relationshipTrope: string | null;
  archetype: string | null;
  worldMechanic: string | null;
  scenarioHook: string;
  visualDirection: string | null;
  popularitySignal: "top" | "mid" | "niche";
  adultDemand: boolean;
  seasonal: string | null;
  /**
   * False for signals whose identity comes from a franchise, real person or
   * derivative UGC (webtoon/anime/game/idol IP). Such rows still count for
   * popularity analysis but never feed official character generation.
   */
  originalityEligible: boolean;
  ipExclusionReason: string | null;
  /** Publicly observed character name, only for exact-collision QA. Null when unrecorded. */
  observedCharacterName?: string | null;
};

/**
 * Abstract visual-trend observation (card/RP art direction). Attribute words
 * only — never an image, image URL, artist, work or character identity. Feeds
 * the style-board human review, never an image provider.
 */
export type ResearchVisualTrend = {
  trendId: string;
  /** Platform names from `platforms` where the trait was observed. */
  platforms: string[];
  appliesTo: "card" | "rp" | "all";
  observation: string;
};

export type ResearchSnapshot = {
  observedAt: string;
  platforms: ResearchPlatform[];
  signals: ResearchSignal[];
  visualTrends?: ResearchVisualTrend[];
};

export const RESEARCH_VISUAL_TREND_MAX_CHARS = 160;
const VISUAL_TREND_FORBIDDEN_RE = /(https?:\/\/|\.(?:png|jpe?g|webp|gif)\b|작가\s*풍|화풍\s*복제|in the style of|style of\s+\S+|artist:)/i;

const FORBIDDEN_SIGNAL_KEYS = [
  "systemPrompt",
  "system_prompt",
  "greeting",
  "greetingText",
  "lorebook",
  "prompt",
  "fullText",
  "imageData",
] as const;

export const RESEARCH_HOOK_MAX_CHARS = 120;

/**
 * Automation permission and the chosen collection method are separate: manual
 * curation is always allowed; automation only where the source explicitly allows it.
 */
export function isCollectionMethodAllowed(
  policy: ResearchAutomationPolicy,
  method: ResearchCollectionMethod
): boolean {
  switch (method) {
    case "manual_curated":
      return true;
    case "automated":
      return policy === "allows_automation";
    default: {
      const exhaustive: never = method;
      throw new Error(`Unknown collection method ${String(exhaustive)}`);
    }
  }
}

export function validateResearchSnapshot(snapshot: ResearchSnapshot): QaResult {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.observedAt)) {
    errors.push({ code: "observed_at_invalid", message: "observedAt must be YYYY-MM-DD" });
  }
  for (const platform of snapshot.platforms) {
    if (!isCollectionMethodAllowed(platform.automationPolicy, platform.collectionMethod)) {
      errors.push({
        code: "collection_method_not_allowed",
        message: `${platform.name}: ${platform.collectionMethod} with automation policy ${platform.automationPolicy}`,
      });
    }
  }
  const seenIds = new Set<string>();
  snapshot.signals.forEach((signal, index) => {
    const at = `signal[${index}]`;
    const record = signal as unknown as Record<string, unknown>;
    for (const key of FORBIDDEN_SIGNAL_KEYS) {
      if (key in record) errors.push({ code: "forbidden_signal_field", message: `${at}.${key} must not be stored` });
    }
    if (typeof signal.signalId !== "string" || !signal.signalId.trim()) {
      errors.push({ code: "signal_id_missing", message: `${at} needs a stable signalId` });
    } else if (seenIds.has(signal.signalId)) {
      errors.push({ code: "signal_id_duplicate", message: `${at} duplicates ${signal.signalId}` });
    } else {
      seenIds.add(signal.signalId);
    }
    if (typeof signal.originalityEligible !== "boolean") {
      errors.push({ code: "originality_flag_missing", message: `${at} needs originalityEligible` });
    } else if (!signal.originalityEligible && !signal.ipExclusionReason?.trim()) {
      errors.push({ code: "ip_exclusion_reason_missing", message: `${at} is IP-excluded without a reason` });
    }
    if (!/^https?:\/\//.test(signal.sourceUrl)) {
      errors.push({ code: "source_url_invalid", message: `${at} needs a public source URL` });
    }
    if (signal.scenarioHook.length > RESEARCH_HOOK_MAX_CHARS) {
      errors.push({ code: "hook_too_long", message: `${at} scenarioHook must stay trope-level` });
    }
  });
  const platformNames = new Set(snapshot.platforms.map((p) => p.name));
  const trendIds = new Set<string>();
  (snapshot.visualTrends ?? []).forEach((trend, index) => {
    const at = `visualTrends[${index}]`;
    if (!trend.trendId?.trim() || trendIds.has(trend.trendId)) {
      errors.push({ code: "visual_trend_id_invalid", message: `${at} needs a unique trendId` });
    }
    trendIds.add(trend.trendId);
    for (const name of trend.platforms) {
      if (!platformNames.has(name)) errors.push({ code: "visual_trend_platform_unknown", message: `${at}: ${name}` });
    }
    if (trend.observation.length > RESEARCH_VISUAL_TREND_MAX_CHARS || VISUAL_TREND_FORBIDDEN_RE.test(trend.observation)) {
      errors.push({ code: "visual_trend_not_abstract", message: `${at} must be a short attribute-level observation` });
    }
  });
  const niche = snapshot.signals.filter((s) => s.popularitySignal === "niche").length;
  if (snapshot.signals.length > 0 && niche === 0) {
    warnings.push({ code: "no_niche_signals", message: "snapshot only covers top/mid signals" });
  }
  return qaResult(errors, warnings);
}

/**
 * Portfolio policy is always supplied by the batch configuration — the
 * pipeline hardcodes no adult/general ratio.
 */
export type OfficialPortfolioPolicy = {
  adultShareMin: number;
  adultShareMax: number;
  maxGenreShare: number;
  minDistinctGenres: number;
};

export type PortfolioEntry = { draftKey: string; primaryGenre: CharacterGenre; nsfw: boolean };

export function evaluatePortfolioBalance(
  entries: readonly PortfolioEntry[],
  policy: OfficialPortfolioPolicy
): QaResult {
  const errors: QaIssue[] = [];
  if (entries.length === 0) return qaResult([]);
  const adultShare = entries.filter((e) => e.nsfw).length / entries.length;
  if (adultShare < policy.adultShareMin || adultShare > policy.adultShareMax) {
    errors.push({
      code: "portfolio_adult_share",
      message: `adult share ${adultShare.toFixed(2)} outside ${policy.adultShareMin}-${policy.adultShareMax}`,
    });
  }
  const byGenre = new Map<string, number>();
  for (const entry of entries) byGenre.set(entry.primaryGenre, (byGenre.get(entry.primaryGenre) ?? 0) + 1);
  if (byGenre.size < policy.minDistinctGenres) {
    errors.push({ code: "portfolio_genre_count", message: `${byGenre.size} genres < ${policy.minDistinctGenres}` });
  }
  for (const [genre, count] of byGenre) {
    if (count / entries.length > policy.maxGenreShare) {
      errors.push({ code: "portfolio_genre_share", message: `${genre} is ${(count / entries.length).toFixed(2)} of the batch` });
    }
  }
  return qaResult(errors);
}

export type CastGender = "male" | "female" | "other";
export type CastGenderMix = Record<CastGender, number>;

/**
 * Batch-scoped playable-cast intent (manifest config). A female-oriented rofan
 * batch, a BL batch, a GL batch and an ensemble sim each declare their own mix;
 * nothing here defaults to a balanced or genre-derived gender split.
 */
export type OfficialCastIntent = {
  targetAudience: "female_oriented" | "male_oriented" | "mixed";
  /** Who the playable romance targets are for this batch, in plain words. */
  romanceTargetProfile: string;
  desiredGenderMix: CastGenderMix;
  /** Market rationale (snapshot signalIds and/or reviewer notes). */
  rationale: string;
};

export function castGenderCounts(genders: readonly CastGender[]): CastGenderMix {
  const counts: CastGenderMix = { male: 0, female: 0, other: 0 };
  for (const g of genders) counts[g] += 1;
  return counts;
}

export function formatCastGenderMix(mix: CastGenderMix): string {
  return `남성 ${mix.male}명, 여성 ${mix.female}명, 기타 ${mix.other}명`;
}

/** The generated cast must match the batch's declared mix exactly. */
export function evaluateCastIntent(genders: readonly CastGender[], intent: OfficialCastIntent): QaResult {
  const actual = castGenderCounts(genders);
  const errors: QaIssue[] = [];
  const planned = intent.desiredGenderMix.male + intent.desiredGenderMix.female + intent.desiredGenderMix.other;
  if (planned !== genders.length) {
    errors.push({ code: "cast_intent_size", message: `intent plans ${planned} slots, cast has ${genders.length}` });
  }
  for (const g of ["male", "female", "other"] as const) {
    if (actual[g] !== intent.desiredGenderMix[g]) {
      errors.push({ code: "cast_intent_gender_mix", message: `${g}: ${actual[g]} ≠ intended ${intent.desiredGenderMix[g]}` });
    }
  }
  return qaResult(errors);
}

/** True for batches that intend one gender only (e.g. a BL or GL batch). */
export function isSingleGenderIntent(intent: OfficialCastIntent): boolean {
  return Object.values(intent.desiredGenderMix).filter((n) => n > 0).length === 1;
}
