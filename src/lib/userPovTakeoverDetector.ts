/**
 * USER_POV_TAKEOVER — log/metric only.
 * Flags repeated [B]-centered internal narration on auto-progression turns.
 * No auto-delete, rewrite, or length mutation.
 */

export type UserPovTakeoverDetection = {
  flagged: boolean;
  reason: string | null;
  matchedCount: number;
  sampleMatches: string[];
};

const INTERNAL_PATTERN_SOURCES = [
  "생각했다",
  "깨달았다",
  "결심했다",
  "원했다",
  "느꼈다",
  "믿었다",
  "다짐했다",
  "떠올렸다",
  "기억했다",
  "마음속으로",
  "속으로",
  "자신도 몰랐다",
  "임을 알았다",
  "라는 걸 알았다",
  "것을 알았다",
] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function buildAliasPatterns(aliases: string[]): RegExp[] {
  const names = aliases.map((a) => a.trim()).filter((a) => a.length >= 1);
  const patterns: RegExp[] = [];
  for (const name of names) {
    const e = escapeRegExp(name);
    patterns.push(new RegExp(`${e}\\s*(?:는|은|이|가|의|도|만)`, "g"));
    patterns.push(new RegExp(`(?:^|[\\s"'「『])${e}(?:$|[\\s"'」』,.!?…])`, "gm"));
  }
  // Generic [B] / {{user}} markers
  patterns.push(/\[B\]\s*(?:는|은|이|가|의)?/g);
  patterns.push(/\{\{user\}\}/gi);
  return patterns;
}

function countInternalHits(paragraph: string): { count: number; samples: string[] } {
  const samples: string[] = [];
  let count = 0;
  for (const phrase of INTERNAL_PATTERN_SOURCES) {
    if (paragraph.includes(phrase)) {
      count += 1;
      if (samples.length < 6) samples.push(phrase);
    }
  }
  // Quoted inner monologue heuristic: short quoted clause after think-ish stem
  if (/(?:속으로|마음속으로|혼자)\s*[\u201c\u201d"「『].{2,80}[\u201c\u201d"」』]/.test(paragraph)) {
    count += 1;
    if (samples.length < 6) samples.push("quoted_inner_monologue");
  }
  return { count, samples };
}

function paragraphMentionsUser(paragraph: string, aliasPatterns: RegExp[]): boolean {
  for (const re of aliasPatterns) {
    re.lastIndex = 0;
    if (re.test(paragraph)) return true;
  }
  return false;
}

/**
 * Detect multi-paragraph [B] POV / internal takeover.
 * Single external action lines do not flag.
 */
export function detectUserPovTakeover(
  text: string,
  opts?: { userAliases?: string[]; mode?: "auto_progression" | string }
): UserPovTakeoverDetection {
  if (opts?.mode && opts.mode !== "auto_progression") {
    return { flagged: false, reason: null, matchedCount: 0, sampleMatches: [] };
  }

  const prose = text.trim();
  if (!prose) {
    return { flagged: false, reason: null, matchedCount: 0, sampleMatches: [] };
  }

  const paragraphs = splitParagraphs(prose);
  if (paragraphs.length < 2) {
    return { flagged: false, reason: null, matchedCount: 0, sampleMatches: [] };
  }

  const aliasPatterns = buildAliasPatterns(opts?.userAliases ?? ["[B]"]);
  let internalParagraphs = 0;
  let totalInternalHits = 0;
  const samples: string[] = [];

  for (const p of paragraphs) {
    if (!paragraphMentionsUser(p, aliasPatterns)) continue;
    const { count, samples: local } = countInternalHits(p);
    if (count <= 0) continue;
    internalParagraphs += 1;
    totalInternalHits += count;
    for (const s of local) {
      if (samples.length < 8 && !samples.includes(s)) samples.push(s);
    }
  }

  // Require multiple paragraphs centered on [B] internal patterns
  if (internalParagraphs >= 2 && totalInternalHits >= 3) {
    return {
      flagged: true,
      reason: "USER_POV_TAKEOVER",
      matchedCount: totalInternalHits,
      sampleMatches: samples,
    };
  }

  return { flagged: false, reason: null, matchedCount: totalInternalHits, sampleMatches: samples };
}

export function logUserPovTakeover(hit: UserPovTakeoverDetection & { mode?: string }): void {
  if (!hit.flagged) return;
  console.info("[USER_POV_TAKEOVER]", {
    reason: hit.reason,
    matchedCount: hit.matchedCount,
    sampleMatches: hit.sampleMatches,
    mode: hit.mode ?? "auto_progression",
  });
}
