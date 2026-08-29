import { createHash } from "node:crypto";

import { estimateTokens } from "@/lib/tokenEstimate";
import type { TrackedPromptSection } from "@/services/promptAudit";

export type SectionStabilityClass = "STATIC" | "SEMI_STATIC" | "DYNAMIC" | "VOLATILE";

export type PromptSectionFingerprint = {
  sectionId: string;
  label: string;
  chars: number;
  estimatedTokens: number;
  sha256: string;
  stabilityClass: SectionStabilityClass;
};

export type PrefixDiffReport = {
  commonPrefixChars: number;
  commonPrefixRatio: number;
  firstDiffByte: number | null;
  firstDiffSection: string | null;
  commonStableSectionCount: number;
  totalSections: number;
};

const previousFingerprintsByKey = new Map<string, Map<string, string>>();

export function hashSectionText(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

export function classifySectionStability(sectionId: string): SectionStabilityClass {
  const id = sectionId.toLowerCase();
  if (/timestamp|request|telemetry|volatile/.test(id)) return "VOLATILE";
  if (
    /memory|episodic|archive|relationship|persona-reference|pov|dynamic|lore|status|layout-recency/.test(
      id
    )
  )
    return "DYNAMIC";
  if (/character|world|identity|speech|prose-style|creator|example/.test(id))
    return "SEMI_STATIC";
  return "STATIC";
}

export function buildSectionFingerprints(
  sections: TrackedPromptSection[]
): PromptSectionFingerprint[] {
  return sections.map((s) => {
    const text = s.text.trim();
    return {
      sectionId: s.id,
      label: s.label,
      chars: text.length,
      estimatedTokens: estimateTokens(text),
      sha256: hashSectionText(text),
      stabilityClass: classifySectionStability(s.id),
    };
  });
}

export function diffSectionFingerprints(
  prev: PromptSectionFingerprint[],
  curr: PromptSectionFingerprint[]
): {
  firstChangedSection: string | null;
  unchangedCount: number;
  changed: { sectionId: string; prevHash: string; currHash: string }[];
  added: string[];
  removed: string[];
} {
  const prevMap = new Map(prev.map((p) => [p.sectionId, p]));
  const changed: { sectionId: string; prevHash: string; currHash: string }[] = [];
  const added: string[] = [];
  let unchangedCount = 0;

  for (const c of curr) {
    const p = prevMap.get(c.sectionId);
    if (!p) {
      added.push(c.sectionId);
      continue;
    }
    if (p.sha256 === c.sha256) {
      unchangedCount++;
    } else {
      changed.push({ sectionId: c.sectionId, prevHash: p.sha256, currHash: c.sha256 });
    }
  }
  const removed = prev.filter((p) => !curr.some((c) => c.sectionId === p.sectionId)).map((p) => p.sectionId);
  const firstChangedSection =
    changed[0]?.sectionId ?? added[0] ?? removed[0] ?? null;

  return { firstChangedSection, unchangedCount, changed, added, removed };
}

export function commonPrefixMetrics(textA: string, textB: string): PrefixDiffReport {
  const len = Math.min(textA.length, textB.length);
  let i = 0;
  while (i < len && textA[i] === textB[i]) i++;
  const maxLen = Math.max(textA.length, textB.length);
  return {
    commonPrefixChars: i,
    commonPrefixRatio: maxLen > 0 ? Math.round((i / maxLen) * 1000) / 1000 : 0,
    firstDiffByte: i < maxLen ? i : null,
    firstDiffSection: null,
    commonStableSectionCount: 0,
    totalSections: 0,
  };
}

/** Production-safe telemetry — hashes only, no prompt bodies. */
export function logPromptSectionFingerprints(opts: {
  scopeKey: string;
  sections: TrackedPromptSection[];
}): {
  fingerprints: PromptSectionFingerprint[];
  firstChangedSection: string | null;
  unchangedCount: number;
} {
  const curr = buildSectionFingerprints(opts.sections);
  const prevMap = previousFingerprintsByKey.get(opts.scopeKey) ?? new Map();
  const prev = [...prevMap.entries()].map(([sectionId, sha256]) => ({
    sectionId,
    label: sectionId,
    chars: 0,
    estimatedTokens: 0,
    sha256,
    stabilityClass: classifySectionStability(sectionId) as SectionStabilityClass,
  }));

  const diff = diffSectionFingerprints(prev, curr);
  const nextMap = new Map(curr.map((c) => [c.sectionId, c.sha256]));
  previousFingerprintsByKey.set(opts.scopeKey, nextMap);

  if (process.env.PROMPT_SECTION_FINGERPRINT === "1") {
    console.info("[prompt-section-fingerprint]", {
      scope: opts.scopeKey,
      sectionCount: curr.length,
      unchangedCount: diff.unchangedCount,
      firstChangedSection: diff.firstChangedSection,
      changed: diff.changed,
      added: diff.added,
      removed: diff.removed,
      sections: curr.map((s) => ({
        id: s.sectionId,
        tokens: s.estimatedTokens,
        sha256: s.sha256,
        stability: s.stabilityClass,
      })),
    });
  }

  return {
    fingerprints: curr,
    firstChangedSection: diff.firstChangedSection,
    unchangedCount: diff.unchangedCount,
  };
}
