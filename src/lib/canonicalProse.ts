import {
  splitProseAndStatusWidgetValues,
  stripIncompleteStatusWidgetTail,
} from "@/lib/statusWidget/parseValues";
import { resolveActiveVariantContent, type MessageVariant } from "@/lib/messageAlternates";

export type ProseFormattingMismatchLengths = {
  messageId?: number | string | null;
  streamingSource?: string | null;
  storedProse?: string | null;
  finalDisplaySource?: string | null;
  editModalValue?: string | null;
  savedProse?: string | null;
  transform?: string;
};

export type AssistantCanonicalSource = {
  content: string;
  variants?: MessageVariant[];
  activeVariant?: number | null;
};

export function normalizeProseLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function getCanonicalProseBody(text: string): string {
  const normalized = normalizeProseLineEndings(text);
  return splitProseAndStatusWidgetValues(stripIncompleteStatusWidgetTail(normalized)).prose.trim();
}

export function resolveAssistantCanonicalProseSource(
  message: AssistantCanonicalSource
): string {
  return resolveActiveVariantContent(message);
}

export function resolveAssistantEditInitialValue(message: AssistantCanonicalSource): string {
  return getCanonicalProseBody(resolveAssistantCanonicalProseSource(message));
}

export function normalizeEditedProseForSave(text: string): string {
  return normalizeProseLineEndings(text);
}

export function firstDifferingIndex(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

export function logRegeneratedEditFormattingMismatchDev(input: {
  messageId?: number | string | null;
  storedCanonicalProse: string;
  editModalValue: string;
  transform?: string;
  fallbackSource?: string;
}): void {
  if (process.env.NODE_ENV === "production") return;
  if (input.storedCanonicalProse === input.editModalValue) return;

  console.warn("[RegeneratedEditFormattingMismatch]", {
    messageId: input.messageId ?? null,
    storedLength: input.storedCanonicalProse.length,
    editValueLength: input.editModalValue.length,
    firstDifferingIndex: firstDifferingIndex(
      input.storedCanonicalProse,
      input.editModalValue
    ),
    transform: input.transform ?? "unknown",
    fallbackSource: input.fallbackSource ?? null,
  });
}

export function logProseFormattingMismatchDev(input: ProseFormattingMismatchLengths): void {
  if (process.env.NODE_ENV === "production") return;

  const entries = {
    streamingSource: input.streamingSource ?? null,
    storedProse: input.storedProse ?? null,
    finalDisplaySource: input.finalDisplaySource ?? null,
    editModalValue: input.editModalValue ?? null,
    savedProse: input.savedProse ?? null,
  };
  const present = Object.values(entries).filter((value): value is string => value != null);
  if (present.length < 2) return;

  const baseline = present[0]!;
  const mismatch = present.find((value) => value !== baseline);
  if (!mismatch) return;

  console.warn("[ProseFormattingMismatch]", {
    messageId: input.messageId ?? null,
    streamingSourceLength: input.streamingSource?.length ?? null,
    storedProseLength: input.storedProse?.length ?? null,
    finalDisplaySourceLength: input.finalDisplaySource?.length ?? null,
    editModalValueLength: input.editModalValue?.length ?? null,
    savedProseLength: input.savedProse?.length ?? null,
    firstDifferingIndex: firstDifferingIndex(baseline, mismatch),
    transform: input.transform ?? "unknown",
  });
}
