import type { CharacterChunk } from "@/types";
import { collectCharacterSettingText } from "@/lib/bodyHairRules";
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

export function buildUserActionThoughtRule(hasMindReading: boolean): string {
  const lines = [
    `[유저 입력 — 대사·지문·속마음 구분 — 필수]
사용자 롤플레이 입력은 아래 규칙으로 구분된다. **괄호·별표 안은 절대 대사가 아니다.**`,
    `- 별표 * * 한 쌍: 유저 **지문**(서술·행동 묘사) — 대사·속마음 아님`,
    `- 괄호 ( ) · （ ） · [ ]: **대사 아님** — 내용에 따라 **행동 지문**(관찰 가능) 또는 **속마음**으로 자동 구분`,
    `- 괄호 없이 **-다/-했다/-하며/-하고** 등 서술형: **지문/행동**(관찰 가능)`,
    `- 그 외 구어체·말하기형: 유저 **대사** (큰따옴표 없이 입력해도 대사)`,
    `- "…": **대사**`,
    `- 「…」 · 『…』: **특수 고유명**(스킬명·기술명·주문명·시스템 표기) — 대사·속마음 아님`,
  ];

  if (hasMindReading) {
    lines.push(
      `캐릭터 설정에 **생각·마음 읽기·텔레파시** 능력이 있을 때만, ( ) 안 **속마음** 구간을 능력 범위 내에서 인지할 수 있다.
* * 지문과 ( ) 행동 지문은 관찰·서술로 반응하라. 속마음은 그대로 인용·되풀이하지 말고 능력에 맞게만 반영하라.`
    );
  } else {
    lines.push(
      `캐릭터에게 **생각·마음 읽기·텔레파시 능력이 없다** (설정에 없으면 없는 것).
( ) 안 **속마음**에 대해 아래를 **절대 금지**:
- 그 내용을 알고 있다고 서술·반응·대답
- "속으로 ~ 생각하는 게 보인다", "마음이 읽힌다" 등 추론으로 간파
- 유저 속마음을 인용·요약·되묻기

* * 지문 · ( ) 행동 지문 · 서술형 지문은 **관찰 가능**하므로 표정·몸짓·동작에 맞게 반응할 수 있다.
유저 **대사**만 말로 들은 것으로 처리하라.`
    );
  }

  return lines.join("\n");
}
