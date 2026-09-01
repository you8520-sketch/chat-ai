/** Client-safe string clip. Keep this file free of store and Node builtins. */
export function clipTrpgChars(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max).join("").trimEnd();
}

/** Clip by Unicode char count; trim outer boundaries only — preserve internal newlines. */
export function clipTrpgPreservedLines(text: string, max: number): string {
  const trimmed = text.trim();
  const chars = Array.from(trimmed);
  if (chars.length <= max) return trimmed;
  return chars.slice(0, max).join("").trimEnd();
}
