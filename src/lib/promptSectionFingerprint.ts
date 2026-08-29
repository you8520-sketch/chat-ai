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

export type SectionSequenceEntry = {
  sectionId: string;
  sha256: string;
};

export type PrefixDiffReport = {
  commonPrefixChars: number;
  commonPrefixRatio: number;
  firstDiffByte: number | null;
  firstDiffSection: string | null;
  commonStableSectionCount: number;
  totalSections: number;
};

/** Per-chat/model cross-turn state — only retained when fingerprint telemetry is enabled. */
const previousFingerprintsByKey = new Map<string, SectionSequenceEntry[]>();

/** Bounded FIFO eviction (same pattern as modelPickerInputSnapshot). */
export const PROMPT_SECTION_FINGERPRINT_MAX_SCOPES = 256;

export function isPromptSectionFingerprintStateEnabled(): boolean {
  return (
    process.env.PROMPT_SECTION_FINGERPRINT === "1" ||
    process.env.GEMINI_TTFT_PHASE_AUDIT === "1"
  );
}

export function promptSectionFingerprintCacheSize(): number {
  return previousFingerprintsByKey.size;
}

export function clearPromptSectionFingerprintCache(): void {
  previousFingerprintsByKey.clear();
}

function touchFingerprintScope(scopeKey: string): SectionSequenceEntry[] | undefined {
  const entry = previousFingerprintsByKey.get(scopeKey);
  if (!entry) return undefined;
  previousFingerprintsByKey.delete(scopeKey);
  previousFingerprintsByKey.set(scopeKey, entry);
  return entry;
}

function evictOldestFingerprintScopes(): void {
  while (previousFingerprintsByKey.size > PROMPT_SECTION_FINGERPRINT_MAX_SCOPES) {
    const oldestKey = previousFingerprintsByKey.keys().next().value as string | undefined;
    if (oldestKey == null) break;
    previousFingerprintsByKey.delete(oldestKey);
  }
}

function rememberFingerprintScope(scopeKey: string, sequence: SectionSequenceEntry[]): void {
  if (previousFingerprintsByKey.has(scopeKey)) {
    previousFingerprintsByKey.delete(scopeKey);
  }
  previousFingerprintsByKey.set(scopeKey, sequence);
  evictOldestFingerprintScopes();
}

/** Matches tracked section bytes (pushSection stores trimmed text). */
export function hashSectionText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
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
    const text = s.text;
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

export function buildSectionSequence(
  fingerprints: PromptSectionFingerprint[]
): SectionSequenceEntry[] {
  return fingerprints.map((f) => ({ sectionId: f.sectionId, sha256: f.sha256 }));
}

export function diffSectionFingerprints(
  prev: PromptSectionFingerprint[] | SectionSequenceEntry[],
  curr: PromptSectionFingerprint[]
): {
  firstChangedSection: string | null;
  firstChangedPosition: number | null;
  orderChangeDetected: boolean;
  unchangedCount: number;
  unchangedPrefixSections: number;
  changed: { sectionId: string; prevHash: string; currHash: string }[];
  added: string[];
  removed: string[];
} {
  const prevSeq: SectionSequenceEntry[] = prev.map((p) =>
    "sha256" in p && !("label" in p)
      ? { sectionId: p.sectionId, sha256: p.sha256 }
      : { sectionId: p.sectionId, sha256: (p as PromptSectionFingerprint).sha256 }
  );
  const currSeq = buildSectionSequence(curr);

  const changed: { sectionId: string; prevHash: string; currHash: string }[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  let unchangedPrefixSections = 0;
  let firstChangedPosition: number | null = null;
  let firstChangedSection: string | null = null;

  const maxLen = Math.max(prevSeq.length, currSeq.length);
  for (let i = 0; i < maxLen; i++) {
    const p = prevSeq[i];
    const c = currSeq[i];
    if (p == null && c != null) {
      added.push(c.sectionId);
      if (firstChangedPosition == null) {
        firstChangedPosition = i;
        firstChangedSection = c.sectionId;
      }
      continue;
    }
    if (p != null && c == null) {
      removed.push(p.sectionId);
      if (firstChangedPosition == null) {
        firstChangedPosition = i;
        firstChangedSection = p.sectionId;
      }
      continue;
    }
    if (p != null && c != null) {
      if (p.sectionId === c.sectionId && p.sha256 === c.sha256) {
        if (firstChangedPosition == null) unchangedPrefixSections++;
        continue;
      }
      if (firstChangedPosition == null) {
        firstChangedPosition = i;
        firstChangedSection = c.sectionId;
      }
      if (p.sectionId === c.sectionId) {
        changed.push({ sectionId: c.sectionId, prevHash: p.sha256, currHash: c.sha256 });
      } else {
        changed.push({ sectionId: c.sectionId, prevHash: p.sha256, currHash: c.sha256 });
      }
    }
  }

  const prevMultiset = new Map<string, number>();
  const currMultiset = new Map<string, number>();
  for (const e of prevSeq) {
    const k = `${e.sectionId}:${e.sha256}`;
    prevMultiset.set(k, (prevMultiset.get(k) ?? 0) + 1);
  }
  for (const e of currSeq) {
    const k = `${e.sectionId}:${e.sha256}`;
    currMultiset.set(k, (currMultiset.get(k) ?? 0) + 1);
  }
  let multisetEqual = prevMultiset.size === currMultiset.size;
  if (multisetEqual) {
    for (const [k, n] of prevMultiset) {
      if (currMultiset.get(k) !== n) {
        multisetEqual = false;
        break;
      }
    }
  }
  const orderChangeDetected =
    multisetEqual &&
    prevSeq.length === currSeq.length &&
    firstChangedPosition != null &&
    prevSeq.some((p, i) => p.sectionId !== currSeq[i]?.sectionId);

  // Content-level id tracking for added/removed (non-order)
  const prevMap = new Map(prevSeq.map((p) => [p.sectionId, p.sha256]));
  let unchangedCount = 0;
  for (const c of currSeq) {
    const pHash = prevMap.get(c.sectionId);
    if (pHash == null) {
      if (!added.includes(c.sectionId)) added.push(c.sectionId);
    } else if (pHash === c.sha256) {
      unchangedCount++;
    } else if (!changed.some((x) => x.sectionId === c.sectionId)) {
      changed.push({ sectionId: c.sectionId, prevHash: pHash, currHash: c.sha256 });
    }
  }
  for (const p of prevSeq) {
    if (!currSeq.some((c) => c.sectionId === p.sectionId)) {
      if (!removed.includes(p.sectionId)) removed.push(p.sectionId);
    }
  }

  if (firstChangedSection == null) {
    firstChangedSection =
      changed[0]?.sectionId ?? added[0] ?? removed[0] ?? null;
  }

  return {
    firstChangedSection,
    firstChangedPosition,
    orderChangeDetected,
    unchangedCount,
    unchangedPrefixSections,
    changed,
    added,
    removed,
  };
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
  firstChangedPosition: number | null;
  orderChangeDetected: boolean;
  unchangedCount: number;
  unchangedPrefixSections: number;
} {
  const curr = buildSectionFingerprints(opts.sections);
  const stateEnabled = isPromptSectionFingerprintStateEnabled();
  const prevSeq = stateEnabled ? touchFingerprintScope(opts.scopeKey) ?? [] : [];

  const diff = diffSectionFingerprints(prevSeq, curr);

  if (stateEnabled) {
    rememberFingerprintScope(opts.scopeKey, buildSectionSequence(curr));
  }

  if (process.env.PROMPT_SECTION_FINGERPRINT === "1") {
    console.info("[prompt-section-fingerprint]", {
      scope: opts.scopeKey,
      sectionCount: curr.length,
      unchangedCount: diff.unchangedCount,
      unchangedPrefixSections: diff.unchangedPrefixSections,
      firstChangedSection: diff.firstChangedSection,
      firstChangedPosition: diff.firstChangedPosition,
      orderChangeDetected: diff.orderChangeDetected,
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
    firstChangedPosition: diff.firstChangedPosition,
    orderChangeDetected: diff.orderChangeDetected,
    unchangedCount: diff.unchangedCount,
    unchangedPrefixSections: diff.unchangedPrefixSections,
  };
}
