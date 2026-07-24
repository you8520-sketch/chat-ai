import {
  GENDER_LABELS,
  type CharacterGender,
} from "@/lib/characterGender";

function genderedReferenceRule(gender: CharacterGender): string {
  if (gender === "male") {
    return `지문에서 [B]를 가리킬 때 **${GENDER_LABELS[gender]}**에 맞는 "그", "그는", "그가", "그를", "그의"를 필요할 때 사용할 수 있다. 반대 성별 대명사 "그녀"와 여성으로 오인시키는 신체·호칭은 금지한다.`;
  }
  if (gender === "female") {
    return `지문에서 [B]를 가리킬 때 **${GENDER_LABELS[gender]}**에 맞는 "그녀", "그녀는", "그녀가", "그녀를", "그녀의"를 필요할 때 사용할 수 있다. 반대 성별 대명사 "그"를 남성 지칭으로 사용하거나 남성으로 오인시키는 신체·호칭은 금지한다.`;
  }
  return `성별이 기타이므로 [B]의 이름, 페르소나 설정에 명시된 대명사·호칭, 자연스러운 주어 생략을 우선한다. 설정에 없는 "그/그녀"를 임의로 고정하지 않는다.`;
}

/**
 * Single current-turn owner for referring to the selected user persona.
 * This controls wording only; it never grants permission to narrate the user.
 */
export function buildUserPersonaReferencePrompt(
  personaName: string,
  gender: CharacterGender
): string {
  const name = personaName.trim() || "유저 페르소나";

  return `[USER PERSONA REFERENCE OWNER — CURRENT TURN]
[B]는 AI 담당 캐릭터가 아니라 사용자가 선택한 페르소나다.
이름/호칭: ${name}. 확정 성별: ${GENDER_LABELS[gender]}. 이 성별을 모든 지문·외형·신체·호칭에서 유지한다.
${genderedReferenceRule(gender)}
지문에서 [B]는 "${name}", 성별에 맞는 대명사, 이미 확립된 관계 호칭, 문맥상 자연스러운 주어 생략을 상황에 맞게 사용한다. 한국어에서 불필요한 대명사를 억지로 넣거나 같은 표현을 문장마다 반복하지 말고, 지칭 대상이 모호해지면 "${name}"으로 되돌아간다.
"상대", "상대방", "유저", "사용자"를 [B]의 이름 대신 반복하는 기본 호칭으로 쓰지 않는다. 해당 단어가 일반적인 관계 의미로 꼭 필요한 문맥에서만 제한적으로 허용한다.
대사 안에서 [B]를 부르는 호칭은 캐릭터 말투·관계·Speech Lock·확립된 애칭을 그대로 따른다. 이 규칙은 Narrative POV, co-narration, Novel Mode, No Godmodding 또는 유저 조종 권한을 변경하지 않는다.`;
}
