import {
  restrictRelationshipMetaDeltaToDurableAutoFacts,
  type MemoryPromise,
  type RelationshipMetaDelta,
} from "@/lib/chatMemory";
import type { RelationshipSectionParse } from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parsePromisesAdd(value: unknown): MemoryPromise[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: MemoryPromise[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record || typeof record.text !== "string") return null;
    const text = record.text.trim();
    if (!text) continue;
    const deadline =
      typeof record.deadline === "string" && record.deadline.trim()
        ? record.deadline.trim()
        : undefined;
    out.push({ text, ...(deadline ? { deadline } : {}) } as MemoryPromise);
  }
  return out;
}

/**
 * Parse the relationship section of the shared post-turn Luna response with
 * explicit section evidence:
 *  - present + valid + empty arrays → VALID NO-OP
 *  - present + valid + delta       → VALID DELTA
 *  - missing                       → present=false, valid=false (SECTION FAILURE)
 *  - malformed                     → present=true, valid=false (SECTION FAILURE)
 * Only durable auto-extract fields are kept. A section failure never
 * invalidates the status/suggestions sections.
 */
export function parseSharedRelationshipSection(raw: unknown): RelationshipSectionParse {
  if (raw === undefined || raw === null) {
    return { present: false, valid: false, delta: {} };
  }
  const section = asRecord(raw);
  if (!section) return { present: true, valid: false, delta: {} };

  const itemsOk = section.items === undefined || isStringArray(section.items);
  const itemsRemoveOk = section.itemsRemove === undefined || isStringArray(section.itemsRemove);
  const promisesRemoveOk =
    section.promisesRemove === undefined || isStringArray(section.promisesRemove);
  const promisesAdd = parsePromisesAdd(section.promisesAdd);
  if (!itemsOk || !itemsRemoveOk || !promisesRemoveOk || promisesAdd == null) {
    return { present: true, valid: false, delta: {} };
  }

  return {
    present: true,
    valid: true,
    delta: restrictRelationshipMetaDeltaToDurableAutoFacts({
      items: stringArray(section.items),
      itemsRemove: stringArray(section.itemsRemove),
      promisesAdd,
      promisesRemove: stringArray(section.promisesRemove),
    }),
  };
}
