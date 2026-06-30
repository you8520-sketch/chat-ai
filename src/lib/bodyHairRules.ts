import type { CharacterGender } from "./characterGender";
import type { CharacterChunk } from "@/types";

/** 설정에 수염·턱수염 등이 명시됐는지 */
const BEARD_IN_SETTING =
  /수염|턱수염|콧수염|인중(?:수염)?|full\s*beard|beard|goatee|mustache|stubble|whiskers/i;

/** 설정에 음모·체모 등이 명시됐는지 (거의 항상 false → 기본 금지) */
const BODY_HAIR_IN_SETTING =
  /음모|체모|겨드랑이\s*털|다리\s*털|pubic|body\s*hair|陰毛|体毛|성기\s*(?:주변|周).*털|휘파람\s*털/i;

/** 출력에서 제거할 수염 묘사 (문장 단위) — bare "인중"(입술/비인중)은 제외 */
const BEARD_IN_OUTPUT =
  /수염|턱수염|콧수염|인중수염|수염자국|면도(?:하지|안)\s*(?:않|한)|(?:거친|깔?끔(?:히)?)\s*(?:면도|턱)|(?:자라(?:난|는))\s*수염|수염이\s*(?:난|자라|덮)/;

/** 출력에서 제거할 음모·체모 묘사 (문장 단위) — "털이 서리친 몸" 등 전율 표현은 제외 */
const BODY_HAIR_IN_OUTPUT =
  /음모|체모|겨드랑이(?:의|에)?\s*(?:털|잔털)|(?:사타구니|성기|음부|휘파람|인퀴덤)(?:.{0,12})?(?:털|잔털|체모)|(?:잔|거친|검은|부드러운)\s*털(?:이|이\s*(?:난|복|솟|돋|보)|(?:의|을))/;

export function collectCharacterSettingText(chunks: CharacterChunk[]): string {
  return chunks.map((c) => c.content).join("\n");
}

/** @deprecated import from @/lib/characterKnowledgeBoundary */
export { buildCharacterCanonBlock, buildStructuredCharacterCanonBlock } from "@/lib/characterKnowledgeBoundary";

export function settingAllowsBeardDescription(settingText: string): boolean {
  return BEARD_IN_SETTING.test(settingText);
}

export function settingAllowsBodyHairDescription(settingText: string): boolean {
  return BODY_HAIR_IN_SETTING.test(settingText);
}

export type HairDescriptionPolicy = {
  charGender: CharacterGender;
  userGender?: CharacterGender;
  allowsBeard: boolean;
  allowsBodyHair: boolean;
};

export function resolveHairDescriptionPolicy(
  charGender: CharacterGender,
  settingText: string,
  userGender?: CharacterGender
): HairDescriptionPolicy {
  return {
    charGender,
    userGender,
    allowsBeard: charGender === "female" ? false : settingAllowsBeardDescription(settingText),
    allowsBodyHair: settingAllowsBodyHairDescription(settingText),
  };
}

export function buildBodyHairDescriptionRule(policy: HairDescriptionPolicy): string {
  const lines = [
    `[수염·음모(체모) 묘사 — 필수]
롤플레잉에서 **설정에 없는 신체 털**을 임의로 추가하지 마라. 많은 이용자(특히 여성)가 수염·음모 묘사를 매우 싫어한다.`,
  ];

  if (policy.charGender === "female") {
    lines.push(
      "캐릭터는 **여성**이다. 캐릭터에게 수염·턱수염·콧수염·인중·수염자국·면도 흔적 묘사 **절대 금지**."
    );
  } else if (!policy.allowsBeard) {
    lines.push(
      "캐릭터 외형 설정에 **수염·턱수염·콧수염·인중이 없다**. 캐릭터의 수염·수염자국·면도 흔적 묘사 **금지**. 깔끔한 턱·입 주변만 서술하라."
    );
  }

  if (!policy.allowsBodyHair) {
    lines.push(
      `캐릭터·유저 페르소나 모두 **음모·체모·겨드랑이·인퀴덤·다리·복부·성기 주변 털** 등 신체 털 묘사 **전면 금지**.
설정·User Note·CRITICAL에 명시되지 않은 털은 **존재하지 않는 것**으로 간주하고, 지문·대사·NSFW 장면에서도 쓰지 마라.`
    );
  }

  if (policy.userGender === "female") {
    lines.push("유저 페르소나는 **여성**이다. 유저에게 수염·음모·체모 묘사 **절대 금지**.");
  }

  if (policy.allowsBeard) {
    lines.push("캐릭터 설정에 수염이 있으므로, **설정에 맞는 범위에서만** 수염을 묘사할 수 있다.");
  }
  if (policy.allowsBodyHair) {
    lines.push("설정에 체모/음모가 명시된 경우에만, **설정 범위 내에서만** 묘사하라.");
  }

  return lines.join("\n");
}

function findHairViolation(trimmed: string, policy: HairDescriptionPolicy): string | null {
  if (!policy.allowsBeard && BEARD_IN_OUTPUT.test(trimmed)) {
    return trimmed.match(BEARD_IN_OUTPUT)?.[0] ?? "beard";
  }
  if (!policy.allowsBodyHair && BODY_HAIR_IN_OUTPUT.test(trimmed)) {
    return trimmed.match(BODY_HAIR_IN_OUTPUT)?.[0] ?? "body-hair";
  }
  if (policy.charGender === "female" && BEARD_IN_OUTPUT.test(trimmed)) {
    return trimmed.match(BEARD_IN_OUTPUT)?.[0] ?? "beard-female-char";
  }
  if (policy.userGender === "female" && BEARD_IN_OUTPUT.test(trimmed)) {
    return trimmed.match(BEARD_IN_OUTPUT)?.[0] ?? "beard-female-user";
  }
  if (
    policy.userGender === "female" &&
    !policy.allowsBodyHair &&
    BODY_HAIR_IN_OUTPUT.test(trimmed)
  ) {
    return trimmed.match(BODY_HAIR_IN_OUTPUT)?.[0] ?? "body-hair-female-user";
  }
  return null;
}

/** AI 출력 후 안전망 — 해당 문장 제거 */
export function sanitizeHairDescriptions(text: string, policy: HairDescriptionPolicy): string {
  if (policy.allowsBeard && policy.allowsBodyHair) return text;

  const parts = text.split(/(?<=[.!?…])\s+|\n+/);
  const kept: string[] = [];
  const violations: string[] = [];
  let droppedChars = 0;

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const matchedText = findHairViolation(trimmed, policy);
    if (matchedText) {
      violations.push(matchedText);
      droppedChars += trimmed.length;
      continue;
    }

    kept.push(trimmed);
  }

  const result = kept.length === 0 ? text : kept.join("\n\n");
  const totalChars = text.length;
  const changedChars = kept.length === 0 ? 0 : droppedChars;
  const charsChangedRatio = totalChars > 0 ? changedChars / totalChars : 0;

  if (violations.length > 0) {
    const replacementScope: "full" | "partial" =
      kept.length === 0 || charsChangedRatio > 0.5 ? "full" : "partial";
    console.log("[hair-sanitize-diagnostic]", {
      violation_phrase: violations[0],
      violation_count: violations.length,
      replacement_scope: replacementScope,
      chars_changed_ratio: charsChangedRatio,
      ...(charsChangedRatio > 0.5 ? { flag_for_review: true } : {}),
    });
  }

  return result;
}
