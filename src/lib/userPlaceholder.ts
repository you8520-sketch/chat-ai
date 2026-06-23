/** 캐릭터 설정·대사 등에 쓰는 플레이스홀더: {{user}}, {{char}} */
const USER_PLACEHOLDER_RE = /\{\{\s*user\s*\}\}/gi;
const CHAR_PLACEHOLDER_RE = /\{\{\s*char\s*\}\}/gi;

export function resolvePersonaDisplayName(personaName: string | null | undefined, fallbackNickname: string): string {
  return personaName?.trim() || fallbackNickname.trim() || "유저";
}

export function resolveCharacterDisplayName(characterName: string | null | undefined): string {
  return characterName?.trim() || "캐릭터";
}

/** {{char}} → 캐릭터 카드명 */
export function replaceCharPlaceholder(text: string, characterName: string | null | undefined): string {
  if (!text || !/\{\{\s*char\s*\}\}/i.test(text)) return text;
  return text.replace(CHAR_PLACEHOLDER_RE, resolveCharacterDisplayName(characterName));
}

/** {{user}} → 페르소나 이름(없으면 닉네임) */
export function replaceUserPlaceholder(
  text: string,
  personaName: string | null | undefined,
  fallbackNickname: string
): string {
  if (!text || !/\{\{\s*user\s*\}\}/i.test(text)) return text;
  const name = resolvePersonaDisplayName(personaName, fallbackNickname);
  return text.replace(USER_PLACEHOLDER_RE, name);
}

/** {{user}} · {{char}} 한 번에 치환 */
export function replaceProfilePlaceholders(
  text: string,
  opts: {
    personaName?: string | null;
    fallbackNickname?: string;
    characterName?: string | null;
  }
): string {
  if (!text) return text;
  let out = replaceCharPlaceholder(text, opts.characterName ?? null);
  out = replaceUserPlaceholder(out, opts.personaName, opts.fallbackNickname ?? "");
  return out;
}

/** 미리보기용 — 이미 resolve된 표시 이름으로 {{user}} · {{char}} 치환 */
export function applyProfilePlaceholders(
  text: string,
  opts: { viewerDisplayName?: string | null; characterDisplayName?: string | null }
): string {
  if (!text) return text;
  let out = text;
  if (opts.characterDisplayName?.trim() && /\{\{\s*char\s*\}\}/i.test(out)) {
    out = out.replace(CHAR_PLACEHOLDER_RE, opts.characterDisplayName.trim());
  }
  if (opts.viewerDisplayName?.trim() && /\{\{\s*user\s*\}\}/i.test(out)) {
    out = out.replace(USER_PLACEHOLDER_RE, opts.viewerDisplayName.trim());
  }
  return out;
}

/** @deprecated applyProfilePlaceholders 사용 */
export function applyViewerDisplayName(text: string, displayName?: string | null): string {
  return applyProfilePlaceholders(text, { viewerDisplayName: displayName });
}
export function replaceUserPlaceholderInChunks<T extends { content: string }>(
  chunks: T[],
  personaName: string | null | undefined,
  fallbackNickname: string
): T[] {
  return chunks.map((c) => ({
    ...c,
    content: replaceUserPlaceholder(c.content, personaName, fallbackNickname),
  }));
}
