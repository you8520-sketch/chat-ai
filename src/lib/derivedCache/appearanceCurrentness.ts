import {
  APPEARANCE_COMPILED_VERSION,
  hashAppearanceRaw,
  parseAppearanceCompiledJson,
} from "@/lib/appearanceCompiler";

export function isAppearanceCompiledCurrent(input: {
  raw: string;
  compiledJson?: string | null;
  compiledSourceHash?: string | null;
  compiledVersion?: number | null;
}): boolean {
  if (!input.compiledJson?.trim()) return false;
  if (!parseAppearanceCompiledJson(input.compiledJson)) return false;
  const expectedHash = hashAppearanceRaw(input.raw);
  return (
    (input.compiledSourceHash ?? "") === expectedHash &&
    (input.compiledVersion ?? 0) === APPEARANCE_COMPILED_VERSION
  );
}

/** Canonical runtime appearance text — compiled only when CURRENT, else raw. */
export function resolveAppearancePromptText(input: {
  raw: string;
  compiledJson?: string | null;
  compiledSourceHash?: string | null;
  compiledVersion?: number | null;
}): string {
  if (!isAppearanceCompiledCurrent(input)) {
    return input.raw.trim();
  }
  const compiled = parseAppearanceCompiledJson(input.compiledJson);
  const compiledText =
    compiled?.compiled_text.trim() ||
    ["body", "hair", "eyes", "face", "lips_makeup", "clothing", "impression"]
      .map((k) => compiled?.[k as keyof typeof compiled])
      .filter(Boolean)
      .join(", ");
  return (compiledText || input.raw).trim();
}
