import type { User } from "@/lib/auth-types";
import { resolvePersonaDisplayName } from "@/lib/userPlaceholder";
import { ensureDefaultPersona, resolveChatSelectedPersona } from "@/lib/userPersonas";

/** 미리보기·공개 페이지 — {{user}} 치환용 (페르소나 이름 → 없으면 닉네임) */
export function resolveViewerDisplayNameForUser(user: Pick<User, "id" | "nickname">): string {
  const personas = ensureDefaultPersona(user.id, user.nickname);
  const { persona } = resolveChatSelectedPersona(user as User, personas, null);
  return resolvePersonaDisplayName(persona?.name, user.nickname);
}
