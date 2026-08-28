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
  isGenericVisualSubjectKey,
  isLegacySimulationVisualSubjectKey,
  parseSubmittedVisualSubjectsJson,
  parseVisualSubjectsJson,
  sanitizeAssetVisualSubjectKeys,
  serializeVisualSubjectsJson,
  validateCharacterPrimaryAssetAssignment,
  validateVisualSubjectsDocument as validateVisualSubjectsDocumentCore,
  cleanVisualSubjectName,
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

export function validateCharacterVisualSubjectsDocument(
  doc: CharacterVisualSubjectsDocument,
  assets: readonly CharacterAsset[]
): { ok: true } | { ok: false; reason: string } {
  const primary = validateCharacterPrimaryAssetAssignment(assets);
  if (!primary.ok) return primary;
  return validateVisualSubjectsDocumentCore(doc, assets);
}

export function configuredCharacterVisualSubjectNames(
  doc: CharacterVisualSubjectsDocument
): string[] {
  return doc.subjects.map((subject) => subject.name);
}

export function preserveStoredCharacterVisualSubjectsForSave(opts: {
  storedRaw: string | null | undefined;
  assets: readonly CharacterAsset[];
}): CharacterVisualSubjectsDocument {
  const stored = parseVisualSubjectsJson(opts.storedRaw);
  const subjects = clearStaleRepresentativeAssets(stored.subjects, opts.assets);
  return { version: 1, subjects };
}

export function prepareCharacterVisualSubjectsForSave(opts: {
  submittedRaw: string | null | undefined;
  submittedProvided?: boolean;
  storedRaw: string | null | undefined;
  assets: readonly CharacterAsset[];
  mainCharacterName?: string;
}): CharacterVisualSubjectsDocument {
  if (opts.submittedProvided === false) {
    return preserveStoredCharacterVisualSubjectsForSave({
      storedRaw: opts.storedRaw,
      assets: opts.assets,
    });
  }

  const submitted = parseSubmittedVisualSubjectsJson(opts.submittedRaw);
  if (submitted.subjects.length > CHARACTER_VISUAL_SUBJECT_LIMIT) {
    throw new VisualSubjectsInputError(
      `이미지 인물은 최대 ${CHARACTER_VISUAL_SUBJECT_LIMIT}명까지 등록할 수 있습니다.`
    );
  }

  const mainName = cleanVisualSubjectName(opts.mainCharacterName).toLowerCase();
  if (mainName) {
    for (const subject of submitted.subjects) {
      if (subject.name.toLowerCase() === mainName) {
        throw new VisualSubjectsInputError(
          "조연·NPC 이름은 주인공 이름과 같을 수 없습니다."
        );
      }
    }
  }

  const stored = parseVisualSubjectsJson(opts.storedRaw);
  const storedByKey = new Map(stored.subjects.map((subject) => [subject.subjectKey, subject]));
  const merged = submitted.subjects.map((subject) => {
    const existing = storedByKey.get(subject.subjectKey);
    if (!existing) {
      if (isLegacySimulationVisualSubjectKey(subject.subjectKey)) {
        throw new VisualSubjectsInputError(
          "새 Character 이미지 인물은 vis_* 키만 사용할 수 있습니다."
        );
      }
      if (!isGenericVisualSubjectKey(subject.subjectKey)) {
        throw new VisualSubjectsInputError("이미지 인물 식별 키가 올바르지 않습니다.");
      }
      return {
        ...subject,
        sourceCharacterId: null,
      };
    }
    return {
      ...subject,
      sourceCharacterId: existing.sourceCharacterId,
    };
  });
  const subjects = clearStaleRepresentativeAssets(merged, opts.assets);
  return { version: 1, subjects };
}

export function prepareCharacterVisualSubjectsBundleForSave(opts: {
  submittedRaw: string | null | undefined;
  submittedProvided: boolean;
  storedRaw: string | null | undefined;
  assets: CharacterAsset[];
  mainCharacterName?: string;
}): { doc: CharacterVisualSubjectsDocument; assets: CharacterAsset[] } {
  const doc = prepareCharacterVisualSubjectsForSave({
    submittedRaw: opts.submittedRaw,
    submittedProvided: opts.submittedProvided,
    storedRaw: opts.storedRaw,
    assets: opts.assets,
    mainCharacterName: opts.mainCharacterName,
  });
  const assets = sanitizeAssetVisualSubjectKeys(opts.assets, doc.subjects);
  return { doc, assets };
}

export function countCharacterVisualSubjectOwnedAssets(
  subjectKey: string,
  assets: readonly CharacterAsset[]
): number {
  return assets.filter((asset) => asset.visualSubjectKey === subjectKey).length;
}
