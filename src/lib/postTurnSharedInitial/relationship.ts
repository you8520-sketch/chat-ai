import {
  restrictRelationshipMetaDeltaToDurableAutoFacts,
  type MemoryPromise,
  type RelationshipMetaDelta,
} from "@/lib/chatMemory";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Parse the relationship section of the shared post-turn Luna response.
 * Only durable auto-extract fields are kept (items/itemsRemove/promisesAdd/
 * promisesRemove); a missing/empty section is a valid empty delta, never a
 * whole-response failure.
 */
export function parseSharedRelationshipDelta(raw: unknown): RelationshipMetaDelta {
  const section = asRecord(raw);
  if (!section) return {};
  const promisesAdd: MemoryPromise[] = Array.isArray(section.promisesAdd)
    ? section.promisesAdd
        .map((entry) => {
          const record = asRecord(entry);
          if (!record) return null;
          const text = typeof record.text === "string" ? record.text.trim() : "";
          if (!text) return null;
          const deadline =
            typeof record.deadline === "string" && record.deadline.trim()
              ? record.deadline.trim()
              : undefined;
          return { text, ...(deadline ? { deadline } : {}) } as MemoryPromise;
        })
        .filter((entry): entry is MemoryPromise => entry != null)
    : [];
  return restrictRelationshipMetaDeltaToDurableAutoFacts({
    items: stringArray(section.items),
    itemsRemove: stringArray(section.itemsRemove),
    promisesAdd,
    promisesRemove: stringArray(section.promisesRemove),
  });
}
