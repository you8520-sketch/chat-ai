/**
 * Generic visual subject domain — stable named visual identity + owned reference assets.
 * Physical DB column remains `simulation_visual_subjects_json` (legacy name, both content kinds).
 */

import type { ContentKind } from "@/lib/simulationMode";
import type { CharacterAsset } from "@/lib/characterAssets";
import { assetByUrl } from "@/lib/characterAssets";
import { clipSavedAppearanceForPrompt } from "@/lib/chatImageVisualIdentity";

export const VISUAL_SUBJECTS_VERSION = 1 as const;
export const VISUAL_SUBJECT_NAME_LIMIT = 80;

const LEGACY_SIMVIS_KEY_PATTERN =
  /^simvis_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GENERIC_VIS_KEY_PATTERN =
  /^vis_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VisualSubject = {
  subjectKey: string;
  name: string;
  savedAppearance: string;
  representativeAssetUrl: string | null;
  sourceCharacterId: number | null;
};

export type VisualSubjectsDocument = {
  version: typeof VISUAL_SUBJECTS_VERSION;
  subjects: VisualSubject[];
};

export class VisualSubjectsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisualSubjectsInputError";
  }
}

export function createVisualSubjectKey(): string {
  return `vis_${globalThis.crypto.randomUUID()}`;
}

export function createLegacySimulationVisualSubjectKey(): string {
  return `simvis_${globalThis.crypto.randomUUID()}`;
}

export function isLegacySimulationVisualSubjectKey(value: unknown): value is string {
  return typeof value === "string" && LEGACY_SIMVIS_KEY_PATTERN.test(value);
}

export function isVisualSubjectKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (LEGACY_SIMVIS_KEY_PATTERN.test(value) || GENERIC_VIS_KEY_PATTERN.test(value))
  );
}

export function isGenericVisualSubjectKey(value: unknown): value is string {
  return typeof value === "string" && GENERIC_VIS_KEY_PATTERN.test(value);
}

export type ClientVisibleVisualSubject = {
  subjectKey: string;
  name: string;
  representativeAssetUrl?: string;
};

export type VisualSubjectsBodyField = {
  provided: boolean;
  raw: string;
};

export function extractVisualSubjectsFromBody(b: Record<string, unknown>): VisualSubjectsBodyField {
  if (typeof b.visual_subjects_json === "string") {
    return { provided: true, raw: b.visual_subjects_json };
  }
  if (b.visual_subjects != null) {
    return { provided: true, raw: JSON.stringify(b.visual_subjects) };
  }
  if (typeof b.simulation_visual_subjects_json === "string") {
    return { provided: true, raw: b.simulation_visual_subjects_json };
  }
  if (b.simulation_visual_subjects != null) {
    return { provided: true, raw: JSON.stringify(b.simulation_visual_subjects) };
  }
  return { provided: false, raw: "" };
}

/** Single owner for client-safe visual identity views (no savedAppearance / sourceCharacterId). */
export function buildClientVisibleVisualSubjects(opts: {
  subjects: readonly VisualSubject[];
  assets: readonly CharacterAsset[];
  visibleNames: readonly string[];
  /** When set, representative URLs are emitted only if present in this viewer-authorized pool. */
  viewerAuthorizedAssetUrls?: ReadonlySet<string>;
}): ClientVisibleVisualSubject[] {
  const visible = new Set(
    opts.visibleNames.map((name) => cleanVisualSubjectName(name).toLowerCase()).filter(Boolean)
  );
  if (visible.size === 0) return [];
  return opts.subjects
    .filter((subject) => visible.has(subject.name.toLowerCase()))
    .map((subject) => {
      const ownedRepresentative = validateRepresentativeAsset(subject, opts.assets);
      const representativeAssetUrl =
        ownedRepresentative &&
        (!opts.viewerAuthorizedAssetUrls ||
          opts.viewerAuthorizedAssetUrls.has(ownedRepresentative))
          ? ownedRepresentative
          : undefined;
      return {
        subjectKey: subject.subjectKey,
        name: subject.name,
        ...(representativeAssetUrl ? { representativeAssetUrl } : {}),
      };
    });
}

export function filterCastSelectableAssetsForViewer(opts: {
  assets: readonly { url: string; tag: string; visualSubjectKey?: string }[];
  visibleSubjectKeys: ReadonlySet<string>;
  isCreator: boolean;
  contentKind: ContentKind;
  /** Preflight = main pool only; source_scoped = viewer-authorized support assets. */
  scope?: "preflight" | "source_scoped";
}): typeof opts.assets {
  const scope = opts.scope ?? "source_scoped";
  if (scope === "preflight") {
    if (opts.contentKind === "character") {
      return opts.assets.filter((asset) => !asset.visualSubjectKey?.trim());
    }
    return opts.isCreator ? [...opts.assets] : [];
  }
  if (opts.isCreator) return [...opts.assets];
  return opts.assets.filter((asset) => {
    const ownerKey = asset.visualSubjectKey?.trim();
    if (!ownerKey) {
      return opts.contentKind === "simulation";
    }
    return opts.visibleSubjectKeys.has(ownerKey);
  });
}

/** Single owner for source-scoped client cast image metadata (names, safe identities, assets). */
export function buildClientScopedCastImageMetadata(opts: {
  contentKind: ContentKind;
  isCreator: boolean;
  subjects: readonly VisualSubject[];
  assets: readonly CharacterAsset[];
  castSelectableAssets: readonly { url: string; tag: string; visualSubjectKey?: string }[];
  visibleNames: readonly string[];
  scope: "preflight" | "source_scoped";
}): {
  configuredCastNames: string[];
  visualSubjects: ClientVisibleVisualSubject[];
  castSelectableAssets: typeof opts.castSelectableAssets;
} {
  if (opts.scope === "preflight") {
    return {
      configuredCastNames: [],
      visualSubjects: [],
      castSelectableAssets: filterCastSelectableAssetsForViewer({
        assets: opts.castSelectableAssets,
        visibleSubjectKeys: new Set(),
        isCreator: opts.isCreator,
        contentKind: opts.contentKind,
        scope: "preflight",
      }),
    };
  }
  const configuredCastNames = opts.visibleNames.map((name) => cleanVisualSubjectName(name)).filter(Boolean);
  const visibleSubjectKeys = new Set(
    opts.subjects
      .filter((subject) =>
        configuredCastNames.some(
          (name) => name.toLowerCase() === subject.name.toLowerCase()
        )
      )
      .map((subject) => subject.subjectKey)
  );
  const castSelectableAssets = filterCastSelectableAssetsForViewer({
    assets: opts.castSelectableAssets,
    visibleSubjectKeys,
    isCreator: opts.isCreator,
    contentKind: opts.contentKind,
    scope: "source_scoped",
  });
  const viewerAuthorizedAssetUrls = new Set(
    castSelectableAssets.map((asset) => asset.url)
  );
  const visualSubjects = buildClientVisibleVisualSubjects({
    subjects: opts.subjects,
    assets: opts.assets,
    visibleNames: configuredCastNames,
    viewerAuthorizedAssetUrls,
  });
  return { configuredCastNames, visualSubjects, castSelectableAssets };
}

export const CHARACTER_PRIMARY_SLOT_SUPPORT_MESSAGE =
  "다음 이미지가 조연에 지정되어 있어 대표 이미지로 올 수 없습니다. 먼저 이미지 인물 지정을 변경해 주세요.";

export function validateCharacterPrimaryAssetAssignment(
  assets: readonly CharacterAsset[]
): { ok: true } | { ok: false; reason: string } {
  const primaryKey = assets[0]?.visualSubjectKey?.trim();
  if (primaryKey) {
    return {
      ok: false,
      reason: "대표(1번) 이미지는 주인공 전용입니다. 조연 인물 지정을 해제해 주세요.",
    };
  }
  return { ok: true };
}

/** Validates a candidate asset order after Character reorder/delete. */
export function validateCharacterPrimarySlotCandidate(
  assets: readonly CharacterAsset[]
): { ok: true } | { ok: false; reason: string } {
  const primaryKey = assets[0]?.visualSubjectKey?.trim();
  if (primaryKey) {
    return { ok: false, reason: CHARACTER_PRIMARY_SLOT_SUPPORT_MESSAGE };
  }
  return { ok: true };
}

export function emptyVisualSubjectsDocument(): VisualSubjectsDocument {
  return { version: VISUAL_SUBJECTS_VERSION, subjects: [] };
}

export function normalizeVisualSubjectSavedAppearance(raw: unknown): string {
  return clipSavedAppearanceForPrompt(String(raw ?? ""));
}

export function cleanVisualSubjectName(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, VISUAL_SUBJECT_NAME_LIMIT);
}

function normalizeStoredSubject(raw: unknown): VisualSubject | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const subjectKey = String(row.subjectKey ?? "").trim();
  const name = cleanVisualSubjectName(row.name);
  if (!isVisualSubjectKey(subjectKey) || !name) return null;
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
    savedAppearance: normalizeVisualSubjectSavedAppearance(row.savedAppearance),
    representativeAssetUrl,
    sourceCharacterId:
      Number.isInteger(sourceCharacterId) && sourceCharacterId > 0 ? sourceCharacterId : null,
  };
}

export function parseVisualSubjectsJson(
  raw: string | null | undefined
): VisualSubjectsDocument {
  if (!raw?.trim()) return emptyVisualSubjectsDocument();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyVisualSubjectsDocument();
    const doc = parsed as Record<string, unknown>;
    const subjects = Array.isArray(doc.subjects)
      ? doc.subjects
          .map(normalizeStoredSubject)
          .filter((subject): subject is VisualSubject => Boolean(subject))
      : [];
    return { version: VISUAL_SUBJECTS_VERSION, subjects };
  } catch {
    return emptyVisualSubjectsDocument();
  }
}

export function serializeVisualSubjectsJson(doc: VisualSubjectsDocument): string {
  return JSON.stringify({
    version: VISUAL_SUBJECTS_VERSION,
    subjects: doc.subjects.map((subject) => ({
      subjectKey: subject.subjectKey,
      name: subject.name,
      savedAppearance: normalizeVisualSubjectSavedAppearance(subject.savedAppearance),
      representativeAssetUrl: subject.representativeAssetUrl,
      sourceCharacterId: subject.sourceCharacterId,
    })),
  });
}

function dedupeSubjectsByKey(subjects: VisualSubject[]): VisualSubject[] {
  const seen = new Set<string>();
  const result: VisualSubject[] = [];
  for (const subject of subjects) {
    if (seen.has(subject.subjectKey)) continue;
    seen.add(subject.subjectKey);
    result.push(subject);
  }
  return result;
}

export function parseSubmittedVisualSubjectsJson(
  raw: string | null | undefined
): VisualSubjectsDocument {
  if (!raw?.trim()) return emptyVisualSubjectsDocument();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VisualSubjectsInputError("이미지 인물 설정 형식이 올바르지 않습니다.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new VisualSubjectsInputError("이미지 인물 설정 형식이 올바르지 않습니다.");
  }
  const row = parsed as Record<string, unknown>;
  if (row.version !== VISUAL_SUBJECTS_VERSION || !Array.isArray(row.subjects)) {
    throw new VisualSubjectsInputError("이미지 인물 설정 버전이 올바르지 않습니다.");
  }

  const subjects = row.subjects.map(normalizeStoredSubject);
  if (subjects.some((subject) => !subject)) {
    throw new VisualSubjectsInputError("이미지 인물 식별 키가 올바르지 않습니다.");
  }
  const validSubjects = subjects as VisualSubject[];
  const keys = new Set<string>();
  const names = new Set<string>();
  for (const subject of validSubjects) {
    const exactName = subject.name.toLowerCase();
    if (keys.has(subject.subjectKey)) {
      throw new VisualSubjectsInputError("이미지 인물 식별 키가 중복되었습니다.");
    }
    if (names.has(exactName)) {
      throw new VisualSubjectsInputError("같은 이름의 이미지 인물 설정이 중복되었습니다.");
    }
    keys.add(subject.subjectKey);
    names.add(exactName);
  }
  return { version: VISUAL_SUBJECTS_VERSION, subjects: validSubjects };
}

export function resolveVisualSubjectByName(
  subjects: readonly VisualSubject[],
  name: string
): VisualSubject | null {
  const target = cleanVisualSubjectName(name).toLowerCase();
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
  if (!isVisualSubjectKey(subjectKey) || targets.size === 0) return assets;
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
  subject: VisualSubject,
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
  subjects: readonly VisualSubject[],
  assets: readonly CharacterAsset[]
): VisualSubject[] {
  return subjects.map((subject) => {
    const validated = validateRepresentativeAsset(subject, assets);
    if (validated === subject.representativeAssetUrl) return subject;
    return { ...subject, representativeAssetUrl: validated };
  });
}

export function validateAssetVisualSubjectOwnership(opts: {
  contentKind?: ContentKind;
  assetUrl: string;
  subjectKey: string;
  assets: readonly CharacterAsset[];
  requireExactSubjectOwner?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  const asset = assetByUrl([...opts.assets], opts.assetUrl);
  if (!asset) {
    return { ok: false, reason: "선택한 참고 에셋을 사용할 수 없습니다." };
  }
  const ownerKey = asset.visualSubjectKey?.trim();
  const exactRequired =
    opts.requireExactSubjectOwner === true || opts.contentKind === "character";
  if (exactRequired) {
    if (!ownerKey || ownerKey !== opts.subjectKey) {
      return {
        ok: false,
        reason: "다른 인물에 연결된 이미지는 해당 인물 reference로 사용할 수 없습니다.",
      };
    }
    return { ok: true };
  }
  if (!ownerKey) return { ok: true };
  if (ownerKey === opts.subjectKey) return { ok: true };
  return {
    ok: false,
    reason: "다른 인물에 연결된 이미지는 해당 인물 reference로 사용할 수 없습니다.",
  };
}

export function sanitizeAssetVisualSubjectKeys(
  assets: CharacterAsset[],
  subjects: readonly VisualSubject[]
): CharacterAsset[] {
  const allowed = new Set(subjects.map((subject) => subject.subjectKey));
  return assets.map((asset) => {
    if (!asset.visualSubjectKey) return asset;
    if (allowed.has(asset.visualSubjectKey)) return asset;
    const { visualSubjectKey: _removed, ...rest } = asset;
    return rest;
  });
}

export function validateVisualSubjectsDocument(
  doc: VisualSubjectsDocument,
  assets: readonly CharacterAsset[]
): { ok: true } | { ok: false; reason: string } {
  return validateVisualSubjectsDocumentCore(doc, assets);
}

function validateVisualSubjectsDocumentCore(
  doc: VisualSubjectsDocument,
  assets: readonly CharacterAsset[]
): { ok: true } | { ok: false; reason: string } {
  const keys = new Set<string>();
  for (const subject of doc.subjects) {
    if (!isVisualSubjectKey(subject.subjectKey)) {
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

export type VisualAssetOwner =
  | { kind: "main_character" }
  | { kind: "unassigned" }
  | { kind: "visual_subject"; subjectKey: string };

/** Single owner for content-kind-aware asset identity semantics. */
export function resolveAssetVisualOwner(
  contentKind: ContentKind,
  asset: Pick<CharacterAsset, "visualSubjectKey">,
  index: number
): VisualAssetOwner {
  const key = asset.visualSubjectKey?.trim();
  if (key) return { kind: "visual_subject", subjectKey: key };
  if (contentKind === "character") {
    void index;
    return { kind: "main_character" };
  }
  return { kind: "unassigned" };
}

/** Main-character selectable pool for Character content kind. */
export function assetsForMainCharacterPool(
  assets: readonly CharacterAsset[],
  contentKind: ContentKind
): CharacterAsset[] {
  if (contentKind !== "character") return [...assets];
  return assets.filter((asset) => !asset.visualSubjectKey?.trim());
}

export function countOwnedAssets(
  subjects: readonly VisualSubject[],
  assets: readonly CharacterAsset[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const subject of subjects) counts.set(subject.subjectKey, 0);
  for (const asset of assets) {
    const key = asset.visualSubjectKey?.trim();
    if (!key || !counts.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export type PublicVisualSubjectSummary = {
  name: string;
  hasSavedAppearance: boolean;
  ownedAssetCount: number;
  hasRepresentativeAsset: boolean;
};

export function buildPublicVisualSubjectSummaries(
  subjects: readonly VisualSubject[],
  assets: readonly CharacterAsset[]
): PublicVisualSubjectSummary[] {
  return subjects.map((subject) => {
    const owned = assetsForVisualSubject(assets, subject.subjectKey);
    return {
      name: subject.name,
      hasSavedAppearance: Boolean(normalizeVisualSubjectSavedAppearance(subject.savedAppearance)),
      ownedAssetCount: owned.length,
      hasRepresentativeAsset: Boolean(validateRepresentativeAsset(subject, assets)),
    };
  });
}

export function resolveSupportMemberVisualMetadata(opts: {
  memberName: string;
  castSubjectKey: string;
  visualSubjects: readonly VisualSubject[];
}): {
  savedAppearance?: string;
  appearanceMode: "image_only" | "image_plus_saved";
  trustedSavedAppearance: boolean;
  visualSubject: VisualSubject | null;
} {
  const visualSubject =
    resolveVisualSubjectByName(opts.visualSubjects, opts.memberName) ??
    opts.visualSubjects.find((row) => row.subjectKey === opts.castSubjectKey) ??
    null;
  const savedAppearance = normalizeVisualSubjectSavedAppearance(visualSubject?.savedAppearance);
  return {
    visualSubject,
    savedAppearance: savedAppearance || undefined,
    appearanceMode: savedAppearance ? "image_plus_saved" : "image_only",
    trustedSavedAppearance: Boolean(savedAppearance && visualSubject),
  };
}

export function dedupeVisualSubjectsByKey(subjects: VisualSubject[]): VisualSubject[] {
  return dedupeSubjectsByKey(subjects);
}
