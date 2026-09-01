import type { SceneDialogueSpeaker } from "@/lib/chatImageScenePlan";
import {
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
    return "stable group layout — left / center / right readable; follow cast manifest composition goal";
  }
  const character = resolveSpeakerSubject(map, "character");
  const persona = resolveSpeakerSubject(map, "persona");
  if (!personaVisible && character) {
    return `SUBJECT ${character.label} (${character.name}) centered; persona off-camera only`;
  }
  if (character && persona) {
    return `${character.label} left, ${persona.label} right — maintain stable orientation across panels`;
  }
  if (character) {
    return `SUBJECT ${character.label} (${character.name}) centered`;
  }
  return "recurring characters readable in frame";
}

export type PromptIdentityBindingAudit = {
  promptSubjectLabelOwnerCount: number;
  subjectLabelConflictCount: number;
  referenceOwnerConflictCount: number;
  actionOwnerConflictCount: number;
  speechOwnerConflictCount: number;
};

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

  return {
    promptSubjectLabelOwnerCount: 1,
    subjectLabelConflictCount,
    referenceOwnerConflictCount,
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

export function referenceOwnerMap(
  map: PromptSubjectMap,
  templatePresent: boolean
): Array<{ image: number; owner: string }> {
  const offset = templatePresent ? 1 : 0;
  return map.subjects
    .filter((subject) => subject.referenceIndex != null)
    .map((subject) => ({
      image: subject.referenceIndex!,
      owner: subject.name,
    }))
    .sort((left, right) => left.image - right.image);
}
