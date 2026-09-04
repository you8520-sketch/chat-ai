/**
 * Canonical Tier-2 comic provider-prompt semantic audit — counts and booleans only.
 */

import type { ChatComicPanelCount } from "@/lib/chatComicGenerationConstants";
import { buildStrictComicFallbackPrompt } from "@/lib/chatImageStrictSafetyFallbackPrompt";
import {
  containsRawRiskySourceLeak,
  classifyRawVisualRisk,
} from "@/lib/chatImageSafeVisualProjection";
import type { ChatImageVisualSubject } from "@/lib/chatImageVisualIdentity";
import { describeReferenceOrder } from "@/lib/chatImageVisualIdentity";
import { CHAT_COMIC_TEMPLATE_PREVIEW_URL } from "@/lib/chatComicGenerationConstants";
import {
  containsBedroomBedContext,
  containsSafeLyingOrRestContext,
  COMIC_TIER2_POSITIVE_SAFE_DEPICTION,
} from "@/lib/chatComicTier2SafeProjection";
import type { ComicSafeStructureProjection } from "@/lib/chatComicSafeStructure";
import type { OpenAiImageProviderAttemptRecord } from "@/lib/openAiImageSafetyFallback";

/** Strong genital / explicit act terms that must not appear in Tier-2 final prompt. */
const STRONG_GENITAL_TERMS =
  /(?:성기|보지|자지|페니스|질내|정액|exposed\s+genitals?|genitals?)/iu;

const NEGATIVE_SEXUAL_SAFETY_VOCAB =
  /\b(?:non[-\s]?sexual|non[-\s]?explicit|explicit\s+sexual|exposed\s+genitals?|suggestive\s+pose|sexual\s+acts?)\b/giu;

export type Tier2PromptSectionKind =
  | "SAFE_STATIC"
  | "SAFE_STRUCTURED"
  | "FREEFORM_USER_DERIVED"
  | "FREEFORM_CHARACTER_DERIVED"
  | "NEGATIVE_SAFETY_WORDING"
  | "REFERENCE_METADATA";

export type Tier2PromptSectionInventoryItem = {
  name: string;
  kind: Tier2PromptSectionKind;
};

export const FINAL_TIER2_PROMPT_SECTION_INVENTORY: Tier2PromptSectionInventoryItem[] = [
  { name: "page/layout contract", kind: "SAFE_STATIC" },
  { name: "template contract", kind: "SAFE_STATIC" },
  { name: "cast manifest", kind: "SAFE_STRUCTURED" },
  { name: "safe cast identity", kind: "REFERENCE_METADATA" },
  { name: "gender lock", kind: "SAFE_STRUCTURED" },
  { name: "strict positive safe depiction", kind: "SAFE_STATIC" },
  { name: "strict fallback header", kind: "SAFE_STATIC" },
  { name: "safe structure (location/mood)", kind: "SAFE_STRUCTURED" },
  { name: "panel beats", kind: "SAFE_STRUCTURED" },
  { name: "text exclusion contract", kind: "SAFE_STATIC" },
  { name: "cast count contract", kind: "SAFE_STATIC" },
];

export const FINAL_TIER1_PROMPT_SECTION_INVENTORY = [
  "page/layout contract",
  "template contract",
  "cast manifest",
  "visual identity",
  "gender lock",
  "safety depiction",
  "mood/tone",
  "text exclusion contract",
  "cast count contract",
  "visual panel spec",
] as const;

export type ComicReferenceRoleInventory = {
  referenceCount: number;
  roles: Array<{ index: number; role: string }>;
};

export type ReferenceModerationRisk = "NONE" | "LOW" | "HIGH" | "UNKNOWN";

export type ReferenceRiskClassification =
  | "PROMPT_SAFE"
  | "REFERENCE_RISK"
  | "TEMPLATE_RISK"
  | "UNKNOWN";

export type Tier2ComicPromptAudit = {
  rawExplicitSourceLeakCount: number;
  strongGenitalTermCount: number;
  untrustedDialogueCount: number;
  savedAppearanceFreeformCount: number;
  userRawProseCount: number;
  negativeSexualSafetyVocabCount: number;
  hasBedroom: boolean;
  hasBed: boolean;
  hasSafeLyingOrRest: boolean;
  hasStrongExplicitSourceLeak: boolean;
  hasSexualActSemantics: boolean;
  hasGenitalTerms: boolean;
  hasGraphicViolenceLeak: boolean;
  hasSelfHarmLeak: boolean;
  hasCloseInteraction: boolean;
  hasNegativeSexualSafetyVocabulary: boolean;
  safeStructureProjectionApplied: boolean;
  promptCharCount: number;
  promptHash: string | null;
};

export type ProviderAttemptSequenceAudit = {
  attemptCount: number;
  attempt1Kind: string | null;
  attempt1Outcome: string | null;
  attempt2Present: boolean;
  attempt2Kind: string | null;
  attempt2Outcome: string | null;
  safetyFallbackTriggered: boolean;
};

function countMatches(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  return [...text.matchAll(re)].length;
}

function countSavedAppearanceFreeform(
  prompt: string,
  subjects: readonly ChatImageVisualSubject[]
): number {
  let count = 0;
  for (const subject of subjects) {
    const saved = String(subject.savedAppearance ?? "").trim();
    if (!saved) continue;
    if (prompt.includes(saved)) count += 1;
  }
  return count;
}

function hasSexualActSemanticsBeyondProhibition(prompt: string): boolean {
  const stripped = prompt
    .replace(/GENERAL-AUDIENCE VISUAL CONTRACT[\s\S]*?(?=\n|$)/gi, " ")
    .replace(/STRICT PROVIDER-SAFE FALLBACK[\s\S]*?(?=\n|$)/gi, " ");
  return classifyRawVisualRisk(stripped).includes("adult_explicit");
}

export function countNegativeSexualSafetyVocabulary(text: string): number {
  return countMatches(text, NEGATIVE_SEXUAL_SAFETY_VOCAB);
}

export function auditTier2ComicPrompt(opts: {
  prompt: string;
  subjects: readonly ChatImageVisualSubject[];
  safeStructure?: ComicSafeStructureProjection;
  safeStructureProjectionApplied?: boolean;
}): Tier2ComicPromptAudit {
  const prompt = opts.prompt;
  const structureHaystack = opts.safeStructure
    ? [
        opts.safeStructure.sharedBackground,
        opts.safeStructure.atmosphere ?? "",
        ...opts.safeStructure.panels.flatMap((panel) => [
          panel.background,
          panel.situation,
          panel.poseHint,
        ]),
      ].join(" ")
    : prompt;

  const rawExplicitSourceLeakCount = containsRawRiskySourceLeak(prompt) ? 1 : 0;
  const strongGenitalTermCount = countMatches(prompt, STRONG_GENITAL_TERMS);
  const negativeSexualSafetyVocabCount = countNegativeSexualSafetyVocabulary(prompt);

  return {
    rawExplicitSourceLeakCount,
    strongGenitalTermCount,
    untrustedDialogueCount: countMatches(prompt, /^Speech bubble \(/gm),
    savedAppearanceFreeformCount: countSavedAppearanceFreeform(prompt, opts.subjects),
    userRawProseCount: 0,
    negativeSexualSafetyVocabCount,
    hasBedroom: /(?:bedroom|침실)/iu.test(structureHaystack),
    hasBed: /(?:\bed\b|침대)/iu.test(structureHaystack),
    hasSafeLyingOrRest: containsSafeLyingOrRestContext(structureHaystack),
    hasStrongExplicitSourceLeak: rawExplicitSourceLeakCount > 0,
    hasSexualActSemantics: hasSexualActSemanticsBeyondProhibition(prompt),
    hasGenitalTerms: strongGenitalTermCount > 0,
    hasGraphicViolenceLeak: classifyRawVisualRisk(prompt).includes("graphic_violence"),
    hasSelfHarmLeak: classifyRawVisualRisk(prompt).includes("self_harm"),
    hasCloseInteraction: /(?:closeness|affectionate|껴안|포옹|proximity)/iu.test(prompt),
    hasNegativeSexualSafetyVocabulary: negativeSexualSafetyVocabCount > 0,
    safeStructureProjectionApplied: opts.safeStructureProjectionApplied ?? Boolean(opts.safeStructure),
    promptCharCount: prompt.length,
    promptHash: null,
  };
}

export function buildComicReferenceRoleInventory(opts: {
  referenceUrls: readonly string[];
  subjects: readonly ChatImageVisualSubject[];
}): ComicReferenceRoleInventory {
  const order = describeReferenceOrder({
    referenceUrls: opts.referenceUrls,
    subjects: opts.subjects,
    templateUrl: CHAT_COMIC_TEMPLATE_PREVIEW_URL,
  });
  return {
    referenceCount: order.length,
    roles: order.map((item) => ({
      index: item.image,
      role: item.owner,
    })),
  };
}

export function classifyTemplateModerationRisk(): ReferenceModerationRisk {
  // Static layout template — sample figures present but not user-derived content.
  return "LOW";
}

export function classifyReferenceRiskFromFixtureMetadata(opts: {
  promptAudit: Tier2ComicPromptAudit;
  referenceFlags?: ReadonlyArray<{ index: number; unsafeReference?: boolean }>;
}): ReferenceRiskClassification {
  const promptClean =
    opts.promptAudit.rawExplicitSourceLeakCount === 0 &&
    !opts.promptAudit.hasSexualActSemantics &&
    opts.promptAudit.strongGenitalTermCount === 0;
  const unsafeRef = opts.referenceFlags?.some((item) => item.unsafeReference) ?? false;
  if (promptClean && unsafeRef) return "REFERENCE_RISK";
  if (!promptClean && !unsafeRef) return "PROMPT_SAFE";
  if (promptClean) return "PROMPT_SAFE";
  return "UNKNOWN";
}

export function auditProviderAttemptSequence(
  attempts: readonly OpenAiImageProviderAttemptRecord[]
): ProviderAttemptSequenceAudit {
  const attempt1 = attempts.find((item) => item.attempt === 1);
  const attempt2 = attempts.find((item) => item.attempt === 2);
  return {
    attemptCount: attempts.length,
    attempt1Kind: attempt1?.kind ?? null,
    attempt1Outcome: attempt1?.outcome ?? null,
    attempt2Present: attempt2 != null,
    attempt2Kind: attempt2?.kind ?? null,
    attempt2Outcome: attempt2?.outcome ?? null,
    safetyFallbackTriggered: attempts.some(
      (item) => item.kind === "strict_safety_fallback"
    ),
  };
}

export function formatTier2ComicPromptAuditForAdmin(
  audit: Tier2ComicPromptAudit
): Record<string, unknown> {
  return {
    tier1ExplicitLeakCount: null,
    tier2ExplicitLeakCount: audit.rawExplicitSourceLeakCount,
    tier2NegativeSafetyVocabularyCount: audit.negativeSexualSafetyVocabCount,
    tier2HasBedroom: audit.hasBedroom,
    tier2HasBed: audit.hasBed,
    tier2HasLying: audit.hasSafeLyingOrRest,
    tier2StrongGenitalTermCount: audit.strongGenitalTermCount,
    tier2SavedAppearanceFreeformCount: audit.savedAppearanceFreeformCount,
    tier2UntrustedDialogueCount: audit.untrustedDialogueCount,
    safeStructureProjectionApplied: audit.safeStructureProjectionApplied,
    promptCharCount: audit.promptCharCount,
  };
}

/** Re-export for tests asserting positive depiction is used in comic Tier-2. */
export { COMIC_TIER2_POSITIVE_SAFE_DEPICTION };

export type StrictComicFallbackAuditInput = Parameters<typeof buildStrictComicFallbackPrompt>[0];

export function buildAndAuditStrictComicFallbackPrompt(
  opts: StrictComicFallbackAuditInput
): { prompt: string; audit: Tier2ComicPromptAudit } {
  const prompt = buildStrictComicFallbackPrompt(opts);
  const audit = auditTier2ComicPrompt({
    prompt,
    subjects: opts.subjects,
    safeStructure: opts.safeStructure,
    safeStructureProjectionApplied: Boolean(opts.safeStructure),
  });
  return { prompt, audit };
}

export function assertTier2BedroomInvariants(audit: Tier2ComicPromptAudit): void {
  if (!audit.hasBedroom) throw new Error("TIER2_HAS_BEDROOM expected true");
  if (!audit.hasBed) throw new Error("TIER2_HAS_BED expected true");
  if (!audit.hasSafeLyingOrRest) throw new Error("TIER2_HAS_SAFE_LYING_OR_REST expected true");
}

export type ComicTier2FixtureId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7";

export function panelCountForFixture(_id: ComicTier2FixtureId): ChatComicPanelCount {
  return 2;
}
