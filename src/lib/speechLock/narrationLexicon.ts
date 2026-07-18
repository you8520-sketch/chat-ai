import { REGISTER_LABEL_PATTERN } from "@/lib/speechMetadataPolicy";
import { META_NARRATION_IN_NARRATION_RE } from "@/lib/registerMetaAudit";
import type { SpeechViolation } from "./types";

export function stripDialogueForNarrationScan(text: string): string {
  return text.replace(/"[^"]*"/g, " ").replace(/\s+/g, " ").trim();
}

/** Group A — literal register labels / label+particle patterns in narration (quotes stripped). */
export function detectRegisterLexiconInNarration(text: string): { fail: boolean; hits: string[] } {
  const narration = stripDialogueForNarrationScan(text);
  const hits: string[] = [];

  const labelRe = new RegExp(REGISTER_LABEL_PATTERN.source, "gi");
  for (const m of narration.matchAll(labelRe)) {
    if (m[0]) hits.push(m[0]);
  }

  const metaM = narration.match(META_NARRATION_IN_NARRATION_RE);
  if (metaM?.[0]) hits.push(metaM[0].slice(0, 120));

  return { fail: hits.length > 0, hits: [...new Set(hits)] };
}

export function validateNarrationRegisterLexicon(text: string): SpeechViolation[] {
  const { fail, hits } = detectRegisterLexiconInNarration(text);
  if (!fail) return [];
  return [
    {
      type: "narration_register_lexicon",
      matched: hits.slice(0, 8),
      excerpt: stripDialogueForNarrationScan(text).slice(0, 160),
      severity: "fail",
    },
  ];
}

/**
 * Staging gate for narration-lexicon speech-lock.
 *
 * - SPEECH_LOCK_NARRATION_LEXICON=1 required
 * - SPEECH_LOCK_NARRATION_LEXICON_LEON_ONLY=0 → all characters
 * - else SPEECH_LOCK_NARRATION_LEXICON_CHARS=comma-separated names (staging allowlist)
 *
 * No character proper nouns are hardcoded. For previous Leon-only staging, set
 * SPEECH_LOCK_NARRATION_LEXICON_CHARS to that character's name in env.
 *
 * @deprecated alias SPEECH_LOCK_NARRATION_LEXICON_LEON_ONLY — prefer CHARS allowlist or =0 for all
 */
export function isNarrationLexiconGateEnabled(charName: string): boolean {
  if (process.env.SPEECH_LOCK_NARRATION_LEXICON !== "1") return false;
  if (process.env.SPEECH_LOCK_NARRATION_LEXICON_LEON_ONLY === "0") return true;

  const allowlist = (process.env.SPEECH_LOCK_NARRATION_LEXICON_CHARS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowlist.length === 0) return false;
  return allowlist.includes(charName.trim());
}
