import type { CanonKnowledgeBucket } from "@/lib/characterKnowledgeBoundary";

export type KnowledgeVisibility = "PUBLIC" | "LOCKED_SECRET" | "CONDITIONAL";

/** Explicit author marker — bucket=character, visibility=LOCKED_SECRET (S2 eligible). */
export const AUTHOR_MARKER_CHARACTER_KNOWN =
  /(?:^|\[)\s*비밀\s*[—\-–]\s*캐릭터(?:는|이)\s*앎\s*(?:\]|$)/i;

/** Explicit author marker — NOT character-known; route to CONDITIONAL. */
export const AUTHOR_MARKER_CHARACTER_UNKNOWN =
  /(?:^|\[)\s*비밀\s*[—\-–]\s*캐릭터(?:도|는)\s*모름\s*(?:\]|$)/i;

export const AUTHOR_MARKER_CONDITIONAL = /(?:^|\[)\s*조건부\s*공개\s*(?:\]|$)/i;

/** Legacy `[비밀]` without explicit character-known/unknown markers. */
export const LEGACY_AMBIGUOUS_SECRET_TITLE = /^(?:\[)?\s*비밀\s*(?:\])?$/i;

export function normalizeSectionTitleForVisibility(title: string): string {
  return title.trim().replace(/^\[|\]$/g, "").trim();
}

export function resolveSectionAuthorVisibility(sectionTitle: string): KnowledgeVisibility | null {
  const normalized = normalizeSectionTitleForVisibility(sectionTitle);
  if (!normalized) return null;
  const bracketed = `[${normalized}]`;
  if (AUTHOR_MARKER_CHARACTER_KNOWN.test(bracketed) || AUTHOR_MARKER_CHARACTER_KNOWN.test(normalized)) {
    return "LOCKED_SECRET";
  }
  if (
    AUTHOR_MARKER_CHARACTER_UNKNOWN.test(bracketed) ||
    AUTHOR_MARKER_CHARACTER_UNKNOWN.test(normalized) ||
    AUTHOR_MARKER_CONDITIONAL.test(bracketed) ||
    AUTHOR_MARKER_CONDITIONAL.test(normalized)
  ) {
    return "CONDITIONAL";
  }
  if (LEGACY_AMBIGUOUS_SECRET_TITLE.test(normalized)) {
    return "CONDITIONAL";
  }
  return null;
}

export function resolveChunkVisibility(input: {
  sectionTitle: string;
  bucket: CanonKnowledgeBucket;
  text?: string;
}): KnowledgeVisibility {
  const fromTitle = resolveSectionAuthorVisibility(input.sectionTitle);
  if (fromTitle) return fromTitle;

  if (input.bucket === "player" || input.bucket === "scenario_meta") {
    return "CONDITIONAL";
  }

  if (input.sectionTitle === "hidden_event_note") {
    return "CONDITIONAL";
  }

  return "PUBLIC";
}

/** Fail-closed: only explicit PUBLIC is eligible for ordinary public render/ACTIVE. */
export function isPublicVisibleChunk(visibility: KnowledgeVisibility | undefined): boolean {
  return visibility === "PUBLIC";
}

export function isValidKnowledgeVisibility(value: unknown): value is KnowledgeVisibility {
  return value === "PUBLIC" || value === "LOCKED_SECRET" || value === "CONDITIONAL";
}

export function isLockedCharacterSecretChunk(
  chunk: { bucket: CanonKnowledgeBucket; visibility?: KnowledgeVisibility }
): boolean {
  return chunk.bucket === "character" && chunk.visibility === "LOCKED_SECRET";
}

export type CanonVisibilityCounts = {
  publicCount: number;
  lockedSecretCount: number;
  conditionalCount: number;
};

export function countVisibility(chunks: { visibility?: KnowledgeVisibility }[]): CanonVisibilityCounts {
  let publicCount = 0;
  let lockedSecretCount = 0;
  let conditionalCount = 0;
  for (const chunk of chunks) {
    const v = chunk.visibility;
    if (v === "PUBLIC") publicCount++;
    else if (v === "LOCKED_SECRET") lockedSecretCount++;
    else if (v === "CONDITIONAL") conditionalCount++;
  }
  return { publicCount, lockedSecretCount, conditionalCount };
}
