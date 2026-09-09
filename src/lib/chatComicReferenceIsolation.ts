import { CHAT_COMIC_TEMPLATE_PREVIEW_URL } from "@/lib/chatComicGenerationConstants";
import type { ChatImageVisualSubject } from "@/lib/chatImageVisualIdentity";

export type ComicProviderReferenceRole =
  | "template"
  | "chat_character"
  | "user_persona";

export type ComicModerationIsolationOutcome = "pass" | "moderation_blocked";
export type ComicModerationAssociation =
  | "REAL_TEMPLATE_CONTENT_PRIMARY_SUSPECT"
  | "CHAT_CHARACTER_REFERENCE_PRIMARY_SUSPECT"
  | "USER_PERSONA_REFERENCE_PRIMARY_SUSPECT"
  | "IDENTITY_REFERENCE_OR_MULTI_PERSON_INTERACTION"
  | "BROADER_PROVIDER_OR_VISUAL_CONTEXT_RISK"
  | "REFERENCE_BYTES_ALONE_NOT_SUFFICIENT_CAUSE"
  | "INSUFFICIENT_EVIDENCE";

export type ComicProviderReference = {
  role: ComicProviderReferenceRole;
  index: number;
  sourceUrl: string;
  content: "real" | "neutral";
  subjectId?: string;
};

export type ComicNormalizedProviderReference = ComicProviderReference & {
  /** Provider-ready bytes; never include this field in diagnostics or persistence. */
  dataUrl: string;
};

/** Canonical typed owner between identity binding and provider byte normalization. */
export function buildComicProviderReferences(opts: {
  referenceUrls: readonly string[];
  subjects: readonly ChatImageVisualSubject[];
}): ComicProviderReference[] {
  return opts.referenceUrls.map((sourceUrl, offset) => {
    const originalIndex = offset + 1;
    if (originalIndex === 1 && sourceUrl === CHAT_COMIC_TEMPLATE_PREVIEW_URL) {
      return { role: "template", index: originalIndex, sourceUrl, content: "real" };
    }
    const subject = opts.subjects.find(
      (candidate) => candidate.referenceIndex === originalIndex
        && candidate.referenceImageUrl === sourceUrl
    );
    return {
      role: subject?.sourceKind === "persona" ? "user_persona" : "chat_character",
      index: originalIndex,
      sourceUrl,
      content: "real",
      ...(subject?.key ? { subjectId: subject.key } : {}),
    };
  });
}

/** Keep prompt binding fixed while normalizing the selected content in each slot. */
export async function prepareComicProviderReferenceInput(opts: {
  primaryPrompt: string;
  strictFallbackPrompt: string;
  references: readonly ComicProviderReference[];
  normalizeReference: (sourceUrl: string) => Promise<string>;
}): Promise<{
  primaryPrompt: string;
  strictFallbackPrompt: string;
  references: ComicNormalizedProviderReference[];
}> {
  return {
    primaryPrompt: opts.primaryPrompt,
    strictFallbackPrompt: opts.strictFallbackPrompt,
    references: await Promise.all(opts.references.map(async (reference) => ({
      ...reference,
      dataUrl: await opts.normalizeReference(reference.sourceUrl),
    }))),
  };
}

export function formatComicReferenceSetForAdmin(
  references: readonly ComicProviderReference[]
): {
  referenceRoles: ComicProviderReferenceRole[];
  referenceCount: number;
  referenceSetSignature: string;
  references: Array<{ index: number; role: ComicProviderReferenceRole; content: "real" | "neutral" }>;
} {
  const referenceRoles = references.map((reference) => reference.role);
  return {
    referenceRoles,
    referenceCount: referenceRoles.length,
    referenceSetSignature: references
      .map((reference) => `${reference.role}:${reference.content}`)
      .join("|"),
    references: references.map(({ index, role, content }) => ({ index, role, content })),
  };
}

/** Admin-safe interpretation owner. Results describe moderation association, not image safety. */
export function classifyComicModerationAssociation(
  results: Partial<Record<string, ComicModerationIsolationOutcome>>
): ComicModerationAssociation {
  if (results.normal !== "moderation_blocked") return "INSUFFICIENT_EVIDENCE";
  if (results.neutral_visual_context === "pass") {
    return "REFERENCE_BYTES_ALONE_NOT_SUFFICIENT_CAUSE";
  }
  if (results.neutral_template === "pass") return "REAL_TEMPLATE_CONTENT_PRIMARY_SUSPECT";
  if (results.neutral_character === "pass") return "CHAT_CHARACTER_REFERENCE_PRIMARY_SUSPECT";
  if (results.neutral_persona === "pass") return "USER_PERSONA_REFERENCE_PRIMARY_SUSPECT";
  if (results.neutral_identity_refs === "pass") return "IDENTITY_REFERENCE_OR_MULTI_PERSON_INTERACTION";
  if (results.all_neutral === "moderation_blocked") return "BROADER_PROVIDER_OR_VISUAL_CONTEXT_RISK";
  return "INSUFFICIENT_EVIDENCE";
}
