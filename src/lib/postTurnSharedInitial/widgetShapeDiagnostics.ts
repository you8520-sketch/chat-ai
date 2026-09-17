import { fieldPlaceholderKey } from "@/lib/statusWidget/fieldKeys";
import { collectWidgetJsonKeys } from "@/lib/statusWidget/prompt";
import {
  dropInstructionEchoFields,
  extractJsonObjectFromWidgetText,
  isWidgetPlaceholderValue,
  normalizeWidgetExtraction,
} from "@/lib/statusWidget/extractNormalize";
import type { StatusWidget } from "@/lib/statusWidget/types";
import type { PostTurnSharedInitialInput } from "./types";

export type PostTurnSharedInitialWidgetShapeDiagnostics = {
  statusWidgetPresent: boolean;
  characterValuesPresent: boolean;
  userValuesPresent: boolean;
  characterReturnedKeyCount: number;
  userReturnedKeyCount: number;
  characterRecognizedKeyCount: number;
  userRecognizedKeyCount: number;
  placeholderLikeDroppedCount: number;
  instructionEchoDroppedCount: number;
  unknownKeyCount: number;
};

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function expectedKeysForWidget(widget: StatusWidget | null | undefined): Set<string> {
  const keys = new Set<string>();
  if (!widget) return keys;
  for (const field of widget.fields) {
    const key = fieldPlaceholderKey(field);
    if (key) keys.add(key);
    if (field.id?.trim()) keys.add(field.id.trim());
    if (field.label.trim()) keys.add(field.label.trim());
  }
  return keys;
}

function countReturnedKeys(section: Record<string, unknown> | null): number {
  if (!section) return 0;
  return Object.keys(section).filter((key) => {
    const value = section[key];
    return typeof value === "string" || typeof value === "number";
  }).length;
}

function countPlaceholderLikeDropped(
  section: Record<string, unknown> | null,
  widget: StatusWidget | null | undefined
): number {
  if (!section || !widget) return 0;
  const normalized = normalizeWidgetExtraction(section, widget);
  const recognized = new Set(Object.keys(normalized));
  let dropped = 0;
  for (const [key, value] of Object.entries(section)) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = String(value).trim();
    if (!text) continue;
    const canonicalKey = key.trim();
    if (isWidgetPlaceholderValue(text) && !recognized.has(canonicalKey)) {
      dropped += 1;
    }
  }
  return dropped;
}

function countUnknownReturnedKeys(
  section: Record<string, unknown> | null,
  widget: StatusWidget | null | undefined
): { count: number; names: string[] } {
  if (!section) return { count: 0, names: [] };
  const expected = expectedKeysForWidget(widget);
  const unknown: string[] = [];
  for (const key of Object.keys(section)) {
    if (!expected.has(key.trim())) unknown.push(key.trim());
  }
  return { count: unknown.length, names: unknown.sort() };
}

/** Shape-only diagnostics for shared Luna widget extraction — never logs value bodies. */
export function analyzePostTurnSharedInitialWidgetShape(
  text: string,
  input: PostTurnSharedInitialInput
): PostTurnSharedInitialWidgetShapeDiagnostics {
  const empty: PostTurnSharedInitialWidgetShapeDiagnostics = {
    statusWidgetPresent: false,
    characterValuesPresent: false,
    userValuesPresent: false,
    characterReturnedKeyCount: 0,
    userReturnedKeyCount: 0,
    characterRecognizedKeyCount: 0,
    userRecognizedKeyCount: 0,
    placeholderLikeDroppedCount: 0,
    instructionEchoDroppedCount: 0,
    unknownKeyCount: 0,
  };
  const root = extractJsonObjectFromWidgetText(text);
  if (!root) return empty;

  const widgetRoot =
    asJsonRecord(root.statusWidget) ??
    (root.character_values != null || root.user_values != null ? root : null);

  const statusWidgetPresent = widgetRoot != null;
  const characterSection = widgetRoot ? asJsonRecord(widgetRoot.character_values) : null;
  const userSection = widgetRoot ? asJsonRecord(widgetRoot.user_values) : null;

  let characterRecognizedKeyCount = 0;
  let userRecognizedKeyCount = 0;
  let instructionEchoDroppedCount = 0;
  let placeholderLikeDroppedCount = 0;
  let unknownKeyCount = 0;

  if (input.characterWidget && characterSection) {
    const normalized = normalizeWidgetExtraction(characterSection, input.characterWidget);
    const filtered = dropInstructionEchoFields(normalized, input.characterWidget);
    characterRecognizedKeyCount = Object.keys(filtered.values).filter((k) =>
      Boolean(filtered.values[k]?.trim())
    ).length;
    instructionEchoDroppedCount += filtered.droppedKeys.length;
    placeholderLikeDroppedCount += countPlaceholderLikeDropped(
      characterSection,
      input.characterWidget
    );
    unknownKeyCount += countUnknownReturnedKeys(characterSection, input.characterWidget).count;
  }

  if (input.userWidget && userSection) {
    const normalized = normalizeWidgetExtraction(userSection, input.userWidget);
    const filtered = dropInstructionEchoFields(normalized, input.userWidget);
    userRecognizedKeyCount = Object.keys(filtered.values).filter((k) =>
      Boolean(filtered.values[k]?.trim())
    ).length;
    instructionEchoDroppedCount += filtered.droppedKeys.length;
    placeholderLikeDroppedCount += countPlaceholderLikeDropped(userSection, input.userWidget);
    unknownKeyCount += countUnknownReturnedKeys(userSection, input.userWidget).count;
  }

  return {
    statusWidgetPresent,
    characterValuesPresent: characterSection != null,
    userValuesPresent: userSection != null,
    characterReturnedKeyCount: countReturnedKeys(characterSection),
    userReturnedKeyCount: countReturnedKeys(userSection),
    characterRecognizedKeyCount,
    userRecognizedKeyCount,
    placeholderLikeDroppedCount,
    instructionEchoDroppedCount,
    unknownKeyCount,
  };
}

/** @internal tests */
export function countRecognizedWidgetKeysForInput(
  text: string,
  input: PostTurnSharedInitialInput
): number {
  const shape = analyzePostTurnSharedInitialWidgetShape(text, input);
  return shape.characterRecognizedKeyCount + shape.userRecognizedKeyCount;
}

/** @internal tests */
export function listRequiredWidgetKeys(input: PostTurnSharedInitialInput): string[] {
  const keys: string[] = [];
  if (input.characterWidget) keys.push(...collectWidgetJsonKeys(input.characterWidget));
  if (input.userWidget) keys.push(...collectWidgetJsonKeys(input.userWidget));
  return keys;
}
