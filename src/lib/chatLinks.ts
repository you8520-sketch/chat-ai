export function chatEntryHref(
  characterId: number,
  opts: { fresh?: boolean; chatId?: number; personaId?: number | null }
): string {
  const params = new URLSearchParams();
  if (opts.fresh) params.set("fresh", "1");
  if (opts.chatId) params.set("chat", String(opts.chatId));
  if (opts.personaId) params.set("persona", String(opts.personaId));
  const q = params.toString();
  return `/chat/${characterId}${q ? `?${q}` : ""}`;
}

/** 캐릭터 카드·목록 링크 — 비로그인은 로그인, 성인 캐릭터는 성인인증 안내 */
export function characterCardHref(opts: {
  characterId: number;
  nsfw: boolean;
  blurNsfw: boolean;
  loggedIn: boolean;
}): string {
  const characterPath = `/character/${opts.characterId}`;

  if (!opts.loggedIn) {
    return `/login?redirect=${encodeURIComponent(characterPath)}`;
  }

  if (opts.nsfw && opts.blurNsfw) {
    return `/verify?redirect=${encodeURIComponent(characterPath)}`;
  }

  return characterPath;
}

export function characterPageHref(
  characterId: number,
  blurNsfw: boolean,
  nsfw: boolean,
  loggedIn = true
): string {
  return characterCardHref({ characterId, nsfw, blurNsfw, loggedIn });
}
