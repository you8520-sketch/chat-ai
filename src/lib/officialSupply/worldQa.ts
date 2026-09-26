import {
  CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT,
  normalizeCreatorLorebookUnit,
} from "@/lib/creatorLorebook";
import {
  qaResult,
  type OfficialCharacterDraft,
  type OfficialWorldLorebookEntry,
  type QaIssue,
  type QaResult,
} from "@/lib/officialSupply/types";

function compact(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

function bigrams(text: string): Set<string> {
  const s = compact(text);
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** Character-bigram Jaccard — language-agnostic, deterministic, good enough for Korean prose overlap. */
export function textSimilarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const gram of A) if (B.has(gram)) shared += 1;
  return shared / (A.size + B.size - shared);
}

/** Share of `needle` bigrams present in `haystack` — detects a short secret paraphrased inside long text. */
export function textContainment(needle: string, haystack: string): number {
  const N = bigrams(needle);
  const H = bigrams(haystack);
  if (N.size === 0) return 0;
  let shared = 0;
  for (const gram of N) if (H.has(gram)) shared += 1;
  return shared / N.size;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

export function nameSimilarity(a: string, b: string): number {
  const x = compact(a);
  const y = compact(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

export const DIVERSITY_THRESHOLDS = {
  nameSimilarity: 0.67,
  greetingSimilarity: 0.45,
  coreSimilarity: 0.55,
  archetypeRepeatWarn: 3,
  tropeRepeatWarn: 3,
  occupationRepeatWarn: 3,
} as const;

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value.trim();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Same-world diversity QA: no near-duplicate names/greetings, no clones that
 * differ only by hair colour (same archetype + trope + occupation or near-identical core).
 */
export function evaluateWorldDiversity(drafts: readonly OfficialCharacterDraft[]): QaResult {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  for (let i = 0; i < drafts.length; i++) {
    for (let j = i + 1; j < drafts.length; j++) {
      const a = drafts[i]!;
      const b = drafts[j]!;
      const pair = `${a.draftKey}/${b.draftKey}`;
      if (nameSimilarity(a.name, b.name) >= DIVERSITY_THRESHOLDS.nameSimilarity) {
        errors.push({ code: "near_duplicate_name", message: `${pair}: ${a.name} ~ ${b.name}` });
      }
      if (textSimilarity(a.greeting, b.greeting) >= DIVERSITY_THRESHOLDS.greetingSimilarity) {
        errors.push({ code: "near_duplicate_greeting", message: `${pair}: greetings overlap` });
      }
      if (
        textSimilarity(a.sections.characterCore, b.sections.characterCore) >=
        DIVERSITY_THRESHOLDS.coreSimilarity
      ) {
        errors.push({ code: "clone_character_core", message: `${pair}: character cores overlap` });
      }
      if (
        a.hook.archetype.trim() === b.hook.archetype.trim() &&
        a.hook.relationshipTrope.trim() === b.hook.relationshipTrope.trim() &&
        a.hook.occupation.trim() === b.hook.occupation.trim()
      ) {
        errors.push({ code: "clone_hook", message: `${pair}: same archetype + trope + occupation` });
      }
    }
  }
  const repeats: Array<[string, Map<string, number>, number]> = [
    ["archetype_repeated", countBy(drafts.map((d) => d.hook.archetype)), DIVERSITY_THRESHOLDS.archetypeRepeatWarn],
    ["trope_repeated", countBy(drafts.map((d) => d.hook.relationshipTrope)), DIVERSITY_THRESHOLDS.tropeRepeatWarn],
    ["occupation_repeated", countBy(drafts.map((d) => d.hook.occupation)), DIVERSITY_THRESHOLDS.occupationRepeatWarn],
  ];
  for (const [code, counts, limit] of repeats) {
    for (const [value, count] of counts) {
      if (count >= limit) warnings.push({ code, message: `${value} ×${count}` });
    }
  }
  if (drafts.length >= 4 && new Set(drafts.map((d) => d.gender)).size === 1) {
    warnings.push({ code: "single_gender_world", message: "every playable character shares one gender" });
  }
  return qaResult(errors, warnings);
}

export type OriginalityCorpusEntry = {
  source: string;
  name?: string;
  tagline?: string;
  greeting?: string;
  phrases?: string[];
  terms?: string[];
};

export const ORIGINALITY_THRESHOLDS = {
  name: 0.8,
  tagline: 0.5,
  greeting: 0.4,
  phrase: 0.6,
} as const;

/**
 * Originality guard against observed external material. Generic tropes pass;
 * distinctive expressions (names, taglines, greetings, phrases, coined terms) do not.
 */
export function evaluateOriginality(
  draft: OfficialCharacterDraft,
  corpus: readonly OriginalityCorpusEntry[],
  worldTerms: readonly string[] = []
): QaResult {
  const errors: QaIssue[] = [];
  const sheet = [
    draft.sections.worldAndSituation,
    draft.sections.characterCore,
    draft.sections.relationshipsAndDrives,
    draft.sections.extraCanon,
  ].join("\n");
  for (const entry of corpus) {
    if (entry.name && nameSimilarity(draft.name, entry.name) >= ORIGINALITY_THRESHOLDS.name) {
      errors.push({ code: "competitor_name", message: `${draft.name} ~ ${entry.source}` });
    }
    if (entry.tagline && textSimilarity(draft.tagline, entry.tagline) >= ORIGINALITY_THRESHOLDS.tagline) {
      errors.push({ code: "competitor_tagline", message: `tagline overlaps ${entry.source}` });
    }
    if (entry.greeting && textSimilarity(draft.greeting, entry.greeting) >= ORIGINALITY_THRESHOLDS.greeting) {
      errors.push({ code: "competitor_greeting", message: `greeting overlaps ${entry.source}` });
    }
    for (const phrase of entry.phrases ?? []) {
      if (phrase.trim().length >= 8 && compact(sheet).includes(compact(phrase))) {
        errors.push({ code: "competitor_phrase", message: `verbatim phrase from ${entry.source}` });
      }
    }
    for (const term of entry.terms ?? []) {
      if (worldTerms.some((own) => compact(own) === compact(term))) {
        errors.push({ code: "competitor_world_term", message: `world term "${term}" from ${entry.source}` });
      }
    }
  }
  return qaResult(errors);
}

/** Coined world terms must not repeat across different world packs. */
export function evaluateWorldTermCollisions(worlds: ReadonlyArray<{ worldKey: string; terms: string[] }>): QaResult {
  const errors: QaIssue[] = [];
  const owner = new Map<string, string>();
  for (const world of worlds) {
    for (const term of world.terms) {
      const key = compact(term);
      if (!key) continue;
      const existing = owner.get(key);
      if (existing && existing !== world.worldKey) {
        errors.push({ code: "world_term_collision", message: `"${term}" used by ${existing} and ${world.worldKey}` });
      }
      owner.set(key, world.worldKey);
    }
  }
  return qaResult(errors);
}

export const SECRET_LEAK_CONTAINMENT = 0.7;

/** Wording that marks hidden canon — never valid in a shared, all-characters lorebook. */
const HIDDEN_KNOWLEDGE_RE = /(숨겨진|비밀|정체를\s*숨|진짜\s*정체|사실은|혈통|출생의\s*비밀|속마음|흑막|훗날|미래에|장차|결국\s*\S+하게\s*된다)/;

/**
 * Same-world shared lorebook boundary: only public, knowable facts. Each entry
 * must be valid for the canonical creator lorebook owner, and must not leak any
 * character's declared secrets.
 */
export function evaluateSharedLorebook(
  entries: readonly OfficialWorldLorebookEntry[],
  drafts: readonly OfficialCharacterDraft[]
): QaResult {
  const errors: QaIssue[] = [];
  if (entries.length > CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT) {
    errors.push({
      code: "lorebook_attach_limit",
      message: `${entries.length} entries > canonical attach limit ${CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT}`,
    });
  }
  const secrets = drafts.flatMap((draft) => draft.secrets.map((secret) => ({ draft, secret })));
  for (const entry of entries) {
    const unit = normalizeCreatorLorebookUnit({ keywords: entry.keywords, content: entry.content });
    if (!unit.ok) errors.push({ code: "lorebook_unit_invalid", message: `${entry.entryKey}: ${unit.error}` });
    if (!entry.name.trim()) errors.push({ code: "lorebook_name_missing", message: `${entry.entryKey}: name required` });
    if (HIDDEN_KNOWLEDGE_RE.test(entry.content)) {
      errors.push({ code: "lorebook_hidden_knowledge", message: `${entry.entryKey}: hidden/future knowledge wording` });
    }
    for (const { draft, secret } of secrets) {
      if (!secret.trim()) continue;
      if (textContainment(secret, entry.content) >= SECRET_LEAK_CONTAINMENT) {
        errors.push({ code: "lorebook_secret_leak", message: `${entry.entryKey} leaks a secret of ${draft.draftKey}` });
      }
    }
  }
  return qaResult(errors);
}
