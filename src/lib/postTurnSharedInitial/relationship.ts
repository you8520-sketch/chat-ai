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

/** Scope words that may appear in a deadline without being in the promise text. */
const PROMISE_DEADLINE_SCOPE_WORDS = new Set([
  "이번",
  "처치",
  "손목",
  "까지",
  "오늘",
  "내일",
  "기한",
  "후",
  "전",
  "동안",
  "중",
  "날",
  "해당",
  "현재",
  "끝날",
]);

function deadlineIntroducesForeignActor(text: string, deadline: string): boolean {
  const tokens = deadline.match(/[가-힣]{2,}/g) ?? [];
  return tokens.some((token) => !PROMISE_DEADLINE_SCOPE_WORDS.has(token) && !text.includes(token));
}

function parsePromisesAdd(value: unknown): MemoryPromise[] | null {
  if (!Array.isArray(value)) return null;
  const out: MemoryPromise[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record || typeof record.text !== "string") return null;
    const text = record.text.trim();
    if (!text) continue;
    const rawDeadline =
      typeof record.deadline === "string" && record.deadline.trim()
        ? record.deadline.trim()
        : "";
    const deadline =
      rawDeadline && !deadlineIntroducesForeignActor(text, rawDeadline)
        ? rawDeadline
        : undefined;
    out.push({ text, ...(deadline ? { deadline } : {}) } as MemoryPromise);
  }
  return out;
}

/**
 * Parse the relationship section of the shared post-turn Luna response with
 * explicit section evidence and a STRICT schema:
 *  - present + valid + all four canonical arrays empty → VALID NO-OP
 *  - present + valid + delta                            → VALID DELTA
 *  - missing / `{}` / partial keys / wrong type / null  → SECTION FAILURE
 * The four canonical arrays (items, itemsRemove, promisesAdd, promisesRemove)
 * must ALL be present with the correct type; anything less is invalid and
 * routes to independent relationship recovery.
 */
export function parseSharedRelationshipSection(raw: unknown): RelationshipSectionParse {
  if (raw === undefined || raw === null) {
    return { present: false, valid: false, delta: {} };
  }
  const section = asRecord(raw);
  if (!section) return { present: true, valid: false, delta: {} };

  const promisesAdd = parsePromisesAdd(section.promisesAdd);
  if (
    !isStringArray(section.items) ||
    !isStringArray(section.itemsRemove) ||
    !isStringArray(section.promisesRemove) ||
    promisesAdd == null
  ) {
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
