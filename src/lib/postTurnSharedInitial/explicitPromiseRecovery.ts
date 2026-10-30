import type { MemoryPromise, RelationshipMetaDelta } from "@/lib/chatMemory";

const EXPLICIT_PROMISE_SPEECH =
  /약속하죠|약속할게(?:요)?|약속한다|약속하마|약속이에요|약속입니다|,\s*promise\.|\bI promise\b/i;

const CANCEL_OR_WITHDRAW = /취소|없던 일|철회|파기|그만둘/;

const QUESTION_TAIL = /[?？]$/;

const MAX_RECOVERED_PROMISES = 2;
const MAX_PROMISE_CHARS = 160;

function splitProseUnits(text: string): string[] {
  return text
    .split(/(?<=[.!?。]|」|"|”|\n)/)
    .map((unit) => unit.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isRecoverablePromiseUnit(unit: string): boolean {
  if (!EXPLICIT_PROMISE_SPEECH.test(unit)) return false;
  if (CANCEL_OR_WITHDRAW.test(unit)) return false;
  if (QUESTION_TAIL.test(unit)) return false;
  return true;
}

function normalizePromiseText(unit: string): string {
  return unit
    .replace(/^["「『“]+/, "")
    .replace(/["」』”]+$/, "")
    .trim()
    .slice(0, MAX_PROMISE_CHARS);
}

/**
 * Recover binding spoken promises from the same turn prose Luna already saw.
 * Does not write items, honorifics, or thoughts. Does not call a model.
 */
export function recoverExplicitPromisesFromTurnProse(input: {
  userMessage: string;
  assistantMessage: string;
}): MemoryPromise[] {
  const prose = [input.userMessage, input.assistantMessage]
    .filter((part) => part.trim())
    .join("\n");
  const units = splitProseUnits(prose).filter(isRecoverablePromiseUnit);
  const korean = units.filter((unit) => /[가-힣]/.test(unit));
  const chosen = (korean.length > 0 ? korean : units)
    .map(normalizePromiseText)
    .filter(Boolean);
  const unique: MemoryPromise[] = [];
  const seen = new Set<string>();
  for (const text of chosen) {
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ text });
    if (unique.length >= MAX_RECOVERED_PROMISES) break;
  }
  return unique;
}

/** Keep a model-emitted promisesAdd. Fill only a valid-empty miss. */
export function attachRecoveredPromisesToDelta(
  delta: RelationshipMetaDelta,
  prose: { userMessage: string; assistantMessage: string }
): RelationshipMetaDelta {
  if ((delta.promisesAdd?.length ?? 0) > 0) return delta;
  const recovered = recoverExplicitPromisesFromTurnProse(prose);
  if (recovered.length === 0) return delta;
  return { ...delta, promisesAdd: recovered };
}
