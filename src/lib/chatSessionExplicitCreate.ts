import { canAccessAdultContent, type AdultAccessUser } from "@/lib/adultVerification";
import { canAccessCharacter } from "@/lib/characterVisibility";
import { createChatSession } from "@/lib/chatSessionCreate";
import { getDb } from "@/lib/db";
import {
  mergeUserNoteWithChatPrefs,
  resolveInitialUserChatPrefs,
} from "@/lib/userChatPrefs";
import { ensureDefaultPublicPersona, validatePersonaSelection } from "@/lib/userPersonas";

export type ExplicitChatSessionUser = AdultAccessUser & {
  id: number;
  nickname: string;
};

export type ExplicitChatSessionCreateInput = {
  user: ExplicitChatSessionUser;
  characterId: number;
  fresh?: boolean;
  personaId?: number | null;
  __testOnGreetingSchedule?: (messageId: number, chatId: number) => void;
};

export type ExplicitChatSessionCreateResult =
  | { ok: true; chatId: number; created: boolean }
  | { ok: false; status: 403 | 404; error: string; needVerify?: boolean };

type CharacterCreateRow = {
  id: number;
  greeting: string;
  nsfw: number;
  creator_id: number | null;
  visibility: string;
  moderation_status: string;
  official: number;
};

function loadCharacter(characterId: number): CharacterCreateRow | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, greeting, nsfw, creator_id, visibility, moderation_status, official
       FROM characters WHERE id=?`
    )
    .get(characterId) as CharacterCreateRow | undefined;
}

function loadLatestOwnedChatId(userId: number, characterId: number): number | undefined {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id FROM chats WHERE user_id=? AND character_id=? ORDER BY id DESC LIMIT 1"
    )
    .get(userId, characterId) as { id: number } | undefined;
  return row?.id;
}

function resolveCreatePersonaId(
  userId: number,
  nickname: string,
  personaId?: number | null
): number | null {
  const personaList = ensureDefaultPublicPersona(userId, nickname);
  let createPersonaId = personaList[0]?.id ?? null;
  if (personaId != null && Number.isFinite(personaId)) {
    const selection = validatePersonaSelection(personaList, personaId);
    if (selection.ok) {
      createPersonaId = selection.persona.id;
    } else if (selection.fallbackPersona) {
      createPersonaId = selection.fallbackPersona.id;
    }
  }
  return createPersonaId;
}

/** Explicit new-room / first-room mutation. GET/render must not call this. */
export function createExplicitChatSession(
  input: ExplicitChatSessionCreateInput
): ExplicitChatSessionCreateResult {
  const character = loadCharacter(input.characterId);
  if (!character) {
    return { ok: false, status: 404, error: "캐릭터를 찾을 수 없습니다." };
  }

  const access = canAccessCharacter(
    {
      id: character.id,
      creator_id: character.creator_id,
      visibility: (character.visibility as "public" | "link" | "private") ?? "private",
      moderation_status:
        (character.moderation_status as "pending" | "approved" | "rejected") ?? "approved",
      share_slug: null,
      official: character.official,
    },
    input.user.id
  );
  if (!access.ok) {
    return { ok: false, status: 403, error: access.reason };
  }

  if (character.nsfw === 1 && !canAccessAdultContent(input.user)) {
    return {
      ok: false,
      status: 403,
      error: "성인용 캐릭터는 성인인증 후 이용할 수 있습니다.",
      needVerify: true,
    };
  }

  const db = getDb();
  const createOnce = db.transaction(() => {
    if (!input.fresh) {
      const existingId = loadLatestOwnedChatId(input.user.id, character.id);
      if (existingId) {
        return { chatId: existingId, created: false as const };
      }
    }

    const userProfileRow = db
      .prepare("SELECT chat_prefs FROM users WHERE id=?")
      .get(input.user.id) as { chat_prefs: string } | undefined;
    const bootstrapPrefs = resolveInitialUserChatPrefs({
      serverRaw: userProfileRow?.chat_prefs,
      chatTargetResponseChars: undefined,
    });

    const chatId = createChatSession({
      userId: input.user.id,
      characterId: character.id,
      greeting: character.greeting,
      mode: character.nsfw ? "nsfw" : "safe",
      userNote: mergeUserNoteWithChatPrefs("", bootstrapPrefs),
      selectedPersonaId: resolveCreatePersonaId(
        input.user.id,
        input.user.nickname,
        input.personaId
      ),
      targetResponseChars: bootstrapPrefs.targetResponseChars,
      __testOnGreetingSchedule: input.__testOnGreetingSchedule,
    });
    return { chatId, created: true as const };
  });

  return { ok: true, ...createOnce.immediate() };
}
