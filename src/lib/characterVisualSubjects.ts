/**
 * Character content-kind visual subject adapter.
 * Creator-managed supporting cast identities (not derived from simulation_cast).
 */

import type { CharacterAsset } from "@/lib/characterAssets";
import {
  VisualSubjectsInputError,
  clearStaleRepresentativeAssets,
  createVisualSubjectKey,
  emptyVisualSubjectsDocument,
  parseSubmittedVisualSubjectsJson,
  parseVisualSubjectsJson,
  serializeVisualSubjectsJson,
  validateVisualSubjectsDocument,
  type VisualSubject,
  type VisualSubjectsDocument,
} from "@/lib/visualSubjects";

export const CHARACTER_VISUAL_SUBJECT_LIMIT = 12;

export type CharacterVisualSubject = VisualSubject;
export type CharacterVisualSubjectsDocument = VisualSubjectsDocument;

export { VisualSubjectsInputError as CharacterVisualSubjectsInputError };

export function createCharacterVisualSubjectKey(): string {
  return createVisualSubjectKey();
}

export function emptyCharacterVisualSubjectsDocument(): CharacterVisualSubjectsDocument {
  return emptyVisualSubjectsDocument();
}

export const parseCharacterVisualSubjectsJson = parseVisualSubjectsJson;
export const serializeCharacterVisualSubjectsJson = serializeVisualSubjectsJson;
export const validateCharacterVisualSubjectsDocument = validateVisualSubjectsDocument;

export function configuredCharacterVisualSubjectNames(
  doc: CharacterVisualSubjectsDocument
): string[] {
  return doc.subjects.map((subject) => subject.name);
}

export function prepareCharacterVisualSubjectsForSave(opts: {
  submittedRaw: string | null | undefined;
  storedRaw: string | null | undefined;
  assets: readonly CharacterAsset[];
}): CharacterVisualSubjectsDocument {
  const submitted = parseSubmittedVisualSubjectsJson(opts.submittedRaw);
  if (submitted.subjects.length > CHARACTER_VISUAL_SUBJECT_LIMIT) {
    throw new VisualSubjectsInputError(
      `이미지 인물은 최대 ${CHARACTER_VISUAL_SUBJECT_LIMIT}명까지 등록할 수 있습니다.`
    );
  }
  const stored = parseVisualSubjectsJson(opts.storedRaw);
  const storedByKey = new Map(stored.subjects.map((subject) => [subject.subjectKey, subject]));
  const merged = submitted.subjects.map((subject) => {
    const existing = storedByKey.get(subject.subjectKey);
    if (!existing) return subject;
    return {
      ...subject,
      sourceCharacterId: existing.sourceCharacterId,
    };
  });
  const subjects = clearStaleRepresentativeAssets(merged, opts.assets);
  return { version: 1, subjects };
}
