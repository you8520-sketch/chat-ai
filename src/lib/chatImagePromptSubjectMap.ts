import type { SceneDialogue, SceneDialogueSpeaker } from "@/lib/chatImageScenePlan";
import {
  describeReferenceOrder,
  subjectLetter,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";

export type PromptSubjectLabel = "A" | "B" | "C" | "D";

export type PromptSubjectIdentity = {
  label: PromptSubjectLabel;
  key: string;
  role: string;
  name: string;
  referenceIndex: number | null;
};

export type PromptSubjectMap = {
  subjects: readonly PromptSubjectIdentity[];
  byKey: ReadonlyMap<string, PromptSubjectIdentity>;
};

export type PromptIdentityBindingAudit = {
  subjectLabelConflictCount: number;
  referenceOwnerConflictCount: number;
  templateReferenceOwnerConflictCount: number;
  referenceSlotConflictCount: number;
  actionOwnerConflictCount: number;
  speechOwnerConflictCount: number;
};

export type ProductionReferenceOwner = {
  image: number;
  owner: string;
};

const PROMPT_SUBJECT_LABELS = new Set<PromptSubjectLabel>(["A", "B", "C", "D"]);

function isPromptSubjectLabel(value: string): value is PromptSubjectLabel {
  return PROMPT_SUBJECT_LABELS.has(value as PromptSubjectLabel);
}

function speakerKeys(speaker: SceneDialogueSpeaker): string[] {
  if (speaker === "persona") return ["persona"];
  if (speaker === "character") return ["character", "main_character"];
  return [];
}

/** Canonical prompt subject labels derived from visual/reference subject order. */
export function buildPromptSubjectMap(
  visualSubjects: readonly ChatImageVisualSubject[]
): PromptSubjectMap {
  const subjects: PromptSubjectIdentity[] = visualSubjects.map((subject, index) => {
    const label = subjectLetter(index);
    if (!isPromptSubjectLabel(label)) {
      throw new Error(`unsupported prompt subject index ${index}`);
    }
    return {
      label,
      key: subject.key,
      role: subject.role,
      name: subject.name.trim() || subject.role,
      referenceIndex: subject.referenceIndex,
    };
  });
  return {
    subjects,
    byKey: new Map(subjects.map((subject) => [subject.key, subject])),
  };
}

export function resolveSpeakerSubject(
  map: PromptSubjectMap,
  speaker: SceneDialogueSpeaker
): PromptSubjectIdentity | undefined {
  for (const key of speakerKeys(speaker)) {
    const subject = map.byKey.get(key);
    if (subject) return subject;
  }
  return undefined;
}

export type ComicSubjectSide = "left" | "center" | "right" | "neutral";

export type ComicSubjectStaging = {
  byLabel: ReadonlyMap<PromptSubjectLabel, ComicSubjectSide>;
  byKey: ReadonlyMap<string, ComicSubjectSide>;
};

function isMainCharacterSubject(subject: PromptSubjectIdentity): boolean {
  if (subject.key === "main_character" || subject.key === "character") return true;
  return /main_character|chat character/i.test(subject.role);
}

function isPersonaSubject(subject: PromptSubjectIdentity): boolean {
  if (subject.key === "persona") return true;
  return /persona|user persona/i.test(subject.role);
}

/** Canonical visual + overlay staging — role-based, not reference/bind order. */
export function resolveComicSubjectStaging(
  map: PromptSubjectMap,
  personaVisible: boolean
): ComicSubjectStaging {
  const visible = visiblePromptSubjects(map, personaVisible);
  const byLabel = new Map<PromptSubjectLabel, ComicSubjectSide>();
  const byKey = new Map<string, ComicSubjectSide>();

  const main = visible.find((subject) => isMainCharacterSubject(subject));
  const persona = visible.find((subject) => isPersonaSubject(subject));
  const supporting = visible.filter((subject) => subject !== main && subject !== persona);

  if (visible.length === 1) {
    const only = visible[0]!;
    byLabel.set(only.label, "center");
    byKey.set(only.key, "center");
    return { byLabel, byKey };
  }

  if (visible.length === 2 && main && persona) {
    byLabel.set(main.label, "left");
    byKey.set(main.key, "left");
    byLabel.set(persona.label, "right");
    byKey.set(persona.key, "right");
    return { byLabel, byKey };
  }

  if (visible.length === 3) {
    if (main) {
      byLabel.set(main.label, "left");
      byKey.set(main.key, "left");
    }
    if (persona) {
      byLabel.set(persona.label, "right");
      byKey.set(persona.key, "right");
    }
    for (const subject of supporting) {
      byLabel.set(subject.label, "center");
      byKey.set(subject.key, "center");
    }
    return { byLabel, byKey };
  }

  const slotSides: ComicSubjectSide[] = ["left", "center", "center", "right"];
  visible.forEach((subject, index) => {
    const side = slotSides[Math.min(index, slotSides.length - 1)] ?? "center";
    byLabel.set(subject.label, side);
    byKey.set(subject.key, side);
  });
  return { byLabel, byKey };
}

export function formatComicStagingLayout(
  map: PromptSubjectMap,
  personaVisible: boolean
): string {
  const staging = resolveComicSubjectStaging(map, personaVisible);
  const visible = visiblePromptSubjects(map, personaVisible);
  if (visible.length >= 4) {
    return "ensemble group layout — distribute subjects across readable slots; follow cast manifest composition goal";
  }
  if (visible.length >= 3) {
    const parts = visible.map(
      (subject) => `${subject.label} ${staging.byLabel.get(subject.label) ?? "center"}`
    );
    return `${parts.join(", ")} — maintain stable orientation across panels`;
  }
  const main = visible.find((subject) => isMainCharacterSubject(subject));
  const persona = visible.find((subject) => isPersonaSubject(subject));
  if (!personaVisible && main) {
    return `SUBJECT ${main.label} (${main.name}) centered; persona off-camera only`;
  }
  if (main && persona) {
    return `${main.label} left, ${persona.label} right — maintain stable orientation across panels`;
  }
  if (main) {
    return `SUBJECT ${main.label} (${main.name}) centered`;
  }
  return "recurring characters readable in frame";
}

/** Resolve dialogue speaker to a prompt subject — exact speakerName match first. */
export function resolveDialogueSpeakerSubject(
  map: PromptSubjectMap,
  line: Pick<SceneDialogue, "speaker" | "speakerName">
): PromptSubjectIdentity | undefined {
  const speakerName = line.speakerName?.trim();
  if (speakerName) {
    return map.subjects.find((subject) => subject.name.trim() === speakerName);
  }
  return resolveSpeakerSubject(map, line.speaker);
}

export function resolveDialogueSpeakerSide(
  map: PromptSubjectMap,
  line: Pick<SceneDialogue, "speaker" | "speakerName">,
  personaVisible: boolean
): ComicSubjectSide {
  const subject = resolveDialogueSpeakerSubject(map, line);
  if (!subject) return "neutral";
  return resolveComicSubjectStaging(map, personaVisible).byLabel.get(subject.label) ?? "neutral";
}

export function visiblePromptSubjects(
  map: PromptSubjectMap,
  personaVisible: boolean
): readonly PromptSubjectIdentity[] {
  if (personaVisible) return map.subjects;
  return map.subjects.filter((subject) => subject.key !== "persona");
}

export function buildCastFromPromptSubjects(
  map: PromptSubjectMap,
  personaVisible: boolean
): Array<{ label: PromptSubjectLabel; role: string; name: string }> {
  return visiblePromptSubjects(map, personaVisible).map((subject) => ({
    label: subject.label,
    role: subject.role,
    name: subject.name,
  }));
}

export function resolveLayoutFromSubjectMap(
  map: PromptSubjectMap,
  personaVisible: boolean,
  castCount: number
): string {
  if (castCount >= 3) {
    return formatComicStagingLayout(map, personaVisible);
  }
  return formatComicStagingLayout(map, personaVisible);
}

type ParsedIdentityManifest = {
  label: PromptSubjectLabel;
  name: string;
  referenceIndex: number | null;
};

type ParsedComicCast = {
  label: PromptSubjectLabel;
  role: string;
  name: string;
};

type ParsedComicAction = {
  label: PromptSubjectLabel;
  text: string;
};

type ParsedComicBubble = {
  label: PromptSubjectLabel;
  speaker: string;
  text: string;
};

function parseIdentityManifest(prompt: string): ParsedIdentityManifest[] {
  const entries: ParsedIdentityManifest[] = [];
  const blockPattern =
    /\[SUBJECT ([A-D]) — ([^\]:]+): ([^\]]+)\][\s\S]*?Reference: Image (\d+) belongs ONLY to ([^.]+)\./g;
  for (const match of prompt.matchAll(blockPattern)) {
    entries.push({
      label: match[1] as PromptSubjectLabel,
      name: match[3]!.trim(),
      referenceIndex: Number(match[4]),
    });
  }
  return entries;
}

function parseComicCast(prompt: string): ParsedComicCast[] {
  const region = prompt.split("COMIC PANEL SPEC")[1] ?? "";
  const castSection = region.split(/\n\n\[Panel /)[0] ?? region;
  const entries: ParsedComicCast[] = [];
  for (const line of castSection.split("\n")) {
    const match = line.match(/^([A-D]) = ([^(]+) \(([^)]+)\)$/);
    if (!match) continue;
    entries.push({
      label: match[1] as PromptSubjectLabel,
      role: match[2]!.trim(),
      name: match[3]!.trim(),
    });
  }
  return entries;
}

function parseComicActions(prompt: string): ParsedComicAction[] {
  const region = prompt.split("COMIC PANEL SPEC")[1] ?? "";
  const entries: ParsedComicAction[] = [];
  for (const line of region.split("\n")) {
    const match = line.match(/^([A-D]) action(?: \([^)]+\))?: (.+)$/);
    if (!match) continue;
    entries.push({
      label: match[1] as PromptSubjectLabel,
      text: match[2]!.trim(),
    });
  }
  return entries;
}

function parseComicBubbles(prompt: string): ParsedComicBubble[] {
  const region = prompt.split("COMIC PANEL SPEC")[1] ?? "";
  const entries: ParsedComicBubble[] = [];
  for (const line of region.split("\n")) {
    const match = line.match(/^Speech bubble \(([A-D]) \/ ([^)]+)\): “([^”]+)”$/);
    if (!match) continue;
    entries.push({
      label: match[1] as PromptSubjectLabel,
      speaker: match[2]!.trim(),
      text: match[3]!.trim(),
    });
  }
  return entries;
}

function castNameForLabel(cast: ParsedComicCast[], label: PromptSubjectLabel): string | undefined {
  return cast.find((entry) => entry.label === label)?.name;
}

function manifestNameForLabel(
  manifest: ParsedIdentityManifest[],
  label: PromptSubjectLabel
): string | undefined {
  return manifest.find((entry) => entry.label === label)?.name;
}

function parseTemplateOnlyImageIndices(prompt: string): Set<number> {
  const indices = new Set<number>();
  for (const match of prompt.matchAll(/Reference image (\d+) is LAYOUT/gi)) {
    indices.add(Number(match[1]));
  }
  for (const match of prompt.matchAll(/REFERENCE (\d+) is the layout/gi)) {
    indices.add(Number(match[1]));
  }
  return indices;
}

function countReferenceSlotConflicts(manifest: readonly ParsedIdentityManifest[]): number {
  const ownerByImage = new Map<number, string>();
  let conflicts = 0;
  for (const entry of manifest) {
    if (entry.referenceIndex == null) continue;
    const existing = ownerByImage.get(entry.referenceIndex);
    if (existing && existing !== entry.name) conflicts += 1;
    else ownerByImage.set(entry.referenceIndex, entry.name);
  }
  return conflicts;
}

function countTemplateReferenceOwnerConflicts(
  prompt: string,
  manifest: readonly ParsedIdentityManifest[]
): number {
  const templateImages = parseTemplateOnlyImageIndices(prompt);
  if (!templateImages.size) return 0;
  let conflicts = 0;
  for (const entry of manifest) {
    if (entry.referenceIndex != null && templateImages.has(entry.referenceIndex)) {
      conflicts += 1;
    }
  }
  return conflicts;
}

/** Compare identity manifest vs comic panel spec subject labels using structured parsing. */
export function auditPromptIdentityBinding(prompt: string): PromptIdentityBindingAudit {
  const manifest = parseIdentityManifest(prompt);
  const cast = parseComicCast(prompt);
  const actions = parseComicActions(prompt);
  const bubbles = parseComicBubbles(prompt);

  let subjectLabelConflictCount = 0;
  for (const castEntry of cast) {
    const manifestName = manifestNameForLabel(manifest, castEntry.label);
    if (manifestName && manifestName !== castEntry.name) {
      subjectLabelConflictCount += 1;
    }
  }

  let referenceOwnerConflictCount = 0;
  for (const manifestEntry of manifest) {
    const castName = castNameForLabel(cast, manifestEntry.label);
    if (castName && castName !== manifestEntry.name) {
      referenceOwnerConflictCount += 1;
    }
  }

  let actionOwnerConflictCount = 0;
  for (const action of actions) {
    const ownerName = castNameForLabel(cast, action.label);
    if (!ownerName) continue;
    for (const castEntry of cast) {
      if (castEntry.name === ownerName) continue;
      if (action.text.startsWith(castEntry.name)) {
        actionOwnerConflictCount += 1;
        break;
      }
    }
  }

  let speechOwnerConflictCount = 0;
  for (const bubble of bubbles) {
    const expected = resolveExpectedBubbleOwner(bubble.speaker, manifest, cast);
    if (!expected) continue;
    if (expected.label !== bubble.label || expected.name !== castNameForLabel(cast, bubble.label)) {
      speechOwnerConflictCount += 1;
    }
  }

  const templateReferenceOwnerConflictCount = countTemplateReferenceOwnerConflicts(prompt, manifest);
  const referenceSlotConflictCount = countReferenceSlotConflicts(manifest);

  return {
    subjectLabelConflictCount,
    referenceOwnerConflictCount,
    templateReferenceOwnerConflictCount,
    referenceSlotConflictCount,
    actionOwnerConflictCount,
    speechOwnerConflictCount,
  };
}

function resolveExpectedBubbleOwner(
  speaker: string,
  manifest: ParsedIdentityManifest[],
  cast: ParsedComicCast[]
): { label: PromptSubjectLabel; name: string } | undefined {
  if (speaker === "persona") {
    const castEntry = cast.find((entry) => /persona|user persona/i.test(entry.role));
    if (castEntry) return { label: castEntry.label, name: castEntry.name };
    const manifestEntry = manifest.find((entry) =>
      cast.some((castRow) => castRow.label === entry.label && /persona|user persona/i.test(castRow.role))
    );
    if (manifestEntry) return { label: manifestEntry.label, name: manifestEntry.name };
  }
  if (speaker === "character") {
    const castEntry = cast.find((entry) =>
      /character|chat character|main_character/i.test(entry.role)
    );
    if (castEntry) return { label: castEntry.label, name: castEntry.name };
  }
  return undefined;
}

/** Production reference order from bound generation plan (includes template slot when present). */
export function productionReferenceOwnerMap(opts: {
  referenceUrls: readonly string[];
  subjects: readonly ChatImageVisualSubject[];
  templateUrl?: string | null;
}): ProductionReferenceOwner[] {
  return describeReferenceOrder(opts).map(({ image, owner }) => ({ image, owner }));
}
