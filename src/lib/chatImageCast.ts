/**
 * Client-safe cast domain types and pure intent edits.
 * Server grounding lives in chatImageCastManifest.ts.
 */

export const CHAT_IMAGE_CAST_HIGH_FIDELITY_CAP = 3;
export const CHAT_IMAGE_CAST_IDENTITY_REFERENCE_CAP = 3;
export const CHAT_IMAGE_CAST_FOUR_PLUS_WARNING =
  "다수 인물 장면은 일부 조연의 세부 정확도가 낮아질 수 있습니다. 핵심 인물 2~3명을 권장합니다.";

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
  | "duo_focus"
  | "trio_group"
  | "ensemble_scene"
  | "auto";

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
    const inScene = events.some((event) => event.text.includes(name));
    if (!inScene) continue;
    seen.add(normalized);
    results.push(name);
  }
  return results;
}

export function buildCastCandidatePool(opts: {
  personaName: string;
  mainCharacterName: string;
  configuredCharacterSetNames?: readonly string[];
  castMentions?: readonly SceneCastMention[];
  events?: readonly { text: string }[];
}): CastCandidateMeta[] {
  const persona = cleanText(opts.personaName) || "persona";
  const main = cleanText(opts.mainCharacterName) || "character";
  const reserved = new Set([normalizeCastMatchName(persona), normalizeCastMatchName(main)]);
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
  personaName: string;
  mainCharacterName: string;
  configuredCharacterSetNames?: readonly string[];
  castMentions?: readonly SceneCastMention[];
  events?: readonly { text: string }[];
  compositionGoal?: ChatImageCastCompositionGoal;
}): ChatImageCastIntentManifest {
  const pool = buildCastCandidatePool(opts);
  const supporting = pool.map((candidate) => ({
    key: `supporting:${normalizeCastMatchName(candidate.name) || candidate.name}`,
    role: "supporting_character" as const,
    name: candidate.name,
    included: candidate.sources.includes("current_scene"),
    importance: "secondary" as const,
    visibility: "preferred_visible" as const,
    candidateSources: candidate.sources,
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
  if (manifest.compositionGoal === "auto") {
    if (count <= 2) return "duo_focus";
    if (count === 3) return "trio_group";
    return "ensemble_scene";
  }
  if (manifest.compositionGoal === "trio_group") {
    if (count <= 2) return "duo_focus";
    if (count >= 4) return "ensemble_scene";
    return "trio_group";
  }
  return manifest.compositionGoal;
}

export function normalizeCastCompositionGoalIntent(
  manifest: ChatImageCastIntentManifest
): ChatImageCastIntentManifest {
  if (manifest.compositionGoal !== "trio_group") return manifest;
  const count = selectedCastIntentSubjects(manifest).length;
  if (count === 3) return manifest;
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

export function normalizeCastPrimaryCap(
  manifest: ChatImageCastIntentManifest
): ChatImageCastIntentManifest {
  const withCore = {
    ...manifest,
    subjects: manifest.subjects.map((subject) => {
      if (subject.role === "persona") {
        return {
          ...subject,
          key: "persona",
          included: true,
          importance: "primary" as const,
          visibility: "required_visible" as const,
        };
      }
      if (subject.role === "main_character") {
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
  >
): ChatImageCastIntentManifest {
  const next = {
    ...manifest,
    subjects: manifest.subjects.map((subject) => {
      if (subject.key !== key) return subject;
      if (subject.role === "persona" || subject.role === "main_character") {
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
  return normalizeCastCompositionGoalIntent(normalizeCastPrimaryCap(next));
}

export function mergeCastIntentDraft(
  current: ChatImageCastIntentManifest | null,
  next: ChatImageCastIntentManifest
): ChatImageCastIntentManifest {
  if (!current) return normalizeCastPrimaryCap(next);
  const byKey = new Map(current.subjects.map((subject) => [subject.key, subject]));
  return normalizeCastPrimaryCap({
    compositionGoal: current.compositionGoal,
    subjects: next.subjects.map((subject) => {
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
    }),
  });
}

export function suggestAssetForSupportingName(
  name: string,
  assets: readonly SelectableCastAsset[]
): string | undefined {
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

export function parseCastIntentManifest(raw: unknown): ChatImageCastIntentManifest | null {
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
  return normalizeCastPrimaryCap({
    compositionGoal,
    subjects,
  });
}
