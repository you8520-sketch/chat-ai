import type { CharacterGender } from "@/lib/characterGender";
import {
  formatSelectedPersonaIdentityForBackground,
  type PersonaPromptCoNarrationOpts,
} from "@/lib/userPersonas";
import { splitPersonaSecretItems } from "@/lib/personaSecretItems";

const PERSONA_GENDER_LABELS: Record<CharacterGender, string> = {
  male: "남성",
  female: "여성",
  other: "기타",
};

/** Public persona only — never includes secret_description. */
export function formatPublicPersonaForPrompt(
  name: string,
  gender: CharacterGender,
  publicDescription: string,
  opts?: PersonaPromptCoNarrationOpts
): string | null {
  const parts: string[] = [];
  const trimmedName = name.trim();
  const trimmedDesc = publicDescription.trim();
  if (trimmedName) parts.push(`이름/호칭: ${trimmedName}`);
  if (gender === "male" || gender === "female") {
    parts.push(
      `성별: ${PERSONA_GENDER_LABELS[gender]} — 절대 준수. 유저를 ${
        gender === "male"
          ? "여성으로 묘사 금지 (드레스·코르셋·아내 등 여성 전용 복장·호칭·신체 묘사 금지, 설정에 명시된 경우 제외)"
          : "남성으로 묘사 금지 (남편 등 남성 전용 호칭·신체 묘사 금지, 설정에 명시된 경우 제외)"
      }.`
    );
  }
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

/** @deprecated alias — use formatPublicPersonaForPrompt */
export const formatPersonaIdentityForBackground = formatSelectedPersonaIdentityForBackground;

/** Novel / explicit full co-narration only — separate from [USER_PERSONA]. */
export function formatPrivatePersonaSecretForNovelNarration(
  secretDescription: string
): string | null {
  const items = splitPersonaSecretItems(secretDescription);
  if (items.length === 0) return null;
  const body = items.map((i) => i.normalizedText).join("\n\n");
  return `[PRIVATE USER PERSONA SECRET — B NARRATION ONLY]
For co-narrating [B] only. NOT [A] or NPC knowledge unless revealed in-scene.
Do not disclose or infer these as [A] knowledge in interactive dialogue.

${body}`;
}
