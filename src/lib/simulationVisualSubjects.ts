/**
 * Simulation content-kind visual subject adapter.
 * Cast reconciliation + appearance extraction live here; shared domain in visualSubjects.ts.
 */

import type { CharacterAsset } from "@/lib/characterAssets";
import {
  extractExplicitVisualAppearanceSection,
} from "@/lib/chatImageVisualIdentity";
import {
  extractSimulationCastEntries,
  extractSimulationCastNames,
} from "@/lib/simulationMode";
import {
  VisualSubjectsInputError,
  assignAssetsToVisualSubject,
  assetsForVisualSubject,
  buildPublicVisualSubjectSummaries,
  clearStaleRepresentativeAssets,
  createLegacySimulationVisualSubjectKey,
  emptyVisualSubjectsDocument,
  isLegacySimulationVisualSubjectKey,
  isVisualSubjectKey,
  normalizeVisualSubjectSavedAppearance,
  parseSubmittedVisualSubjectsJson,
  parseVisualSubjectsJson,
  resolveSupportMemberVisualMetadata,
  resolveVisualSubjectByName,
  sanitizeAssetVisualSubjectKeys,
  serializeVisualSubjectsJson,
  unassignVisualAssets,
  unassignedVisualAssets,
  validateAssetVisualSubjectOwnership,
  validateRepresentativeAsset,
  validateVisualSubjectsDocument,
  cleanVisualSubjectName,
  type PublicVisualSubjectSummary,
  type VisualSubject,
  type VisualSubjectsDocument,
} from "@/lib/visualSubjects";

export const SIMULATION_VISUAL_SUBJECTS_VERSION = 1 as const;

export type SimulationVisualSubject = VisualSubject;
export type SimulationVisualSubjectsDocument = VisualSubjectsDocument;
export type PublicSimulationVisualSubjectSummary = PublicVisualSubjectSummary;

export class SimulationVisualSubjectsInputError extends VisualSubjectsInputError {
  constructor(message: string) {
    super(message);
    this.name = "SimulationVisualSubjectsInputError";
  }
}

export function createSimulationVisualSubjectKey(): string {
  return createLegacySimulationVisualSubjectKey();
}

export function isSimulationVisualSubjectKey(value: unknown): value is string {
  return isLegacySimulationVisualSubjectKey(value);
}

export function emptySimulationVisualSubjectsDocument(): SimulationVisualSubjectsDocument {
  return emptyVisualSubjectsDocument();
}

export const normalizeSubjectSavedAppearance = normalizeVisualSubjectSavedAppearance;
export const parseSimulationVisualSubjectsJson = parseVisualSubjectsJson;
export const serializeSimulationVisualSubjectsJson = serializeVisualSubjectsJson;

export {
  assignAssetsToVisualSubject,
  assetsForVisualSubject,
  buildPublicVisualSubjectSummaries,
  clearStaleRepresentativeAssets,
  resolveVisualSubjectByName,
  sanitizeAssetVisualSubjectKeys,
  unassignVisualAssets,
  unassignedVisualAssets,
  validateAssetVisualSubjectOwnership,
  validateRepresentativeAsset,
};

export function configuredSimulationCastNames(
  simulationCast: string,
  simulationTitle?: string
): string[] {
  const title = cleanVisualSubjectName(simulationTitle).toLowerCase();
  return extractSimulationCastNames(simulationCast).filter(
    (name) => cleanVisualSubjectName(name).toLowerCase() !== title
  );
}

export type ReconciledSimulationVisualSubjects = {
  active: SimulationVisualSubject[];
  orphaned: SimulationVisualSubject[];
};

export function reconcileSimulationVisualSubjects(opts: {
  configuredNames: readonly string[];
  storedSubjects: readonly SimulationVisualSubject[];
  simulationTitle?: string;
}): ReconciledSimulationVisualSubjects {
  const configured = opts.configuredNames.map(cleanVisualSubjectName).filter(Boolean);
  const configuredLower = new Set(configured.map((name) => name.toLowerCase()));
  const storedByExactName = new Map<string, SimulationVisualSubject[]>();
  for (const subject of opts.storedSubjects) {
    const key = subject.name.toLowerCase();
    const bucket = storedByExactName.get(key) ?? [];
    bucket.push(subject);
    storedByExactName.set(key, bucket);
  }

  const active: SimulationVisualSubject[] = [];
  const usedKeys = new Set<string>();

  for (const name of configured) {
    const matches = storedByExactName.get(name.toLowerCase()) ?? [];
    const reusable = matches.find((subject) => !usedKeys.has(subject.subjectKey));
    if (reusable) {
      usedKeys.add(reusable.subjectKey);
      active.push({ ...reusable, name });
      continue;
    }
    active.push({
      subjectKey: createSimulationVisualSubjectKey(),
      name,
      savedAppearance: "",
      representativeAssetUrl: null,
      sourceCharacterId: null,
    });
  }

  const orphaned = opts.storedSubjects.filter((subject) => !usedKeys.has(subject.subjectKey));
  void configuredLower;
  return { active, orphaned };
}

export function materializeSimulationVisualSubjectsForEditor(opts: {
  configuredNames: readonly string[];
  document: SimulationVisualSubjectsDocument;
}): SimulationVisualSubjectsDocument {
  const normalizedNames = opts.configuredNames.map(cleanVisualSubjectName).filter(Boolean);
  const alreadyMaterialized = normalizedNames.every((name) => {
    const matches = opts.document.subjects.filter(
      (subject) => subject.name.toLowerCase() === name.toLowerCase()
    );
    return matches.length === 1;
  });
  if (alreadyMaterialized) return opts.document;

  const reconciled = reconcileSimulationVisualSubjects({
    configuredNames: normalizedNames,
    storedSubjects: opts.document.subjects,
  });
  const seen = new Set<string>();
  const subjects: SimulationVisualSubject[] = [];
  for (const subject of [...reconciled.active, ...reconciled.orphaned]) {
    if (seen.has(subject.subjectKey)) continue;
    seen.add(subject.subjectKey);
    subjects.push(subject);
  }
  return { version: SIMULATION_VISUAL_SUBJECTS_VERSION, subjects };
}

export function resolveSimulationMemberVisualMetadata(opts: {
  memberName: string;
  castSubjectKey: string;
  visualSubjects: readonly SimulationVisualSubject[];
  assets: readonly CharacterAsset[];
}): {
  savedAppearance?: string;
  appearanceMode: "image_only" | "image_plus_saved";
} {
  void opts.assets;
  const meta = resolveSupportMemberVisualMetadata({
    memberName: opts.memberName,
    castSubjectKey: opts.castSubjectKey,
    visualSubjects: opts.visualSubjects,
  });
  return {
    savedAppearance: meta.savedAppearance,
    appearanceMode: meta.appearanceMode,
  };
}

function parseSubmittedSimulationVisualSubjectsJson(
  raw: string | null | undefined
): SimulationVisualSubjectsDocument {
  try {
    return parseSubmittedVisualSubjectsJson(raw);
  } catch (error) {
    if (error instanceof VisualSubjectsInputError) {
      throw new SimulationVisualSubjectsInputError(error.message);
    }
    throw error;
  }
}

export function prepareSimulationVisualSubjectsForSave(opts: {
  simulationCast: string;
  simulationTitle: string;
  submittedRaw: string | null | undefined;
  storedRaw: string | null | undefined;
  assets: readonly CharacterAsset[];
}): SimulationVisualSubjectsDocument {
  const submitted = parseSubmittedSimulationVisualSubjectsJson(opts.submittedRaw);
  const stored = parseSimulationVisualSubjectsJson(opts.storedRaw);
  const configuredNames = configuredSimulationCastNames(opts.simulationCast, opts.simulationTitle);
  const reconciled = reconcileSimulationVisualSubjects({
    configuredNames,
    storedSubjects: stored.subjects,
  });
  const extractedAppearanceByName = new Map(
    extractSimulationCastEntries(opts.simulationCast).map((entry) => [
      entry.name.toLowerCase(),
      extractExplicitVisualAppearanceSection(entry.settings),
    ])
  );

  const submittedByName = new Map(submitted.subjects.map((row) => [row.name.toLowerCase(), row]));
  const active = reconciled.active.map((subject) => {
    const override = submittedByName.get(subject.name.toLowerCase());
    const isStoredSubject = stored.subjects.some(
      (storedSubject) => storedSubject.subjectKey === subject.subjectKey
    );
    const extractedAppearance =
      extractedAppearanceByName.get(subject.name.toLowerCase()) ??
      ({ found: false, text: "" } as const);
    const savedAppearance = extractedAppearance.found
      ? normalizeVisualSubjectSavedAppearance(extractedAppearance.text)
      : isStoredSubject
        ? subject.savedAppearance
        : "";
    return {
      subjectKey: isStoredSubject || !override ? subject.subjectKey : override.subjectKey,
      name: subject.name,
      savedAppearance,
      representativeAssetUrl: override?.representativeAssetUrl ?? subject.representativeAssetUrl,
      sourceCharacterId: isStoredSubject ? subject.sourceCharacterId : null,
    };
  });

  const subjects = clearStaleRepresentativeAssets(
    [...active, ...reconciled.orphaned],
    opts.assets
  );
  return { version: SIMULATION_VISUAL_SUBJECTS_VERSION, subjects };
}

export function validateSimulationVisualSubjectsDocument(
  doc: SimulationVisualSubjectsDocument,
  assets: readonly CharacterAsset[]
): { ok: true } | { ok: false; reason: string } {
  for (const subject of doc.subjects) {
    if (!isVisualSubjectKey(subject.subjectKey)) {
      return { ok: false, reason: "visual subject key가 올바르지 않습니다." };
    }
  }
  return validateVisualSubjectsDocument(doc, assets);
}
