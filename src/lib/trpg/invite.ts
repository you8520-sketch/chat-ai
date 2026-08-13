/** Client-safe invite helpers. Codes are 8-char hex from `newTrpgInviteCode`. */

const INVITE_CODE_RE = /^[a-f0-9]{8}$/i;

export function parseTrpgInviteInput(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const fromPath = text.match(/\/trpg\/join\/([a-f0-9]{8})\b/i);
  if (fromPath) return fromPath[1].toLowerCase();
  try {
    const url = new URL(text.includes("://") ? text : `https://local.invalid${text.startsWith("/") ? text : `/${text}`}`);
    const fromQuery = url.searchParams.get("code") || url.searchParams.get("invite");
    if (fromQuery && INVITE_CODE_RE.test(fromQuery.trim())) return fromQuery.trim().toLowerCase();
    const pathMatch = url.pathname.match(/\/trpg\/join\/([a-f0-9]{8})$/i);
    if (pathMatch) return pathMatch[1].toLowerCase();
  } catch {
    /* not a URL */
  }
  if (INVITE_CODE_RE.test(text)) return text.toLowerCase();
  return "";
}

export function trpgInvitePath(code: string): string {
  const parsed = parseTrpgInviteInput(code);
  return parsed ? `/trpg/join/${parsed}` : "";
}
