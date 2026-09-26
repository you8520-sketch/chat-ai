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
};

export type ResearchSnapshot = {
  observedAt: string;
  platforms: ResearchPlatform[];
  signals: ResearchSignal[];
};

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
  snapshot.signals.forEach((signal, index) => {
    const at = `signal[${index}]`;
    const record = signal as unknown as Record<string, unknown>;
    for (const key of FORBIDDEN_SIGNAL_KEYS) {
      if (key in record) errors.push({ code: "forbidden_signal_field", message: `${at}.${key} must not be stored` });
    }
    if (!/^https?:\/\//.test(signal.sourceUrl)) {
      errors.push({ code: "source_url_invalid", message: `${at} needs a public source URL` });
    }
    if (signal.scenarioHook.length > RESEARCH_HOOK_MAX_CHARS) {
      errors.push({ code: "hook_too_long", message: `${at} scenarioHook must stay trope-level` });
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
