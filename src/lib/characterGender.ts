export const CHARACTER_GENDERS = ["male", "female", "other"] as const;
export type CharacterGender = (typeof CHARACTER_GENDERS)[number];

export const GENDER_LABELS: Record<CharacterGender, string> = {
  male: "남성",
  female: "여성",
  other: "기타",
};

export function parseCharacterGender(value: unknown): CharacterGender | null {
  if (typeof value === "string" && (CHARACTER_GENDERS as readonly string[]).includes(value)) {
    return value as CharacterGender;
  }
  return null;
}

/** DB·구버전 캐릭터용 — 없으면 기타 */
export function resolveCharacterGender(value: unknown): CharacterGender {
  return parseCharacterGender(value) ?? "other";
}

export function formatCharacterIdentityForBackground(
  name: string,
  gender: CharacterGender
): string | null {
  const trimmedName = name.trim();
  const parts: string[] = [];
  if (trimmedName) parts.push(`이름: ${trimmedName}`);
  if (gender === "male" || gender === "female") {
    parts.push(
      `성별: ${GENDER_LABELS[gender]} — 절대 준수. ${
        gender === "male"
          ? "캐릭터를 여성으로 묘사하거나 여성형 신체·호칭으로 바꾸지 말 것."
          : "캐릭터를 남성으로 묘사하거나 남성형 신체·호칭으로 바꾸지 말 것."
      }`
    );
  }
  return parts.length > 0 ? parts.join("\n") : null;
}
