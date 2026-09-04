import { CHAT_COMIC_TEMPLATE_PREVIEW_URL } from "@/lib/chatComicGenerationConstants";
import type { ComicSafeStructureProjection } from "@/lib/chatComicSafeStructure";
import type { ChatImageVisualSubject } from "@/lib/chatImageVisualIdentity";
import type { ScenePlan } from "@/lib/chatImageScenePlan";

export type ComicProviderReferenceRole =
  | "template"
  | "chat_character"
  | "user_persona";

export type ComicReferenceIsolationMode =
  | "normal"
  | "without_template"
  | "without_character"
  | "without_persona"
  | "template_only"
  | "identity_refs_only";

export type ComicVisualContextIsolationMode = "normal" | "neutral_visual_context";

export type ComicModerationIsolationOutcome = "pass" | "moderation_blocked";
export type ComicModerationAssociation =
  | "TEMPLATE_REFERENCE_PRIMARY_SUSPECT"
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
  subjectId?: string;
};

export type ComicNormalizedProviderReference = ComicProviderReference & {
  /** Provider-ready bytes; never include this field in diagnostics or persistence. */
  dataUrl: string;
};

export const COMIC_REFERENCE_ISOLATION_MODES: readonly ComicReferenceIsolationMode[] = [
  "normal",
  "without_template",
  "without_character",
  "without_persona",
  "template_only",
  "identity_refs_only",
];

function isReferenceMode(value: unknown): value is ComicReferenceIsolationMode {
  return COMIC_REFERENCE_ISOLATION_MODES.includes(value as ComicReferenceIsolationMode);
}

/** Request-bound admin gate. Invalid or unauthorized diagnostic overrides are rejected. */
export function resolveComicDiagnosticOverrides(opts: {
  canSeeCost: boolean;
  referenceMode?: unknown;
  visualContextMode?: unknown;
}): {
  referenceMode: ComicReferenceIsolationMode;
  visualContextMode: ComicVisualContextIsolationMode;
} {
  const requestedReference = opts.referenceMode == null ? "normal" : opts.referenceMode;
  const requestedVisual = opts.visualContextMode == null ? "normal" : opts.visualContextMode;
  if (!isReferenceMode(requestedReference)) {
    throw new Error("INVALID_COMIC_REFERENCE_ISOLATION_MODE");
  }
  if (requestedVisual !== "normal" && requestedVisual !== "neutral_visual_context") {
    throw new Error("INVALID_COMIC_VISUAL_CONTEXT_ISOLATION_MODE");
  }
  if (!opts.canSeeCost && (requestedReference !== "normal" || requestedVisual !== "normal")) {
    throw new Error("COMIC_DIAGNOSTIC_OVERRIDE_FORBIDDEN");
  }
  if (requestedReference !== "normal" && requestedVisual !== "normal") {
    throw new Error("COMIC_DIAGNOSTIC_AXES_MUST_BE_ISOLATED");
  }
  return { referenceMode: requestedReference, visualContextMode: requestedVisual };
}

/** Canonical typed owner between identity binding and provider byte normalization. */
export function buildComicProviderReferences(opts: {
  referenceUrls: readonly string[];
  subjects: readonly ChatImageVisualSubject[];
}): ComicProviderReference[] {
  return opts.referenceUrls.map((sourceUrl, offset) => {
    const originalIndex = offset + 1;
    if (originalIndex === 1 && sourceUrl === CHAT_COMIC_TEMPLATE_PREVIEW_URL) {
      return { role: "template", index: originalIndex, sourceUrl };
    }
    const subject = opts.subjects.find(
      (candidate) => candidate.referenceIndex === originalIndex
        && candidate.referenceImageUrl === sourceUrl
    );
    return {
      role: subject?.sourceKind === "persona" ? "user_persona" : "chat_character",
      index: originalIndex,
      sourceUrl,
      ...(subject?.key ? { subjectId: subject.key } : {}),
    };
  });
}

export function isolateComicProviderReferences(
  references: readonly ComicProviderReference[],
  mode: ComicReferenceIsolationMode
): ComicProviderReference[] {
  const included = references.filter((reference) => {
    if (mode === "normal") return true;
    if (mode === "without_template") return reference.role !== "template";
    if (mode === "without_character") return reference.role !== "chat_character";
    if (mode === "without_persona") return reference.role !== "user_persona";
    if (mode === "template_only") return reference.role === "template";
    return reference.role !== "template";
  });
  return included.map((reference, offset) => ({ ...reference, index: offset + 1 }));
}

export function formatComicReferenceSetForAdmin(
  references: readonly ComicProviderReference[]
): { referenceRoles: ComicProviderReferenceRole[]; referenceCount: number; referenceSetSignature: string } {
  const referenceRoles = references.map((reference) => reference.role);
  return {
    referenceRoles,
    referenceCount: referenceRoles.length,
    referenceSetSignature: referenceRoles.join("+"),
  };
}

/** Admin-safe interpretation owner. Results describe moderation association, not image safety. */
export function classifyComicModerationAssociation(
  results: Partial<Record<ComicReferenceIsolationMode | "neutral_visual_context", ComicModerationIsolationOutcome>>
): ComicModerationAssociation {
  if (results.normal !== "moderation_blocked") return "INSUFFICIENT_EVIDENCE";
  if (results.neutral_visual_context === "pass") {
    return "REFERENCE_BYTES_ALONE_NOT_SUFFICIENT_CAUSE";
  }
  if (results.without_template === "pass") return "TEMPLATE_REFERENCE_PRIMARY_SUSPECT";
  if (results.without_character === "pass") return "CHAT_CHARACTER_REFERENCE_PRIMARY_SUSPECT";
  if (results.without_persona === "pass") return "USER_PERSONA_REFERENCE_PRIMARY_SUSPECT";
  if (results.identity_refs_only === "moderation_blocked" && results.template_only === "pass") {
    return "IDENTITY_REFERENCE_OR_MULTI_PERSON_INTERACTION";
  }
  if (
    results.without_template === "moderation_blocked"
    && results.without_character === "moderation_blocked"
    && results.without_persona === "moderation_blocked"
    && results.template_only === "moderation_blocked"
  ) {
    return "BROADER_PROVIDER_OR_VISUAL_CONTEXT_RISK";
  }
  return "INSUFFICIENT_EVIDENCE";
}

/** Fixed provider-only fixture. It never reads or mutates user ScenePlan prose. */
export function buildNeutralComicSafeStructure(
  panelIndices: readonly number[]
): ComicSafeStructureProjection {
  return {
    sharedBackground: "ordinary indoor room",
    atmosphere: "neutral expressions and calm everyday mood",
    panels: panelIndices.map((index) => ({
      index,
      situation: "two adult characters present with ordinary clothing",
      background: "ordinary indoor room",
      poseHint: index % 2 === 0
        ? "the same characters sitting separately with neutral expressions"
        : "the same characters standing separately with neutral expressions",
    })),
  };
}

/** Clone used only for the primary provider prompt; persistence and overlay retain the original. */
export function buildNeutralComicProviderScenePlan(plan: ScenePlan): ScenePlan {
  return {
    ...plan,
    sceneBackground: "ordinary indoor room",
    atmosphere: "neutral expressions and calm everyday mood",
    events: [],
    heroEventIds: [],
    heroScene: "two adult characters in an ordinary indoor room",
    panels: plan.panels.map((panel) => ({
      ...panel,
      sourceEventIds: [],
      situation: "two adult characters present with ordinary clothing",
      backgroundOverride: "ordinary indoor room",
      personaAction: panel.index % 2 === 0 ? "sitting separately" : "standing separately",
      characterAction: panel.index % 2 === 0 ? "sitting separately" : "standing separately",
      dialogue: [],
    })),
  };
}
