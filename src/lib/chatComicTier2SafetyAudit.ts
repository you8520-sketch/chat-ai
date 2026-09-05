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
import type { ScenePlan } from "@/lib/chatImageScenePlan";
import {
  formatOpenAiImageFailureDiagnosticForAdmin,
  hashPromptForDiagnostic,
  type OpenAiImageFailureDiagnostic,
} from "@/lib/openAiImageFailureDiagnostic";
import {
  aggregateKnownProviderCostUsd,
  formatOpenAiImageProviderAttemptsForAdmin,
  type OpenAiImageProviderAttemptRecord,
} from "@/lib/openAiImageSafetyFallback";
import type { ComicProviderReference } from "@/lib/chatComicReferenceIsolation";
import { formatComicReferenceSetForAdmin } from "@/lib/chatComicReferenceIsolation";

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
  referenceRoles?: ComicProviderReference["role"][];
  referenceSetSignature?: string;
};

export type ReferenceModerationRisk = "NONE" | "LOW" | "HIGH" | "UNKNOWN";

export type ReferenceRiskClassification =
  | "PROMPT_SAFE"
  | "PROMPT_RISK"
  | "REFERENCE_RISK"
  | "MULTIPLE_RISKS"
  | "UNKNOWN";

export type UserRawProseAuditStatus = "PROVEN_ZERO" | "LEAK_DETECTED" | "UNKNOWN";

export type Tier2ComicPromptAudit = {
  rawExplicitSourceLeakCount: number;
  strongGenitalTermCount: number;
  untrustedDialogueCount: number;
  savedAppearanceFreeformCount: number;
  userRawProseCount: number | null;
  userRawProseAuditStatus: UserRawProseAuditStatus;
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
  attemptSequenceControlFlowProven: boolean;
  liveIncidentFullAttemptRecordProven: boolean;
};

const MIN_RAW_SOURCE_CANDIDATE_CHARS = 4;

/** Collect canonical scene-plan strings that must not leak verbatim into Tier-2. */
export function collectTier2RawSourceCandidates(plan: ScenePlan): string[] {
  const candidates: string[] = [];
  for (const event of plan.events ?? []) {
    const text = String(event.text ?? "").trim();
    if (text.length >= MIN_RAW_SOURCE_CANDIDATE_CHARS) candidates.push(text);
  }
  for (const panel of plan.panels ?? []) {
    for (const field of [
      panel.situation,
      panel.personaAction,
      panel.characterAction,
      panel.backgroundOverride,
    ]) {
      const text = String(field ?? "").trim();
      if (text.length >= MIN_RAW_SOURCE_CANDIDATE_CHARS) candidates.push(text);
    }
    for (const line of panel.dialogue ?? []) {
      const text = String(line.text ?? "").trim();
      if (text.length >= MIN_RAW_SOURCE_CANDIDATE_CHARS) candidates.push(text);
    }
  }
  for (const field of [plan.sceneBackground, plan.atmosphere, plan.heroScene]) {
    const text = String(field ?? "").trim();
    if (text.length >= MIN_RAW_SOURCE_CANDIDATE_CHARS) candidates.push(text);
  }
  return [...new Set(candidates)];
}

function countUserRawProseLeaks(
  prompt: string,
  candidates: readonly string[]
): number {
  let count = 0;
  for (const candidate of candidates) {
    const risky =
      classifyRawVisualRisk(candidate).length > 0 || containsRawRiskySourceLeak(candidate);
    if (!risky) continue;
    if (prompt.includes(candidate)) count += 1;
  }
  return count;
}

function resolveUserRawProseAudit(opts: {
  prompt: string;
  rawSourceCandidates?: readonly string[];
}): Pick<Tier2ComicPromptAudit, "userRawProseCount" | "userRawProseAuditStatus"> {
  if (opts.rawSourceCandidates == null) {
    return { userRawProseCount: null, userRawProseAuditStatus: "UNKNOWN" };
  }
  const leakCount = countUserRawProseLeaks(opts.prompt, opts.rawSourceCandidates);
  return {
    userRawProseCount: leakCount,
    userRawProseAuditStatus: leakCount === 0 ? "PROVEN_ZERO" : "LEAK_DETECTED",
  };
}

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
  rawSourceCandidates?: readonly string[];
}): Tier2ComicPromptAudit {
  const prompt = opts.prompt;
  const userRawProseAudit = resolveUserRawProseAudit({
    prompt,
    rawSourceCandidates: opts.rawSourceCandidates,
  });
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
    userRawProseCount: userRawProseAudit.userRawProseCount,
    userRawProseAuditStatus: userRawProseAudit.userRawProseAuditStatus,
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
    promptHash: hashPromptForDiagnostic(prompt),
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
  // No deterministic image-content moderation audit in this path.
  return "UNKNOWN";
}

export function classifyReferenceRiskFromFixtureMetadata(opts: {
  promptAudit: Tier2ComicPromptAudit;
  referenceFlags?: ReadonlyArray<{ index: number; unsafeReference?: boolean }>;
}): ReferenceRiskClassification {
  const promptClean =
    opts.promptAudit.rawExplicitSourceLeakCount === 0 &&
    !opts.promptAudit.hasSexualActSemantics &&
    opts.promptAudit.strongGenitalTermCount === 0;
  const promptDirty = !promptClean;
  const refsAudited = opts.referenceFlags != null;
  const unsafeRef = opts.referenceFlags?.some((item) => item.unsafeReference) ?? false;

  if (promptClean && unsafeRef) return "REFERENCE_RISK";
  if (promptClean && refsAudited && !unsafeRef) return "PROMPT_SAFE";
  if (promptDirty && unsafeRef) return "MULTIPLE_RISKS";
  if (promptDirty && refsAudited && !unsafeRef) return "PROMPT_RISK";
  return "UNKNOWN";
}

export function auditProviderAttemptSequence(
  attempts: readonly OpenAiImageProviderAttemptRecord[],
  opts?: { liveIncidentFullAttemptRecordProven?: boolean }
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
    attemptSequenceControlFlowProven: attempts.length > 0,
    liveIncidentFullAttemptRecordProven: opts?.liveIncidentFullAttemptRecordProven ?? false,
  };
}

export function formatComicReferenceRoleInventoryForAdmin(
  inventory: ComicReferenceRoleInventory
): Array<{ index: number; role: string }> {
  return inventory.roles.map((item) => ({
    index: item.index,
    role: item.role,
  }));
}

/** Canonical admin-safe comic generation failure diagnostic — HTTP + Railway share this shape. */
export function formatComicGenerationAdminFailureDiagnostic(opts: {
  providerAttempts?: readonly OpenAiImageProviderAttemptRecord[];
  tier2PromptAudit?: Tier2ComicPromptAudit | null;
  referenceRoleInventory?: ComicReferenceRoleInventory | null;
  imageFailureDiagnostic?: OpenAiImageFailureDiagnostic;
  providerReferences?: readonly ComicProviderReference[];
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (opts.imageFailureDiagnostic) {
    payload.imageAttemptDiagnostic = formatOpenAiImageFailureDiagnosticForAdmin(
      opts.imageFailureDiagnostic
    );
  }

  if (opts.providerAttempts?.length) {
    const referenceSet = opts.providerReferences
      ? formatComicReferenceSetForAdmin(opts.providerReferences)
      : undefined;
    payload.providerAttemptDiagnostic = formatOpenAiImageProviderAttemptsForAdmin({
      providerAttempts: opts.providerAttempts,
      knownProviderCostUsd: aggregateKnownProviderCostUsd(opts.providerAttempts),
      hasUnknownAttemptCost: opts.providerAttempts.some((attempt) => attempt.costUsd == null),
      safetyFallbackUsed: opts.providerAttempts.some(
        (attempt) =>
          attempt.kind === "strict_safety_fallback" && attempt.outcome === "success"
      ),
      referenceSet,
    });

    if (opts.tier2PromptAudit) {
      const attempt2 = opts.providerAttempts.find((attempt) => attempt.attempt === 2);
      if (attempt2) {
        payload.tier2PromptHashMatchesAttempt2 = tier2AuditPromptHashMatchesAttempt2({
          audit: opts.tier2PromptAudit,
          providerAttempts: opts.providerAttempts,
        });
      }
    }
  }

  if (opts.tier2PromptAudit) {
    payload.tier2PromptAudit = formatTier2ComicPromptAuditForAdmin(opts.tier2PromptAudit);
  }

  if (opts.referenceRoleInventory) {
    payload.referenceRoleInventory = formatComicReferenceRoleInventoryForAdmin(
      opts.referenceRoleInventory
    );
  }
  if (opts.providerReferences) {
    payload.referenceSet = formatComicReferenceSetForAdmin(opts.providerReferences);
  }

  payload.templateModerationRisk = classifyTemplateModerationRisk();
  return payload;
}

export type RailwayAdminDiagnosticSafetyAudit = {
  rawPromptLeak: number;
  rawSourceLeak: number;
  referenceUrlLeak: number;
  apiKeyLeak: number;
  base64Leak: number;
  safe: boolean;
};

/** Verifies admin failure diagnostic JSON is safe for Railway logging. */
export function auditRailwayAdminDiagnosticSafety(
  diagnostic: Record<string, unknown>,
  forbiddenSamples: readonly string[] = []
): RailwayAdminDiagnosticSafetyAudit {
  const serialized = JSON.stringify(diagnostic);
  let rawPromptLeak = 0;
  let rawSourceLeak = 0;
  let referenceUrlLeak = 0;
  let apiKeyLeak = 0;
  let base64Leak = 0;

  for (const sample of forbiddenSamples) {
    if (!sample.trim()) continue;
    if (serialized.includes(sample)) {
      if (/^sk-/.test(sample) || /OPENAI_API_KEY/i.test(sample)) apiKeyLeak += 1;
      else if (/data:image|base64/i.test(sample)) base64Leak += 1;
      else if (/^https?:\/\//.test(sample) || sample.startsWith("/uploads/")) referenceUrlLeak += 1;
      else if (/성관계|성행위|TIER2_RAW_SECRET/.test(sample)) rawSourceLeak += 1;
      else rawPromptLeak += 1;
    }
  }

  if (/data:image\/[^;]+;base64,/i.test(serialized)) base64Leak += 1;
  if (/\bsk-[A-Za-z0-9]{8,}\b/.test(serialized)) apiKeyLeak += 1;
  if (/https?:\/\/[^\s"']+/i.test(serialized)) referenceUrlLeak += 1;

  const safe =
    rawPromptLeak === 0 &&
    rawSourceLeak === 0 &&
    referenceUrlLeak === 0 &&
    apiKeyLeak === 0 &&
    base64Leak === 0;

  return {
    rawPromptLeak,
    rawSourceLeak,
    referenceUrlLeak,
    apiKeyLeak,
    base64Leak,
    safe,
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
    tier2UserRawProseCount: audit.userRawProseCount,
    tier2UserRawProseAuditStatus: audit.userRawProseAuditStatus,
    safeStructureProjectionApplied: audit.safeStructureProjectionApplied,
    promptCharCount: audit.promptCharCount,
    promptHash: audit.promptHash,
  };
}

/** Re-export for tests asserting positive depiction is used in comic Tier-2. */
export { COMIC_TIER2_POSITIVE_SAFE_DEPICTION };

export type StrictComicFallbackAuditInput = Parameters<typeof buildStrictComicFallbackPrompt>[0];

export function buildAndAuditStrictComicFallbackPrompt(
  opts: StrictComicFallbackAuditInput & { rawSourceCandidates?: readonly string[] }
): { prompt: string; audit: Tier2ComicPromptAudit } {
  const prompt = buildStrictComicFallbackPrompt(opts);
  const audit = auditTier2ComicPrompt({
    prompt,
    subjects: opts.subjects,
    safeStructure: opts.safeStructure,
    safeStructureProjectionApplied: Boolean(opts.safeStructure),
    rawSourceCandidates: opts.rawSourceCandidates,
  });
  return { prompt, audit };
}

/** Verifies Tier-2 audit hash matches attempt #2 provider record when present. */
export function tier2AuditPromptHashMatchesAttempt2(opts: {
  audit: Tier2ComicPromptAudit;
  providerAttempts: readonly OpenAiImageProviderAttemptRecord[];
}): boolean {
  const attempt2 = opts.providerAttempts.find((item) => item.attempt === 2);
  if (!attempt2) return false;
  return opts.audit.promptHash != null && opts.audit.promptHash === attempt2.promptHash;
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
