import {
  splitProseAndStatusWidgetValues,
  stripIncompleteStatusWidgetTail,
} from "@/lib/statusWidget/parseValues";

export type ProseFormattingMismatchLengths = {
  messageId?: number | string | null;
  streamingSource?: string | null;
  storedProse?: string | null;
  finalDisplaySource?: string | null;
  editModalValue?: string | null;
  savedProse?: string | null;
  transform?: string;
};

export function normalizeProseLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function getCanonicalProseBody(text: string): string {
  const normalized = normalizeProseLineEndings(text);
  return splitProseAndStatusWidgetValues(stripIncompleteStatusWidgetTail(normalized)).prose.trim();
}

export function normalizeEditedProseForSave(text: string): string {
  return normalizeProseLineEndings(text);
}

function firstDifferingIndex(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
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
