/**
 * Client-safe cast domain types and pure intent edits.
 * Server grounding lives in chatImageCastManifest.ts.
 */

import type { ContentKind } from "@/lib/simulationMode";
import { resolveVisualSubjectByName, type VisualSubject } from "@/lib/visualSubjects";

export const CHAT_IMAGE_CAST_HIGH_FIDELITY_CAP = 3;
export const CHAT_IMAGE_CAST_IDENTITY_REFERENCE_CAP = 3;
export const CHAT_IMAGE_CAST_MAX_SELECTED = 4;
export const CHAT_IMAGE_CAST_FOUR_PLUS_WARNING =
  "4인 장면은 일부 인물의 외형 정확도가 낮아질 수 있습니다.";
export const CHAT_IMAGE_CAST_MIN_SELECTED_ERROR =
  "이미지에는 최소 1명을 선택해 주세요.";
export const CHAT_IMAGE_CAST_MAX_SELECTED_ERROR =
  "이미지에는 최대 4명까지 선택할 수 있습니다.";

export type ChatImageCastRole =
  | "persona"
  | "main_character"
  | "supporting_character";

export type ChatImageCastImportance = "primary" | "secondary" | "background";
export type ChatImageCastVisibility =
  | "required_visible"
  | "preferred_visible"
  | "background_ok";
export type ChatImageCastCompositionGoal =
  | "solo"
  | "duo_focus"
  | "trio_group"
  | "ensemble_scene"
  | "auto";

export type ChatImageCastPolicy = {
  contentKind: ContentKind;
  allowMainCharacter: boolean;
  requireMainCharacter: boolean;
  personaOptional: boolean;
  minSelected: number;
  maxSelected: number;
};

export function resolveChatImageCastPolicy(contentKind: ContentKind): ChatImageCastPolicy {
  if (contentKind === "simulation") {
    return {
      contentKind: "simulation",
      allowMainCharacter: false,
      requireMainCharacter: false,
      personaOptional: true,
      minSelected: 1,
      maxSelected: CHAT_IMAGE_CAST_MAX_SELECTED,
    };
  }
  return {
    contentKind: "character",
    allowMainCharacter: true,
    requireMainCharacter: true,
    personaOptional: false,
    minSelected: 2,
    maxSelected: CHAT_IMAGE_CAST_MAX_SELECTED,
  };
}

/** User-editable cast intent — no trusted refs, appearance, or gender. */
export type ChatImageCastIntentSubject = {
  key: string;
  role: ChatImageCastRole;
  name: string;
  included: boolean;
  importance: ChatImageCastImportance;
  visibility: ChatImageCastVisibility;
  requestedReferenceAssetUrl?: string;
  /** UI-only marker for candidate pool provenance. Never sent to server. */
  candidateSources?: CastCandidateSourceMarker[];
};

export type ChatImageCastIntentManifest = {
  compositionGoal: ChatImageCastCompositionGoal;
  subjects: ChatImageCastIntentSubject[];
};

export type SceneEventSubjectBinding = {
  eventId: string;
  subjectKey: string;
};

export type SceneCastMention = {
  name: string;
  /** Canonical events where the supporting character is present, named, or scene-relevant. */
  sourceEventIds: string[];
  /** Events where the supporting character is the actual acting or speaking subject only. */
  actorEventIds?: string[];
};

export type SelectableCastAsset = {
  url: string;
  tag: string;
  visualSubjectKey?: string;
};

export type CastCandidateSourceMarker =
  | "current_scene"
  | "character_set"
  | "ai_suggestion";

export type CastCandidateMeta = {
  name: string;
  sources: CastCandidateSourceMarker[];
};

export function normalizeCastMatchName(name: string): string {
  return cleanText(name).toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KOREAN_CAST_NAME_PARTICLE =
  /^(?:이|가|은|는|을|를|과|와|의|도|에게|한테|께|아|야|이야|랑|하고|에서|부터|까지|만|이며|이면|이라|입니다|이에요|예요|죠|요|님)(?=[\s.,!?;:'"”’」】)\]*<>]|$)/;

/** Boundary-aware mention check for already-known cast names only. */
export function containsKnownCastMention(text: string, knownName: string): boolean {
  const name = cleanText(knownName);
  if (!name) return false;
  const haystack = String(text ?? "");
  if (!haystack.includes(name)) return false;

  if (/^[A-Za-z][A-Za-z0-9'-]*$/.test(name)) {
    const pattern = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(name)}(?![A-Za-z0-9_])`, "i");
    return pattern.test(haystack);
  }

  let searchFrom = 0;
  while (searchFrom < haystack.length) {
    const idx = haystack.indexOf(name, searchFrom);
    if (idx === -1) break;

    const before = idx > 0 ? haystack[idx - 1]! : "";
    if (before && /[가-힣A-Za-z0-9_]/.test(before)) {
      searchFrom = idx + 1;
      continue;
    }

    const after = haystack.slice(idx + name.length);
    if (!after) return true;
    if (/^[\s.,!?;:'"”’」】)\]*<>]/.test(after)) return true;
    if (KOREAN_CAST_NAME_PARTICLE.test(after)) return true;
    if (/^[가-힣]/.test(after)) {
      searchFrom = idx + 1;
      continue;
    }
    return true;
  }
  return false;
}

export function filterConfiguredCastNamesForViewer(opts: {
  configuredNames: readonly string[];
  sourceTexts: readonly string[];
  isCreator: boolean;
}): string[] {
  const names = opts.configuredNames.map((name) => cleanText(name)).filter(Boolean);
  if (opts.isCreator) return names;
  return names.filter((name) =>
    opts.sourceTexts.some((text) => containsKnownCastMention(text, name))
  );
}

export function detectCurrentSceneCastNames(
  knownNames: readonly string[],
  events: readonly { text: string }[]
): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const rawName of knownNames) {
    const name = cleanText(rawName);
    if (!name) continue;
    const normalized = normalizeCastMatchName(name);
    if (seen.has(normalized)) continue;
    const inScene = events.some((event) => containsKnownCastMention(event.text, name));
    if (!inScene) continue;
    seen.add(normalized);
    results.push(name);
  }
  return results;
}

export function buildCastCandidatePool(opts: {
  contentKind?: ContentKind;
  personaName: string;
  mainCharacterName: string;
  configuredCharacterSetNames?: readonly string[];
  castMentions?: readonly SceneCastMention[];
  events?: readonly { text: string }[];
}): CastCandidateMeta[] {
  const contentKind = opts.contentKind ?? "character";
  const persona = cleanText(opts.personaName) || "persona";
  const reserved = new Set([normalizeCastMatchName(persona)]);
  if (contentKind === "character") {
    const main = cleanText(opts.mainCharacterName) || "character";
    reserved.add(normalizeCastMatchName(main));
  } else {
    const title = cleanText(opts.mainCharacterName);
    if (title) reserved.add(normalizeCastMatchName(title));
  }
  const events = opts.events ?? [];
  const configured = (opts.configuredCharacterSetNames ?? [])
    .map((name) => cleanText(name))
    .filter((name) => Boolean(name));
  const currentScene = detectCurrentSceneCastNames(configured, events);
  const currentSet = new Set(currentScene.map(normalizeCastMatchName));
  const byName = new Map<string, CastCandidateMeta>();

  const add = (rawName: string, source: CastCandidateSourceMarker) => {
    const name = cleanText(rawName);
    if (!name) return;
    const normalized = normalizeCastMatchName(name);
    if (reserved.has(normalized)) return;
    const existing = byName.get(normalized);
    if (existing) {
      if (!existing.sources.includes(source)) {
        existing.sources.push(source);
      }
      return;
    }
    byName.set(normalized, { name, sources: [source] });
  };

  for (const name of configured) {
    add(name, currentSet.has(normalizeCastMatchName(name)) ? "current_scene" : "character_set");
  }
  for (const mention of opts.castMentions ?? []) {
    add(mention.name, "ai_suggestion");
  }

  return [...byName.values()].slice(0, 12);
}

export function draftCastIntentFromCandidatePool(opts: {
  contentKind?: ContentKind;
  personaName: string;
  mainCharacterName: string;
  configuredCharacterSetNames?: readonly string[];
  castMentions?: readonly SceneCastMention[];
  events?: readonly { text: string; sourceRole?: string }[];
  compositionGoal?: ChatImageCastCompositionGoal;
}): ChatImageCastIntentManifest {
  const contentKind = opts.contentKind ?? "character";
  const pool = buildCastCandidatePool(opts);
  const userInSource = (opts.events ?? []).some((event) => event.sourceRole === "user");
  const supporting = pool.map((candidate) => ({
    key: `supporting:${normalizeCastMatchName(candidate.name) || candidate.name}`,
    role: "supporting_character" as const,
    name: candidate.name,
    included: candidate.sources.includes("current_scene"),
    importance: "secondary" as const,
    visibility: "preferred_visible" as const,
    candidateSources: candidate.sources,
  }));

  if (contentKind === "simulation") {
    return {
      compositionGoal: "auto",
      subjects: [
        {
          key: "persona",
          role: "persona",
          name: cleanText(opts.personaName) || "persona",
          included: userInSource,
          importance: "primary",
          visibility: "required_visible",
        },
        ...supporting,
      ],
    };
  }

  return {
    compositionGoal: opts.compositionGoal ?? "auto",
    subjects: [
      {
        key: "persona",
        role: "persona",
        name: cleanText(opts.personaName) || "persona",
        included: true,
        importance: "primary",
        visibility: "required_visible",
      },
      {
        key: "main_character",
        role: "main_character",
        name: cleanText(opts.mainCharacterName) || "character",
        included: true,
        importance: "primary",
        visibility: "required_visible",
      },
      ...supporting,
    ],
  };
}

export function castCandidateSourceLabel(
  sources: readonly CastCandidateSourceMarker[] | undefined
): string {
  if (!sources?.length) return "";
  const labels: string[] = [];
  if (sources.includes("current_scene")) labels.push("현재 장면");
  if (sources.includes("character_set")) labels.push("캐릭터셋");
  if (sources.includes("ai_suggestion")) labels.push("AI 제안");
  return labels.join(" · ");
}

function cleanText(raw: unknown, max = 48): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanUrl(raw: unknown): string {
  return String(raw ?? "").trim();
}

export function isChatImageCastCompositionGoal(
  value: unknown
): value is ChatImageCastCompositionGoal {
  return (
    value === "solo" ||
    value === "duo_focus" ||
    value === "trio_group" ||
    value === "ensemble_scene" ||
    value === "auto"
  );
}

export function isChatImageCastImportance(
  value: unknown
): value is ChatImageCastImportance {
  return value === "primary" || value === "secondary" || value === "background";
}

export function isChatImageCastVisibility(
  value: unknown
): value is ChatImageCastVisibility {
  return (
    value === "required_visible" ||
    value === "preferred_visible" ||
    value === "background_ok"
  );
}

export function selectedCastIntentSubjects(
  manifest: ChatImageCastIntentManifest
): ChatImageCastIntentSubject[] {
  return manifest.subjects.filter((subject) => subject.included && cleanText(subject.name));
}

export function resolveCastCompositionGoal(
  manifest: ChatImageCastIntentManifest
): Exclude<ChatImageCastCompositionGoal, "auto"> {
  const count = selectedCastIntentSubjects(manifest).length;
  if (count <= 1) return "solo";
  if (count === 2) return "duo_focus";
  if (count === 3) return "trio_group";
  return "ensemble_scene";
}

export function normalizeCastCompositionGoalIntent(
  manifest: ChatImageCastIntentManifest
): ChatImageCastIntentManifest {
  return {
    ...manifest,
    compositionGoal: resolveCastCompositionGoal(manifest),
  };
}

export function isCastReferenceUrlTaken(
  manifest: ChatImageCastIntentManifest,
  subjectKey: string,
  url: string,
  reservedUrls: readonly string[] = []
): boolean {
  const needle = cleanUrl(url);
  if (!needle) return false;
  if (reservedUrls.some((reserved) => cleanUrl(reserved) === needle)) return true;
  for (const subject of manifest.subjects) {
    if (!subject.included) continue;
    if (subject.key === subjectKey) continue;
    if (cleanUrl(subject.requestedReferenceAssetUrl) === needle) return true;
  }
  return false;
}

export function castNeedsFourPlusWarning(manifest: ChatImageCastIntentManifest): boolean {
  return selectedCastIntentSubjects(manifest).length >= 4;
}

export function isCastSelectionAtMax(manifest: ChatImageCastIntentManifest): boolean {
  return selectedCastIntentSubjects(manifest).length >= CHAT_IMAGE_CAST_MAX_SELECTED;
}

export function normalizeCastPrimaryCap(
  manifest: ChatImageCastIntentManifest,
  contentKind: ContentKind = "character"
): ChatImageCastIntentManifest {
  const policy = resolveChatImageCastPolicy(contentKind);
  const withCore = {
    ...manifest,
    subjects: manifest.subjects.map((subject) => {
      if (subject.role === "persona" && !policy.personaOptional) {
        return {
          ...subject,
          key: "persona",
          included: true,
          importance: "primary" as const,
          visibility: "required_visible" as const,
        };
      }
      if (subject.role === "main_character" && policy.requireMainCharacter) {
        return {
          ...subject,
          key: "main_character",
          included: true,
          importance: "primary" as const,
          visibility: "required_visible" as const,
        };
      }
      return subject;
    }),
  };
  const selectedCount = selectedCastIntentSubjects(withCore).length;
  if (selectedCount < 4) return withCore;
  let supportingPrimaryCount = 0;
  return {
    ...withCore,
    subjects: withCore.subjects.map((subject) => {
      if (subject.role !== "supporting_character" || !subject.included) return subject;
      if (subject.importance !== "primary") return subject;
      supportingPrimaryCount += 1;
      if (supportingPrimaryCount <= 1) return subject;
      return { ...subject, importance: "secondary" as const };
    }),
  };
}

export function draftCastIntentFromMentions(opts: {
  personaName: string;
  mainCharacterName: string;
  castMentions?: readonly SceneCastMention[];
  compositionGoal?: ChatImageCastCompositionGoal;
}): ChatImageCastIntentManifest {
  const supporting = (opts.castMentions ?? []).map((mention, index) => ({
    key: `supporting:${cleanText(mention.name) || index + 1}`,
    role: "supporting_character" as const,
    name: cleanText(mention.name),
    included: false,
    importance: "secondary" as const,
    visibility: "preferred_visible" as const,
  }));
  return {
    compositionGoal: opts.compositionGoal ?? "auto",
    subjects: [
      {
        key: "persona",
        role: "persona",
        name: cleanText(opts.personaName) || "persona",
        included: true,
        importance: "primary",
        visibility: "required_visible",
      },
      {
        key: "main_character",
        role: "main_character",
        name: cleanText(opts.mainCharacterName) || "character",
        included: true,
        importance: "primary",
        visibility: "required_visible",
      },
      ...supporting.filter((subject) => subject.name),
    ],
  };
}

export function applyUserCastEdits(
  manifest: ChatImageCastIntentManifest,
  key: string,
  patch: Partial<
    Pick<
      ChatImageCastIntentSubject,
      "included" | "importance" | "visibility" | "requestedReferenceAssetUrl"
    >
  >,
  contentKind: ContentKind = "character"
): ChatImageCastIntentManifest {
  const policy = resolveChatImageCastPolicy(contentKind);
  const next = {
    ...manifest,
    subjects: manifest.subjects.map((subject) => {
      if (subject.key !== key) return subject;
      if (subject.role === "main_character") return subject;
      if (subject.role === "persona" && !policy.personaOptional) return subject;
      if (
        patch.included === true &&
        !subject.included &&
        isCastSelectionAtMax(manifest)
      ) {
        return subject;
      }
      const importance = patch.importance ?? subject.importance;
      return {
        ...subject,
        included: patch.included ?? subject.included,
        importance,
        visibility:
          patch.visibility ??
          (importance === "primary"
            ? "required_visible"
            : importance === "secondary"
              ? "preferred_visible"
              : "background_ok"),
        requestedReferenceAssetUrl:
          patch.requestedReferenceAssetUrl !== undefined
            ? cleanUrl(patch.requestedReferenceAssetUrl) || undefined
            : subject.requestedReferenceAssetUrl,
      };
    }),
  };
  return normalizeCastCompositionGoalIntent(normalizeCastPrimaryCap(next, contentKind));
}

export function isManuallyPinnedCastSubject(subject: ChatImageCastIntentSubject): boolean {
  if (subject.role !== "supporting_character") return false;
  return subject.included || Boolean(cleanUrl(subject.requestedReferenceAssetUrl));
}

export function mergeCastIntentDraft(
  current: ChatImageCastIntentManifest | null,
  next: ChatImageCastIntentManifest,
  contentKind: ContentKind = "character"
): ChatImageCastIntentManifest {
  if (!current) return normalizeCastPrimaryCap(next, contentKind);
  const byKey = new Map(current.subjects.map((subject) => [subject.key, subject]));
  const nextKeys = new Set(next.subjects.map((subject) => subject.key));
  const mergedSubjects = next.subjects.map((subject) => {
    const previous = byKey.get(subject.key);
    if (!previous) return subject;
    return {
      ...subject,
      included: previous.included,
      importance: previous.importance,
      visibility: previous.visibility,
      requestedReferenceAssetUrl: previous.requestedReferenceAssetUrl,
      candidateSources: subject.candidateSources ?? previous.candidateSources,
    };
  });
  for (const previous of current.subjects) {
    if (nextKeys.has(previous.key)) continue;
    if (!isManuallyPinnedCastSubject(previous)) continue;
    mergedSubjects.push(previous);
  }
  return normalizeCastPrimaryCap(
    {
      compositionGoal: "auto",
      subjects: mergedSubjects,
    },
    contentKind
  );
}

export function suggestAssetForSupportingName(
  name: string,
  assets: readonly SelectableCastAsset[],
  visualSubjects?: readonly Pick<
    VisualSubject,
    "subjectKey" | "name" | "representativeAssetUrl" | "savedAppearance"
  >[]
): string | undefined {
  const subject = visualSubjects?.length
    ? resolveVisualSubjectByName(visualSubjects as readonly VisualSubject[], name)
    : null;
  if (subject?.representativeAssetUrl) {
    const representative = assets.find((asset) => asset.url === subject.representativeAssetUrl);
    if (representative) return representative.url;
  }
  if (subject) {
    const owned = assets.find((asset) => asset.visualSubjectKey === subject.subjectKey);
    if (owned) return owned.url;
  }
  const needle = cleanText(name);
  if (!needle) return undefined;
  const exact = assets.find((asset) => cleanText(asset.tag) === needle);
  return exact?.url;
}

export function validateCastMentions(
  mentions: readonly SceneCastMention[],
  events: readonly { id: string; text: string }[],
  reservedNames: readonly string[]
): SceneCastMention[] {
  const reserved = new Set(reservedNames.map((name) => cleanText(name)).filter(Boolean));
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const seen = new Set<string>();
  const valid: SceneCastMention[] = [];
  for (const mention of mentions) {
    const name = cleanText(mention.name);
    if (!name || name.length < 2 || name.length > 16) continue;
    if (reserved.has(name)) continue;
    const normalized = name.toLowerCase();
    if (seen.has(normalized)) continue;
    const sourceEventIds = mention.sourceEventIds
      .map((id) => cleanText(id, 24))
      .filter((id) => eventsById.has(id));
    if (!sourceEventIds.length) continue;
    const sourceSet = new Set(sourceEventIds);
    const actorRaw = (mention.actorEventIds ?? []).map((id) => cleanText(id, 24)).filter(Boolean);
    const actorEventIds = actorRaw.filter((id) => eventsById.has(id));
    if (actorRaw.length > 0) {
      if (actorEventIds.length !== actorRaw.length) continue;
      if (!actorEventIds.every((id) => sourceSet.has(id))) continue;
    }
    const appearsInSource = sourceEventIds.some((id) => {
      const event = eventsById.get(id);
      return event?.text.includes(name) ?? false;
    });
    if (!appearsInSource) continue;
    seen.add(normalized);
    valid.push({
      name,
      sourceEventIds,
      ...(actorEventIds.length ? { actorEventIds } : {}),
    });
  }
  return valid.slice(0, 4);
}

export function parseCastIntentManifest(
  raw: unknown,
  contentKind: ContentKind = "character"
): ChatImageCastIntentManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const compositionGoal = isChatImageCastCompositionGoal(record.compositionGoal)
    ? record.compositionGoal
    : "auto";
  if (!Array.isArray(record.subjects)) return null;
  const subjects = record.subjects
    .map((item, index): ChatImageCastIntentSubject | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const role = row.role;
      if (
        role !== "persona" &&
        role !== "main_character" &&
        role !== "supporting_character"
      ) {
        return null;
      }
      const name = cleanText(row.name);
      if (!name) return null;
      const importance = isChatImageCastImportance(row.importance)
        ? row.importance
        : role === "supporting_character"
          ? "secondary"
          : "primary";
      const visibility = isChatImageCastVisibility(row.visibility)
        ? row.visibility
        : importance === "primary"
          ? "required_visible"
          : "preferred_visible";
      return {
        key: cleanText(row.key) || `${role}:${name}:${index}`,
        role,
        name,
        included: row.included !== false,
        importance,
        visibility,
        requestedReferenceAssetUrl:
          cleanUrl(row.requestedReferenceAssetUrl) || undefined,
      };
    })
    .filter((subject): subject is ChatImageCastIntentSubject => Boolean(subject));
  if (!subjects.length) return null;
  return normalizeCastPrimaryCap(
    {
      compositionGoal: "auto",
      subjects,
    },
    contentKind
  );
}

export function resolveChatImageSceneBuilderReadiness(opts: {
  contentKind: ContentKind;
  characterImageUrl: string;
  hasPersona: boolean;
  personaImageUrl: string;
}): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (opts.contentKind === "character") {
    if (!opts.characterImageUrl) missing.push("캐릭터 대표 이미지");
    if (!opts.hasPersona) missing.push("유저 페르소나");
    else if (!opts.personaImageUrl) missing.push("페르소나 대표 이미지");
  } else if (!opts.hasPersona) {
    missing.push("유저 페르소나");
  }
  return { ready: missing.length === 0, missing };
}
