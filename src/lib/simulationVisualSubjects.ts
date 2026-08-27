/**
 * Canonical simulation visual subject owner.
 * Stable per-character visual identity (subjectKey, savedAppearance, representative asset)
 * separate from narrative cast and scene inclusion (#685).
 */

import type { CharacterAsset } from "@/lib/characterAssets";
import { assetByUrl } from "@/lib/characterAssets";
import {
  clipSavedAppearanceForPrompt,
  extractExplicitVisualAppearanceSection,
} from "@/lib/chatImageVisualIdentity";
import {
  extractSimulationCastEntries,
  extractSimulationCastNames,
} from "@/lib/simulationMode";

export const SIMULATION_VISUAL_SUBJECTS_VERSION = 1 as const;

export type SimulationVisualSubject = {
  subjectKey: string;
  name: string;
  savedAppearance: string;
  representativeAssetUrl: string | null;
  sourceCharacterId: number | null;
};

export type SimulationVisualSubjectsDocument = {
  version: typeof SIMULATION_VISUAL_SUBJECTS_VERSION;
  subjects: SimulationVisualSubject[];
};

export type ReconciledSimulationVisualSubjects = {
  active: SimulationVisualSubject[];
  orphaned: SimulationVisualSubject[];
};

const SUBJECT_KEY_PREFIX = "simvis_";
const SUBJECT_KEY_PATTERN =
  /^simvis_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SimulationVisualSubjectsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationVisualSubjectsInputError";
  }
}

export function createSimulationVisualSubjectKey(): string {
  return `${SUBJECT_KEY_PREFIX}${globalThis.crypto.randomUUID()}`;
}

export function isSimulationVisualSubjectKey(value: unknown): value is string {
  return typeof value === "string" && SUBJECT_KEY_PATTERN.test(value);
}

export function emptySimulationVisualSubjectsDocument(): SimulationVisualSubjectsDocument {
  return { version: SIMULATION_VISUAL_SUBJECTS_VERSION, subjects: [] };
}

export function normalizeSubjectSavedAppearance(raw: unknown): string {
  return clipSavedAppearanceForPrompt(String(raw ?? ""));
}

function cleanSubjectName(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function normalizeStoredSubject(raw: unknown): SimulationVisualSubject | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const subjectKey = String(row.subjectKey ?? "").trim();
  const name = cleanSubjectName(row.name);
  if (!isSimulationVisualSubjectKey(subjectKey) || !name) return null;
  const sourceCharacterId = Number(row.sourceCharacterId);
  const representativeAssetUrl =
    typeof row.representativeAssetUrl === "string" && row.representativeAssetUrl.trim()
      ? row.representativeAssetUrl.trim()
      : typeof row.representativeAssetId === "string" && row.representativeAssetId.trim()
        ? row.representativeAssetId.trim()
        : null;
  return {
    subjectKey,
    name,
    savedAppearance: normalizeSubjectSavedAppearance(row.savedAppearance),
    representativeAssetUrl,
    sourceCharacterId:
      Number.isInteger(sourceCharacterId) && sourceCharacterId > 0 ? sourceCharacterId : null,
  };
}

export function parseSimulationVisualSubjectsJson(
  raw: string | null | undefined
): SimulationVisualSubjectsDocument {
  if (!raw?.trim()) return emptySimulationVisualSubjectsDocument();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptySimulationVisualSubjectsDocument();
    const doc = parsed as Record<string, unknown>;
    const subjects = Array.isArray(doc.subjects)
      ? doc.subjects
          .map(normalizeStoredSubject)
          .filter((subject): subject is SimulationVisualSubject => Boolean(subject))
      : [];
    return { version: SIMULATION_VISUAL_SUBJECTS_VERSION, subjects };
  } catch {
    return emptySimulationVisualSubjectsDocument();
  }
}

export function serializeSimulationVisualSubjectsJson(
  doc: SimulationVisualSubjectsDocument
): string {
  return JSON.stringify({
    version: SIMULATION_VISUAL_SUBJECTS_VERSION,
    subjects: doc.subjects.map((subject) => ({
      subjectKey: subject.subjectKey,
      name: subject.name,
      savedAppearance: normalizeSubjectSavedAppearance(subject.savedAppearance),
      representativeAssetUrl: subject.representativeAssetUrl,
      sourceCharacterId: subject.sourceCharacterId,
    })),
  });
}

function dedupeSubjectsByKey(subjects: SimulationVisualSubject[]): SimulationVisualSubject[] {
  const seen = new Set<string>();
  const result: SimulationVisualSubject[] = [];
  for (const subject of subjects) {
    if (seen.has(subject.subjectKey)) continue;
    seen.add(subject.subjectKey);
    result.push(subject);
  }
  return result;
}

function parseSubmittedSimulationVisualSubjectsJson(
  raw: string | null | undefined
): SimulationVisualSubjectsDocument {
  if (!raw?.trim()) return emptySimulationVisualSubjectsDocument();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SimulationVisualSubjectsInputError("이미지 인물 설정 형식이 올바르지 않습니다.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SimulationVisualSubjectsInputError("이미지 인물 설정 형식이 올바르지 않습니다.");
  }
  const row = parsed as Record<string, unknown>;
  if (row.version !== SIMULATION_VISUAL_SUBJECTS_VERSION || !Array.isArray(row.subjects)) {
    throw new SimulationVisualSubjectsInputError("이미지 인물 설정 버전이 올바르지 않습니다.");
  }

  const subjects = row.subjects.map(normalizeStoredSubject);
  if (subjects.some((subject) => !subject)) {
    throw new SimulationVisualSubjectsInputError("이미지 인물 식별 키가 올바르지 않습니다.");
  }
  const validSubjects = subjects as SimulationVisualSubject[];
  const keys = new Set<string>();
  const names = new Set<string>();
  for (const subject of validSubjects) {
    const exactName = subject.name.toLowerCase();
    if (keys.has(subject.subjectKey)) {
      throw new SimulationVisualSubjectsInputError("이미지 인물 식별 키가 중복되었습니다.");
    }
    if (names.has(exactName)) {
      throw new SimulationVisualSubjectsInputError("같은 이름의 이미지 인물 설정이 중복되었습니다.");
    }
    keys.add(subject.subjectKey);
    names.add(exactName);
  }
  return { version: SIMULATION_VISUAL_SUBJECTS_VERSION, subjects: validSubjects };
}

export function configuredSimulationCastNames(
  simulationCast: string,
  simulationTitle?: string
): string[] {
  const title = cleanSubjectName(simulationTitle).toLowerCase();
  return extractSimulationCastNames(simulationCast).filter(
    (name) => cleanSubjectName(name).toLowerCase() !== title
  );
}

export function reconcileSimulationVisualSubjects(opts: {
  configuredNames: readonly string[];
  storedSubjects: readonly SimulationVisualSubject[];
  simulationTitle?: string;
}): ReconciledSimulationVisualSubjects {
  const configured = opts.configuredNames.map(cleanSubjectName).filter(Boolean);
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

  // Preserve orphaned subjects even if their name reappears under ambiguous duplicate storage.
  void configuredLower;
  return { active, orphaned };
}

export function materializeSimulationVisualSubjectsForEditor(opts: {
  configuredNames: readonly string[];
  document: SimulationVisualSubjectsDocument;
}): SimulationVisualSubjectsDocument {
  const normalizedNames = opts.configuredNames.map(cleanSubjectName).filter(Boolean);
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
  return {
    version: SIMULATION_VISUAL_SUBJECTS_VERSION,
    subjects: dedupeSubjectsByKey([...reconciled.active, ...reconciled.orphaned]),
  };
}

export function resolveVisualSubjectByName(
  subjects: readonly SimulationVisualSubject[],
  name: string
): SimulationVisualSubject | null {
  const target = cleanSubjectName(name).toLowerCase();
  if (!target) return null;
  const matches = subjects.filter((subject) => subject.name.toLowerCase() === target);
  if (matches.length === 1) return matches[0] ?? null;
  return null;
}

export function assetsForVisualSubject(
  assets: readonly CharacterAsset[],
  subjectKey: string
): CharacterAsset[] {
  return assets.filter((asset) => asset.visualSubjectKey === subjectKey);
}

export function unassignedVisualAssets(assets: readonly CharacterAsset[]): CharacterAsset[] {
  return assets.filter((asset) => !asset.visualSubjectKey);
}

export function assignAssetsToVisualSubject(
  assets: CharacterAsset[],
  urls: readonly string[],
  subjectKey: string
): CharacterAsset[] {
  const targets = new Set(urls.map((url) => url.trim()).filter(Boolean));
  if (!isSimulationVisualSubjectKey(subjectKey) || targets.size === 0) return assets;
  return assets.map((asset) =>
    targets.has(asset.url) ? { ...asset, visualSubjectKey: subjectKey } : asset
  );
}

export function unassignVisualAssets(
  assets: CharacterAsset[],
  urls: readonly string[]
): CharacterAsset[] {
  const targets = new Set(urls.map((url) => url.trim()).filter(Boolean));
  if (targets.size === 0) return assets;
  return assets.map((asset) =>
    targets.has(asset.url) ? { ...asset, visualSubjectKey: undefined } : asset
  );
}

export function validateRepresentativeAsset(
  subject: SimulationVisualSubject,
  assets: readonly CharacterAsset[]
): string | null {
  const url = subject.representativeAssetUrl?.trim();
  if (!url) return null;
  const owned = assetByUrl([...assets], url);
  if (!owned) return null;
  if (owned.visualSubjectKey !== subject.subjectKey) return null;
  return url;
}

export function clearStaleRepresentativeAssets(
  subjects: readonly SimulationVisualSubject[],
  assets: readonly CharacterAsset[]
): SimulationVisualSubject[] {
  return subjects.map((subject) => {
    const validated = validateRepresentativeAsset(subject, assets);
    if (validated === subject.representativeAssetUrl) return subject;
    return { ...subject, representativeAssetUrl: validated };
  });
}

export function validateAssetVisualSubjectOwnership(opts: {
  assetUrl: string;
  subjectKey: string;
  assets: readonly CharacterAsset[];
}): { ok: true } | { ok: false; reason: string } {
  const asset = assetByUrl([...opts.assets], opts.assetUrl);
  if (!asset) {
    return { ok: false, reason: "선택한 참고 에셋을 사용할 수 없습니다." };
  }
  const ownerKey = asset.visualSubjectKey?.trim();
  if (!ownerKey) return { ok: true };
  if (ownerKey === opts.subjectKey) return { ok: true };
  return {
    ok: false,
    reason: "다른 인물에 연결된 이미지는 해당 인물 reference로 사용할 수 없습니다.",
  };
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
  const subject =
    resolveVisualSubjectByName(opts.visualSubjects, opts.memberName) ??
    opts.visualSubjects.find((row) => row.subjectKey === opts.castSubjectKey) ??
    null;
  const savedAppearance = normalizeSubjectSavedAppearance(subject?.savedAppearance);
  return {
    savedAppearance: savedAppearance || undefined,
    appearanceMode: savedAppearance ? "image_plus_saved" : "image_only",
  };
}

export type PublicSimulationVisualSubjectSummary = {
  name: string;
  hasSavedAppearance: boolean;
  ownedAssetCount: number;
  hasRepresentativeAsset: boolean;
};

export function buildPublicVisualSubjectSummaries(
  subjects: readonly SimulationVisualSubject[],
  assets: readonly CharacterAsset[]
): PublicSimulationVisualSubjectSummary[] {
  return subjects.map((subject) => {
    const owned = assetsForVisualSubject(assets, subject.subjectKey);
    return {
      name: subject.name,
      hasSavedAppearance: Boolean(normalizeSubjectSavedAppearance(subject.savedAppearance)),
      ownedAssetCount: owned.length,
      hasRepresentativeAsset: Boolean(validateRepresentativeAsset(subject, assets)),
    };
  });
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
      normalizeSubjectSavedAppearance(
        extractExplicitVisualAppearanceSection(entry.settings)
      ),
    ])
  );

  const submittedByName = new Map(submitted.subjects.map((row) => [row.name.toLowerCase(), row]));
  const active = reconciled.active.map((subject) => {
    const override = submittedByName.get(subject.name.toLowerCase());
    const isStoredSubject = stored.subjects.some(
      (storedSubject) => storedSubject.subjectKey === subject.subjectKey
    );
    const extractedAppearance =
      extractedAppearanceByName.get(subject.name.toLowerCase()) ?? "";
    return {
      subjectKey:
        isStoredSubject || !override ? subject.subjectKey : override.subjectKey,
      name: subject.name,
      savedAppearance:
        extractedAppearance || (isStoredSubject ? subject.savedAppearance : ""),
      representativeAssetUrl:
        override?.representativeAssetUrl ?? subject.representativeAssetUrl,
      sourceCharacterId: isStoredSubject ? subject.sourceCharacterId : null,
    };
  });

  const subjects = clearStaleRepresentativeAssets(
    [...active, ...reconciled.orphaned],
    opts.assets
  );
  return { version: SIMULATION_VISUAL_SUBJECTS_VERSION, subjects };
}

export function sanitizeAssetVisualSubjectKeys(
  assets: CharacterAsset[],
  subjects: readonly SimulationVisualSubject[]
): CharacterAsset[] {
  const allowed = new Set(subjects.map((subject) => subject.subjectKey));
  return assets.map((asset) => {
    if (!asset.visualSubjectKey) return asset;
    if (allowed.has(asset.visualSubjectKey)) return asset;
    const { visualSubjectKey: _removed, ...rest } = asset;
    return rest;
  });
}

export function validateSimulationVisualSubjectsDocument(
  doc: SimulationVisualSubjectsDocument,
  assets: readonly CharacterAsset[]
): { ok: true } | { ok: false; reason: string } {
  const keys = new Set<string>();
  for (const subject of doc.subjects) {
    if (!isSimulationVisualSubjectKey(subject.subjectKey)) {
      return { ok: false, reason: "visual subject key가 올바르지 않습니다." };
    }
    if (keys.has(subject.subjectKey)) {
      return { ok: false, reason: "visual subject key가 중복되었습니다." };
    }
    keys.add(subject.subjectKey);
    if (subject.representativeAssetUrl) {
      const validated = validateRepresentativeAsset(subject, assets);
      if (!validated) {
        return { ok: false, reason: "대표 이미지는 해당 인물 소유 asset만 선택할 수 있습니다." };
      }
    }
  }

  const urlOwners = new Map<string, string>();
  for (const asset of assets) {
    const owner = asset.visualSubjectKey?.trim();
    if (!owner) continue;
    if (!keys.has(owner)) {
      return { ok: false, reason: "존재하지 않는 인물에 연결된 이미지가 있습니다." };
    }
    if (urlOwners.has(asset.url)) {
      return { ok: false, reason: "동일 이미지에 중복 ownership이 있습니다." };
    }
    urlOwners.set(asset.url, owner);
  }
  return { ok: true };
}
