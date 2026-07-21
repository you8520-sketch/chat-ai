import {
  applyProfilePlaceholders,
  resolveCharacterDisplayName,
  resolvePersonaDisplayName,
} from "@/lib/userPlaceholder";

export type StatusWidgetProfileNames = {
  characterName?: string | null;
  /** 페르소나 표시명 (없으면 fallbackNickname) */
  personaName?: string | null;
  fallbackNickname?: string | null;
};

/** HTML·지시문·라벨의 {{char}} / {{user}} → 캐릭터명 / 유저(페르소나)명 */
export function expandStatusWidgetProfilePlaceholders(
  text: string,
  names?: StatusWidgetProfileNames | null
): string {
  if (!text) return text;
  const characterDisplayName = resolveCharacterDisplayName(names?.characterName);
  const viewerDisplayName = resolvePersonaDisplayName(
    names?.personaName,
    names?.fallbackNickname ?? ""
  );
  // 추출 모델이 통째로 NPC/PC/플레이스홀더만 넣은 경우도 실명으로
  const trimmed = text.trim();
  if (/^(?:NPC|\{\{\s*char\s*\}\})$/i.test(trimmed)) return characterDisplayName;
  if (/^(?:PC|\{\{\s*user\s*\}\})$/i.test(trimmed)) return viewerDisplayName;
  return applyProfilePlaceholders(text, {
    characterDisplayName,
    viewerDisplayName,
  });
}
