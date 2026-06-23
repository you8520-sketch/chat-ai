export const CHAT_TITLE_MAX = 32;

export function sanitizeChatTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, CHAT_TITLE_MAX);
}

export function defaultForkTitle(): string {
  const d = new Date();
  return `분기 ${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatBranchTitle(title: string | null | undefined, sessionOrdinal: number): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  return `대화 ${sessionOrdinal}`;
}
