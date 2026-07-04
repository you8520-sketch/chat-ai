import {
  normalizeMemoryMeta,
  normalizeTurnThoughts,
  type HonorificNames,
  type RelationshipMetaDelta,
} from "@/lib/chatMemory";
import {
  splitProseAndRelationshipMemoryTail,
  type RelationshipMemoryTailParse,
} from "@/lib/relationshipMemoryTailParse";

export function normalizeRelationshipMetaDeltaFromJson(
  j: Record<string, unknown>,
  dialogue: string,
  names: HonorificNames
): RelationshipMetaDelta {
  const delta: RelationshipMetaDelta = {
    items: Array.isArray(j.items) ? j.items.filter(Boolean) : [],
    thoughts: normalizeTurnThoughts(
      Array.isArray(j.thoughts) ? j.thoughts.filter(Boolean) : [],
      names
    ),
    promisesAdd: Array.isArray(j.promisesAdd)
      ? j.promisesAdd
          .map((p) => {
            if (!p || typeof p !== "object") return null;
            const row = p as { text?: string; deadline?: string };
            const text = typeof row.text === "string" ? row.text.trim() : "";
            if (!text) return null;
            const deadline =
              typeof row.deadline === "string" ? row.deadline.trim() : undefined;
            return deadline ? { text, deadline } : { text };
          })
          .filter((p): p is { text: string; deadline?: string } => p !== null)
      : [],
    promisesRemove: Array.isArray(j.promisesRemove) ? j.promisesRemove.filter(Boolean) : [],
    itemsRemove: Array.isArray(j.itemsRemove) ? j.itemsRemove.filter(Boolean) : [],
    thoughtsRemove: Array.isArray(j.thoughtsRemove) ? j.thoughtsRemove.filter(Boolean) : [],
  };

  const normalized = normalizeMemoryMeta(
    {
      honorifics: [],
      items: delta.items ?? [],
      thoughts: [],
      promises: [],
    },
    names
  );
  return {
    ...delta,
    items: normalized.items,
  };
}

export type RelationshipMemoryTailSplit = {
  prose: string;
  parseOk: boolean;
  delta: RelationshipMetaDelta;
};

export function splitAndNormalizeRelationshipMemoryTail(
  fullText: string,
  dialogue: string,
  names: HonorificNames
): RelationshipMemoryTailSplit {
  const split: RelationshipMemoryTailParse = splitProseAndRelationshipMemoryTail(fullText);
  if (!split.parseOk || !split.rawJson) {
    return { prose: split.prose, parseOk: false, delta: {} };
  }

  return {
    prose: split.prose,
    parseOk: true,
    delta: normalizeRelationshipMetaDeltaFromJson(split.rawJson, dialogue, names),
  };
}

export { splitProseAndRelationshipMemoryTail } from "@/lib/relationshipMemoryTailParse";
