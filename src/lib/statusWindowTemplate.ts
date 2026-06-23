/** @deprecated Status window feature removed — minimal parse helpers for legacy messages */

export type StatusWindowField = { label: string; hint: string };
export type ParsedStatusLine = { label: string; value: string };
export type StatusWindowOutputMode = "markdown" | "html" | "structured" | "compact" | "freeform";

export const STATUS_BLOCK_START = "<<<STATUS>>>";
export const STATUS_BLOCK_END = "<<<END>>>";

export function parseStatusWindowTemplate(_raw?: string | null): StatusWindowField[] {
  return [];
}

export function serializeStatusWindowTemplate(_fields: StatusWindowField[]): string {
  return "";
}

export function isStructuredStatusWindowTemplate(_raw?: string | null): boolean {
  return false;
}

export function statusWindowTemplateCharCount(_fields: StatusWindowField[]): number {
  return 0;
}

export function splitAssistantMessageStatus(
  text: string,
  _templateLabels?: string[],
  _opts?: { allowHtml?: boolean }
): { body: string; statusLines: ParsedStatusLine[] | null; htmlStatus: string | null } {
  return { body: text, statusLines: null, htmlStatus: null };
}

export function peelIncompleteTailForLengthCap(text: string, _opts?: { allowHtml?: boolean }): string {
  return text.trimEnd();
}

export function hasCompleteAssistantStatusWindow(
  _text: string,
  _templateLabels?: string[],
  _opts?: { allowHtml?: boolean }
): boolean {
  return false;
}

export function hasPartialAssistantStatusWindow(_text: string): boolean {
  return false;
}

export function relocateMisplacedStatusWindow(text: string): string {
  return text;
}

export function fieldsToMarkdownPromptSpec(_fields: StatusWindowField[]): string {
  return "";
}

export function buildMarkdownStatusTable(_fields: StatusWindowField[]): string {
  return "";
}
