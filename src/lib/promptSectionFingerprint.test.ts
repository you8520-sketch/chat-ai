import assert from "node:assert/strict";
import test from "node:test";

import {
  PROMPT_SECTION_FINGERPRINT_MAX_SCOPES,
  buildSectionFingerprints,
  clearPromptSectionFingerprintCache,
  diffSectionFingerprints,
  hashSectionText,
  isPromptSectionFingerprintStateEnabled,
  logPromptSectionFingerprints,
  promptSectionFingerprintCacheSize,
} from "@/lib/promptSectionFingerprint";
import { aggregateFixtureVerdict } from "@/lib/gemini31LayoutAbRubric";
import { computeLayoutAbParagraphMetrics } from "@/lib/gemini31LayoutAbMetrics";
import type { TrackedPromptSection } from "@/services/promptAudit";

function withFingerprintStateEnabled<T>(fn: () => T): T {
  const prevFp = process.env.PROMPT_SECTION_FINGERPRINT;
  const prevAudit = process.env.GEMINI_TTFT_PHASE_AUDIT;
  process.env.PROMPT_SECTION_FINGERPRINT = "1";
  clearPromptSectionFingerprintCache();
  try {
    return fn();
  } finally {
    clearPromptSectionFingerprintCache();
    if (prevFp === undefined) delete process.env.PROMPT_SECTION_FINGERPRINT;
    else process.env.PROMPT_SECTION_FINGERPRINT = prevFp;
    if (prevAudit === undefined) delete process.env.GEMINI_TTFT_PHASE_AUDIT;
    else process.env.GEMINI_TTFT_PHASE_AUDIT = prevAudit;
  }
}

test("R3 — section reorder detected as prefix divergence", () => {
  const prev = buildSectionFingerprints([
    { id: "A", label: "A", category: "systemRules", text: "hash1" },
    { id: "B", label: "B", category: "systemRules", text: "hash2" },
    { id: "C", label: "C", category: "systemRules", text: "hash3" },
  ]);
  const curr = buildSectionFingerprints([
    { id: "A", label: "A", category: "systemRules", text: "hash1" },
    { id: "C", label: "C", category: "systemRules", text: "hash3" },
    { id: "B", label: "B", category: "systemRules", text: "hash2" },
  ]);
  const diff = diffSectionFingerprints(prev, curr);
  assert.equal(diff.orderChangeDetected, true);
  assert.equal(diff.firstChangedPosition, 1);
  assert.equal(diff.firstChangedSection, "C");
});

test("R9 — identical sections and order unchanged", () => {
  const sections: TrackedPromptSection[] = [
    { id: "a", label: "A", category: "systemRules", text: "same" },
    { id: "b", label: "B", category: "systemRules", text: "stable" },
  ];
  const prev = buildSectionFingerprints(sections);
  const curr = buildSectionFingerprints(sections);
  const diff = diffSectionFingerprints(prev, curr);
  assert.equal(diff.firstChangedSection, null);
  assert.equal(diff.firstChangedPosition, null);
  assert.equal(diff.orderChangeDetected, false);
  assert.equal(diff.unchangedPrefixSections, 2);
});

test("R10 — content mutation reports correct first changed section", () => {
  const prev = buildSectionFingerprints([
    { id: "a", label: "A", category: "systemRules", text: "same" },
    { id: "b", label: "B", category: "systemRules", text: "old" },
  ]);
  const curr = buildSectionFingerprints([
    { id: "a", label: "A", category: "systemRules", text: "same" },
    { id: "b", label: "B", category: "systemRules", text: "new" },
  ]);
  const diff = diffSectionFingerprints(prev, curr);
  assert.equal(diff.firstChangedSection, "b");
  assert.equal(diff.firstChangedPosition, 1);
});

test("R5 — telemetry disabled retains no cross-turn state", () => {
  const prevFp = process.env.PROMPT_SECTION_FINGERPRINT;
  const prevAudit = process.env.GEMINI_TTFT_PHASE_AUDIT;
  delete process.env.PROMPT_SECTION_FINGERPRINT;
  delete process.env.GEMINI_TTFT_PHASE_AUDIT;
  clearPromptSectionFingerprintCache();
  assert.equal(isPromptSectionFingerprintStateEnabled(), false);

  const sections: TrackedPromptSection[] = [
    { id: "x", label: "X", category: "systemRules", text: "one" },
  ];
  logPromptSectionFingerprints({ scopeKey: "disabled-scope", sections });
  assert.equal(promptSectionFingerprintCacheSize(), 0);

  if (prevFp === undefined) delete process.env.PROMPT_SECTION_FINGERPRINT;
  else process.env.PROMPT_SECTION_FINGERPRINT = prevFp;
  if (prevAudit === undefined) delete process.env.GEMINI_TTFT_PHASE_AUDIT;
  else process.env.GEMINI_TTFT_PHASE_AUDIT = prevAudit;
});

test("R6 — telemetry enabled bounds stored scopes", () => {
  withFingerprintStateEnabled(() => {
    const sections: TrackedPromptSection[] = [
      { id: "s", label: "S", category: "systemRules", text: "x" },
    ];
    for (let i = 0; i < PROMPT_SECTION_FINGERPRINT_MAX_SCOPES + 50; i++) {
      logPromptSectionFingerprints({ scopeKey: `scope-${i}`, sections });
    }
    assert.ok(promptSectionFingerprintCacheSize() <= PROMPT_SECTION_FINGERPRINT_MAX_SCOPES);
  });
});

test("R1 — empty rubric array is NOT_RUN not PASS", () => {
  assert.equal(aggregateFixtureVerdict([]), "NOT_RUN");
});

test("R7 — separated dialogue paragraphs are not violations", () => {
  const text = `"A의 대사"\n\n"B의 대사"`;
  const m = computeLayoutAbParagraphMetrics(text);
  assert.equal(m.speakerChangeWithoutParagraphBreak, 0);
});

test("R8 — same-paragraph speaker violation detected", () => {
  const text = `"A의 대사"\n"B의 대사"`;
  const m = computeLayoutAbParagraphMetrics(text);
  assert.ok(m.speakerChangeWithoutParagraphBreak >= 1);
});

test("hashSectionText is deterministic", () => {
  assert.equal(hashSectionText("abc"), hashSectionText("abc"));
  assert.notEqual(hashSectionText("abc"), hashSectionText("abcd"));
});
