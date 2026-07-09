const TRAILING_QUOTE_RUN_RE = /(?:\s*["'“”‘’`´＂＇]){3,}\s*$/u;

export function stripRepeatedTrailingQuoteMarks(text: string): string {
  return text.replace(TRAILING_QUOTE_RUN_RE, "").trimEnd();
}
