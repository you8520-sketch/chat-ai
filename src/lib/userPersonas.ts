import { type User, isSubscribed } from "./auth-types";
import {
  type CharacterGender,
  resolveCharacterGender,
} from "./characterGender";
import { getDb } from "./db";
import {
  PERSONA_NAME_LIMIT,
  PERSONA_CONTENT_MAX,
  PERSONA_SECRET_CONTENT_MAX,
  validatePersonaContentLength,
  validatePersonaSecretContentLength,
  personaContentLength,
} from "./persona";

export type SubscriptionTier = "free" | "basic" | "pro";

export type DbUserPersona = {
  id: number;
  user_id: number;
  name: string;
  memo: string;
  gender: CharacterGender;
  description: string;
  secret_description: string;
  speech_examples: string;
  created_at: string;
};

export type PersonaListItem = DbUserPersona;

export type PersonaPromptCoNarrationOpts = {
  coNarrationEnabled?: boolean;
};

export function getSubscriptionTier(user: User): SubscriptionTier {
  if (!isSubscribed(user)) return "free";
  if (user.sub_plan === "pro") return "pro";
  if (user.sub_plan === "basic") return "basic";
  return "basic";
}

const PERSONA_SELECT =
  "SELECT id, user_id, name, memo, gender, description, secret_description, speech_examples, created_at FROM user_personas";

function mapPersonaRow(row: DbUserPersona): DbUserPersona {
  return {
    ...row,
    name: row.name ?? "",
    memo: row.memo ?? "",
    description: row.description ?? "",
    secret_description: row.secret_description ?? "",
    gender: resolveCharacterGender(row.gender),
    speech_examples: row.speech_examples ?? "",
  };
}

export function listUserPersonas(userId: number): DbUserPersona[] {
  const rows = getDb()
    .prepare(`${PERSONA_SELECT} WHERE user_id=? ORDER BY created_at ASC`)
    .all(userId) as DbUserPersona[];
  return rows.map(mapPersonaRow);
}

export function getPersonaById(userId: number, personaId: number): DbUserPersona | null {
  const row = getDb()
    .prepare(`${PERSONA_SELECT} WHERE id=? AND user_id=?`)
    .get(personaId, userId) as DbUserPersona | undefined;
  if (!row) return null;
  return mapPersonaRow(row);
}

export function resolveChatSelectedPersona(
  _user: User,
  personas: DbUserPersona[],
  selectedPersonaId: number | null | undefined,
  chatId?: number
): {
  persona: DbUserPersona | null;
  personaId: number | null;
  fallbackApplied: boolean;
} {
  if (personas.length === 0) {
    return { persona: null, personaId: null, fallbackApplied: false };
  }

  let fallbackApplied = false;
  let targetId = selectedPersonaId ?? null;
  let persona = targetId ? (personas.find((p) => p.id === targetId) ?? null) : null;

  if (!persona) {
    persona = personas[0];
    targetId = persona.id;
    fallbackApplied = !!selectedPersonaId;
  }

  if (fallbackApplied && chatId && targetId) {
    getDb().prepare("UPDATE chats SET selected_persona_id=? WHERE id=?").run(targetId, chatId);
  }

  return { persona, personaId: targetId, fallbackApplied };
}

export function validatePersonaSelection(
  personas: DbUserPersona[],
  personaId: number
): { ok: true; persona: DbUserPersona } | { ok: false; fallbackPersona: DbUserPersona | null } {
  const persona = personas.find((p) => p.id === personaId);
  if (!persona) {
    return { ok: false, fallbackPersona: personas[0] ?? null };
  }
  return { ok: true, persona };
}

export function ensureDefaultPersona(userId: number, nickname: string): DbUserPersona[] {
  const db = getDb();
  let personas = listUserPersonas(userId);
  if (personas.length > 0) return personas;

  const user = db.prepare("SELECT persona_name, persona_bio FROM users WHERE id=?").get(userId) as
    | { persona_name: string; persona_bio: string }
    | undefined;
  const name = (user?.persona_name?.trim() || nickname || "기본").slice(0, PERSONA_NAME_LIMIT);
  const desc = (user?.persona_bio ?? "").trim();
  db.prepare(
    "INSERT INTO user_personas (user_id, name, memo, gender, description, secret_description) VALUES (?,?,?,?,?,?)"
  ).run(userId, name, "", "other", desc, "");
  return listUserPersonas(userId);
}

/**
 * 성별에 따른 현재 턴 지칭 규칙은 contextBuilder의 단일
 * user-persona-reference owner가 담당한다. 이 블록에는 선택 페르소나의
 * 정체성 사실만 포함하고 별도의 지칭 owner를 만들지 않는다.
 */
const PERSONA_GENDER_LABELS: Record<CharacterGender, string> = {
  male: "남성",
  female: "여성",
  other: "기타",
};

/** Public persona only — never pass secret_description here. */
export function formatSelectedPersonaForPrompt(
  name: string,
  _gender: CharacterGender,
  description: string,
  opts?: PersonaPromptCoNarrationOpts
): string | null {
  const parts: string[] = [];
  const trimmedName = name.trim();
  const trimmedDesc = description.trim();
  if (trimmedName) parts.push(`이름/호칭: ${trimmedName}`);
  if (trimmedDesc) parts.push(trimmedDesc);
  if (trimmedDesc && opts?.coNarrationEnabled) {
    parts.push(
      `[유저 페르소나 — 말투]\n"${trimmedName}"의 말투는 위 설정·성격과 채팅에서 유저가 직접 입력한 대사에서 추론해 매 턴 일관 유지한다. AI 캐릭터 말투와 혼동하지 마라.`
    );
    if (/반말|구어|캐주얼|informal/i.test(trimmedDesc)) {
      parts.push(
        `[유저 말투 고정] "${trimmedName}"은(는) 반말·구어체 ONLY. ~습니다/~요/~십니다/~니다 종결 금지 (유저가 직접 그렇게 입력한 경우 제외).`
      );
    }
  }
  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

export function formatSelectedPersonaIdentityForBackground(
  name: string,
  gender: CharacterGender
): string | null {
  const trimmedName = name.trim();
  const parts: string[] = [];
  if (trimmedName) parts.push(`이름/호칭: ${trimmedName}`);
  if (gender === "male" || gender === "female") {
    parts.push(
      `성별: ${PERSONA_GENDER_LABELS[gender]} — 절대 준수. ${
        gender === "male"
          ? "유저를 여성으로 묘사하거나 여성형 신체·호칭으로 바꾸지 말 것."
          : "유저를 남성으로 묘사하거나 남성형 신체·호칭으로 바꾸지 말 것."
      }`
    );
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

/** @deprecated use formatSelectedPersonaForPrompt */
export function formatSelectedPersonaDescription(description: string): string | null {
  const trimmed = description.trim();
  return trimmed || null;
}

export function sanitizePersonaInput(
  name: string,
  description: string,
  memo = "",
  gender: unknown = "other",
  secretDescription = ""
) {
  const desc = description.trim();
  const secret = secretDescription.trim();
  return {
    name: name.trim().slice(0, PERSONA_NAME_LIMIT),
    memo: memo.trim(),
    gender: resolveCharacterGender(gender),
    description: desc,
    secret_description: secret,
  };
}

export {
  validatePersonaContentLength,
  validatePersonaSecretContentLength,
  personaContentLength,
  PERSONA_CONTENT_MAX,
  PERSONA_SECRET_CONTENT_MAX,
};
