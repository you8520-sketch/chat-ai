/** Client-safe string clip. Keep this file free of store and Node builtins. */
export function clipTrpgChars(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max).join("").trimEnd();
}

/**
 * Clip to `max` chars keeping both ends. A GM scene opens with atmosphere and ends with the round's
 * outcome and the next decision, so a head-only clip drops exactly the part later readers need.
 */
export function clipTrpgHeadTail(text: string, max: number): string {
  if (max <= 0) return "";
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  if (chars.length <= max) return chars.join("");
  const head = Math.floor(max * 0.55);
  const tail = max - head - 1;
  return `${chars.slice(0, head).join("")}…${chars.slice(chars.length - tail).join("")}`;
}

/** Clip by Unicode char count; trim outer boundaries only — preserve internal newlines. */
export function clipTrpgPreservedLines(text: string, max: number): string {
  const trimmed = text.trim();
  const chars = Array.from(trimmed);
  if (chars.length <= max) return trimmed;
  return chars.slice(0, max).join("").trimEnd();
}
