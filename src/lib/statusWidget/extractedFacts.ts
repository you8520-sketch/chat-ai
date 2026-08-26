import type { EpisodicExtractedFact } from "@/lib/memory/memory-episodic-types";
import { sanitizeEpisodicExtractedFacts } from "@/lib/memory/memory-episodic-normalize";
import type {
  ExtractedStatusFact,
  ExtractedStatusFactCategory,
  ExtractedStatusFactEvidenceType,
  ExtractedStatusFactImportance,
} from "./types";

/** Status compatibility wrapper — schema owner is memory-episodic-normalize. */
export function sanitizeExtractedFacts(
  raw: unknown,
  opts: { requireEvidence?: boolean } = {}
): ExtractedStatusFact[] {
  return sanitizeEpisodicExtractedFacts(raw, opts);
}

export function mergeExtractedFacts(
  ...groups: Array<ExtractedStatusFact[] | null | undefined>
): ExtractedStatusFact[] {
  const out: ExtractedStatusFact[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const fact of group ?? []) {
      const key = `${fact.category}:${fact.subject}:${fact.attribute}:${fact.value}:${fact.fact_text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(fact);
      if (out.length >= 3) return out;
    }
  }
  return out;
}

export type { EpisodicExtractedFact, ExtractedStatusFactCategory, ExtractedStatusFactEvidenceType, ExtractedStatusFactImportance };
