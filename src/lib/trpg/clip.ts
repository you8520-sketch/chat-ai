/** Client-safe string clip. Do not import store / node:crypto from this file. */
export function clipTrpgChars(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max).join("").trimEnd();
}
