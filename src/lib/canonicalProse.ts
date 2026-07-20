import {
  splitProseAndStatusWidgetValues,
  stripIncompleteStatusWidgetTail,
} from "@/lib/statusWidget/parseValues";
import { resolveActiveVariantContent, type MessageVariant } from "@/lib/messageAlternates";
import { formatNovelProseForDisplay } from "@/lib/novelParagraphs";

export type ProseFormattingMismatchLengths = {
  messageId?: number | string | null;
  streamingSource?: string | null;
  storedProse?: string | null;
  finalDisplaySource?: string | null;
  editModalValue?: string | null;
  savedProse?: string | null;
  transform?: string;
};

export type ProseSourceDivergenceInput = {
  messageId?: number | string | null;
  phase: string;
  streamingSource?: string | null;
  dbSource?: string | null;
  activeVariantSource?: string | null;
  displaySource?: string | null;
  editSource?: string | null;
  usedPreferDisplayedNewlineLayout?: boolean;
  sourceFieldUsedByEditModal?: string;
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

/** Display-string form of canonical raw (for diagnostics / parity checks). Not for Edit. */
export function getDisplayAlignedCanonicalProseBody(text: string): string {
  return formatNovelProseForDisplay(getCanonicalProseBody(text)).join("\n\n");
}

/** Edit textarea must seed from DB/canonical raw — never display-normalized prose. */
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

export function proseSourceHash(text: string | null | undefined): string | null {
  if (text == null) return null;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function hasSentenceParagraphPattern(text: string | null | undefined): boolean {
  if (!text) return false;
  const paragraphs = normalizeProseLineEndings(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length < 4) return false;
  const oneSentence = paragraphs.filter((p) => {
    if (/^["“”'‘’].*["“”'‘’]$/.test(p)) return false;
    const sentenceMarks = p.match(/[.!?。！？]/g);
    return (sentenceMarks?.length ?? 0) <= 1;
  });
  return oneSentence.length / paragraphs.length >= 0.8;
}

export function logProseSourceDivergenceDev(input: ProseSourceDivergenceInput): void {
  if (process.env.NODE_ENV === "production") return;

  const sources = [
    input.streamingSource,
    input.dbSource,
    input.activeVariantSource,
    input.displaySource,
    input.editSource,
  ].filter((value): value is string => value != null);
  if (sources.length < 2) return;

  const baseline = sources[0]!;
  const mismatch = sources.find((value) => value !== baseline);
  if (!mismatch) return;

  console.warn("[ProseSourceDivergence]", {
    messageId: input.messageId ?? null,
    phase: input.phase,
    streamingHash: proseSourceHash(input.streamingSource),
    dbHash: proseSourceHash(input.dbSource),
    activeVariantHash: proseSourceHash(input.activeVariantSource),
    displayHash: proseSourceHash(input.displaySource),
    editHash: proseSourceHash(input.editSource),
    firstDiffIndex: firstDifferingIndex(baseline, mismatch),
    sentenceParagraphPatternDetected: sources.some(hasSentenceParagraphPattern),
    usedPreferDisplayedNewlineLayout: input.usedPreferDisplayedNewlineLayout === true,
    sourceFieldUsedByEditModal: input.sourceFieldUsedByEditModal ?? "unknown",
  });
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

export function logDisplayEditSourceMismatchDev(input: {
  messageId?: number | string | null;
  displaySource?: string | null;
  editSource?: string | null;
  contentSource?: string | null;
  activeVariantSource?: string | null;
  editSourceKind?: string;
  displaySourceKind?: string;
}): void {
  if (process.env.NODE_ENV === "production") return;
  const display = input.displaySource ?? "";
  const edit = input.editSource ?? "";
  if (!display || !edit || display === edit) return;

  console.warn("[DisplayEditSourceMismatch]", {
    messageId: input.messageId ?? null,
    displayLength: display.length,
    editLength: edit.length,
    contentLength: input.contentSource?.length ?? null,
    activeVariantLength: input.activeVariantSource?.length ?? null,
    firstDiffIndex: firstDifferingIndex(display, edit),
    editSourceKind: input.editSourceKind ?? "unknown",
    displaySourceKind: input.displaySourceKind ?? "unknown",
    sentenceParagraphPatternDetected: /\S+[.!?。！？]\s*\n{2,}\S+/.test(edit),
  });
}
