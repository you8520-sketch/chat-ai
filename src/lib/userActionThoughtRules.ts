import type { CharacterChunk } from "@/types";
import { collectCharacterSettingText } from "@/lib/bodyHairRules";
import { buildUserInputParsingBlock } from "@/lib/webnovelOutputFormat";
import {
  parseUserMessageParts,
  promptTextForUserPart,
  type UserMessagePart,
  type UserMessagePartKind,
} from "@/lib/userMessageParse";

export type { UserMessagePart, UserMessagePartKind } from "@/lib/userMessageParse";
export { parseUserMessageParts } from "@/lib/userMessageParse";

/** 캐릭터 설정에 생각·마음 읽기/텔레파시 능력이 명시됐는지 */
const MIND_READING_IN_SETTING =
  /생각(?:을|을\s*)?읽|마음(?:을|을\s*)?읽|속마음(?:을|을\s*)?읽|심(?:리|독|통)|텔레파시|telepathy|mind\s*read(?:ing)?|thought\s*read(?:ing)?|read\s*(?:their|your|user'?s?|others?)?\s*thoughts?|정신\s*감응|독심(?:술)?|thought\s*perception|psychic\s*read/i;

export function settingHasMindReadingAbility(settingText: string): boolean {
  return MIND_READING_IN_SETTING.test(settingText);
}

export function settingHasMindReadingFromChunks(chunks: CharacterChunk[]): boolean {
  return settingHasMindReadingAbility(collectCharacterSettingText(chunks));
}

export function hasActionOrThoughtParts(text: string): boolean {
  return parseUserMessageParts(text).some((p) => p.kind !== "dialogue");
}

function labelForPart(kind: UserMessagePartKind, hasMindReading: boolean): string {
  switch (kind) {
    case "dialogue":
      return "[유저 대사]";
    case "action":
      return "[유저 지문/행동 — 캐릭터가 관찰 가능]";
    case "thought":
      return hasMindReading
        ? "[유저 속마음 — ( ) 안 · 텔레파시·마음읽기로만 인지 가능]"
        : "[유저 속마음 — ( ) 안 · 캐릭터는 인지 불가]";
  }
}

/** AI 프롬프트용 — 대사·지문·생각 구간을 라벨 섹션으로 변환 */
export function formatUserMessageForPrompt(text: string, hasMindReading: boolean): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const parts = parseUserMessageParts(trimmed);
  if (parts.length === 0) return trimmed;
  if (parts.length === 1 && parts[0].kind === "dialogue") return trimmed;

  const blocks: string[] = [];
  for (const part of parts) {
    blocks.push(`${labelForPart(part.kind, hasMindReading)}\n${promptTextForUserPart(part)}`);
  }
  return blocks.join("\n\n");
}

/** @deprecated buildUserInputParsingBlock() — 출력 규칙과 분리된 입력 해석 전용 */
export function buildUserActionThoughtRule(hasMindReading: boolean): string {
  return buildUserInputParsingBlock(hasMindReading);
}
