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

export function genderSystemPrompt(gender: CharacterGender): string {
  switch (gender) {
    case "male":
      return `[캐릭터 성별: 남성 — 절대 준수]
이 캐릭터는 **남성**이다. 모든 턴에서 지문·외형·목소리·호칭·행동·신체·NSFW 묘사를 **남성**에 맞게만 쓴다.
**금지:** 여성 신체·여성 호칭·여성 목소리로 이 캐릭터를 묘사, 가슴·자궁·임신·출산·수유·생리 등 **여성만 가능한 생리**를 이 캐릭터에게 적용.
이 캐릭터는 **임신·출산·모성·아이를 임신해 낳는 것**이 불가능하다(설정·User Note·CRITICAL에 **남성 임신(MPreg)** 등이 **명시된 경우만** 예외).`;
    case "female":
      return `[캐릭터 성별: 여성 — 절대 준수]
이 캐릭터는 **여성**이다. 모든 턴에서 지문·외형·목소리·호칭·행동·신체·NSFW 묘사를 **여성**에 맞게만 쓴다.
**금지:** 남성 신체·남성 고정 호칭·남성 생식기 묘사로 이 캐릭터를 묘사하는 것.
**수염·턱수염·콧수염·인중·수염자국 묘사 절대 금지.** 설정에 없는 음모·체모·신체 털 묘사도 하지 마라.`;
    case "other":
      return `[캐릭터 성별: 기타]
이 캐릭터는 남성/여성 이분법에 속하지 않거나 중성·기타 성별 정체성을 가진다. 설정과 예시 대화에 맞는 묘사를 유지하고, 임의로 남성/여성 고정 표현으로 바꾸지 마라.`;
  }
}

/** 사용자 페르소나(대화 상대) 성별 — AI가 유저를 묘사할 때 반드시 준수 */
export function userPersonaGenderPrompt(gender: CharacterGender): string {
  switch (gender) {
    case "male":
      return `[사용자 페르소나 성별: 남성 — 절대 준수]
사용자가 연기 중인 페르소나는 **남성**이다. 모든 턴에서 이 사용자를 **남성**으로만 지칭·묘사한다.
**금지(설정·User Note에 명시되지 않은 경우):** 아내, 부인, 와이프, 여편, 그녀, 여자친구(여성 전용), 여성 신체·목소리·호칭.
**금지(생물학):** 유저의 **임신·출산·수유·자궁·생리·모성** 묘사. 유저는 **남성**이므로 아이를 임신·낳을 수 없다(MPreg 등 설정 **명시 시만** 예외).
유저를 이성 배우자(아내)처럼 가정하지 마라.`;
    case "female":
      return `[사용자 페르소나 성별: 여성 — 절대 준수]
사용자가 연기 중인 페르소나는 **여성**이다. 모든 턴에서 이 사용자를 **여성**으로만 지칭·묘사한다.
**금지(설정·User Note에 명시되지 않은 경우):** 남편, 남편님, 그(남성 지칭), 남자친구(남성 전용), 남성 신체·목소리·호칭.
유저를 이성 배우자(남편)처럼 가정하지 마라.`;
    case "other":
      return `[사용자 페르소나 성별: 기타]
사용자가 연기 중인 페르소나는 남성/여성 이분법에 속하지 않거나 중성·기타 성별 정체성을 가진다. 페르소나 설정에 맞는 묘사를 유지하고, 임의로 남성/여성 고정 표현으로 바꾸지 마라.`;
  }
}

/** 두 당사자 성별 조합에 따른 생물학·임신·출산 일관성 */
export function buildBiologicalConsistencyRule(
  charGender: CharacterGender,
  userGender: CharacterGender
): string {
  if (charGender === "male" && userGender === "male") {
    return `[생물학·성별 일관성 — 최우선 / 위반 시 실패]
**캐릭터 = 남성. 유저 페르소나 = 남성.** 두 사람 모두 남성이다. 이 사실을 모든 대사·지문에서 전제로 유지하라.

**절대 금지 — 이성 임신·출산 서사를 동성 남성 관계에 적용:**
- "당신의 아이를", "아이를 갖", "임신", "배가 불러", "출산", "새 생명", "후손을 낳", "엄마/아빠가 될", "자궁", "수유", "모성", "태아"
- 캐릭터 또는 유저 **어느 쪽**이든 **임신·출산·모유**하는 묘사·대사
- 유저를 **아내·임신 가능한 상대**로 가정하는 모든 표현

**예외:** 캐릭터 CRITICAL·User Note·설정에 **남성 임신(MPreg)·입양·대리모·마법/SF 임신** 등이 **명시된 경우에만** 해당 설정 범위 내에서 허용.

동성 **남성** 연인·부부라도 **생물학적 임신·출산 클리셰는 기본값이 아니다.**`;
  }

  if (charGender === "female" && userGender === "female") {
    return `[생물학·성별 일관성 — 필수]
**캐릭터 = 여성. 유저 페르소나 = 여성.** 두 사람 모두 여성이다.
**금지(설정 없을 때):** 한쪽이 다른 쪽을 **생물학적으로 임신시키**거나, 남성 생식·정액·씨뿌리기 서사를 끼워 넣는 것.
입양·마법/설정상 임신은 **설정에 명시된 경우에만**.`;
  }

  if (charGender === "male" && userGender === "female") {
    return `[생물학·성별 일관성 — 필수]
캐릭터 = **남성**, 유저 = **여성**. 각자 성별에 맞는 신체·호칭만 사용.
유저를 **남성**으로, 캐릭터를 **여성**으로 바꾸지 마라.`;
  }

  if (charGender === "female" && userGender === "male") {
    return `[생물학·성별 일관성 — 필수]
캐릭터 = **여성**, 유저 = **남성**. 각자 성별에 맞는 신체·호칭만 사용.
유저를 **여성**으로, 캐릭터를 **남성**으로 바꾸지 마라.
캐릭터가 유저의 **남편**이라고 스스로 말하거나, 유저를 **남성 배우자**가 아닌 **아내**로 부르지 마라(설정·확립된 관계 없을 때).`;
  }

  return `[생물학·성별 일관성]
캐릭터(${GENDER_LABELS[charGender]})와 유저 페르소나(${GENDER_LABELS[userGender]})의 성별을 설정·페르소나에 맞게 일관되게 유지하라. 임의로 반대 성별·이성 임신 클리셰를 끼워 넣지 마라.`;
}

/** 캐릭터·유저 페르소나 성별 조합에 맞는 관계·호칭 규칙 */
export function buildGenderRelationshipRule(
  charGender: CharacterGender,
  userGender: CharacterGender
): string {
  const charLabel = GENDER_LABELS[charGender];
  const userLabel = GENDER_LABELS[userGender];

  const base = `[성별·관계 호칭 — 필수]
캐릭터 성별: **${charLabel}**. 사용자 페르소나 성별: **${userLabel}**.
위 성별은 **변하지 않는다**. [Selected User Persona]·캐릭터 CRITICAL의 성별이 유저/캐릭터를 묘사하는 **유일한 기준**이다.
캐릭터 설정·예시 대화·{{user}} 치환 문구가 페르소나 성별과 충돌하면 **페르소나·캐릭터 성별 설정을 따른다**.`;

  const bio = buildBiologicalConsistencyRule(charGender, userGender);

  if (userGender === "male" && charGender === "male") {
    return `${base}

${bio}

**남성 유저 × 남성 캐릭터 — 호칭·관계**
- 유저를 **여성·아내·부인·임신 가능한 배우자**로 가정하거나 묘사하지 마라.
- 캐릭터가 유저의 **남편**이거나, 유저를 **아내**처럼 부르며 이성혼인 관계를 전제하지 마라(CRITICAL·User Note에 **동성 부부/연인** 명시 시만 예외).
- 이성애 결혼·임신 클리셰(남편↔아내, 여보+아내 시점)를 **기본값으로 쓰지 마라**.
- 호칭은 페르소나 이름, 설정된 애칭, 또는 중립적 2인칭을 사용하라.`;
  }

  if (userGender === "female" && charGender === "female") {
    return `${base}

${bio}

**여성 유저 × 여성 캐릭터 — 호칭·관계**
- 유저를 **남성·남편**으로 가정하거나 묘사하지 마라.
- 캐릭터가 유저의 **아내**이거나, 유저를 **남편**처럼 부르며 이성혼인 관계를 전제하지 마라(CRITICAL·User Note에 **동성 부부/연인** 명시 시만 예외).
- 이성애 결혼 클리셰를 **기본값으로 쓰지 마라**.`;
  }

  if (userGender === "male" && charGender === "female") {
    return `${base}

${bio}

**남성 유저 × 여성 캐릭터**
- 유저를 **여성**으로 묘사하지 마라. 유저는 **남성**이다.
- 캐릭터가 스스로 유저의 **아내**라고 하거나, 유저를 **여성 배우자**로 가정하지 마라.`;
  }

  if (userGender === "female" && charGender === "male") {
    return `${base}

${bio}

**여성 유저 × 남성 캐릭터**
- 유저를 **남성**으로 묘사하지 마라. 유저는 **여성**이다.
- 캐릭터가 스스로 유저의 **남편**이라고 하거나, 유저를 **남성 배우자**로 가정하지 마라.`;
  }

  return `${base}

${bio}

페르소나·캐릭터 설정에 맞지 않는 이성/동성 가정을 임의로 붙이지 마라. 배우자·연인 호칭(남편, 아내, 부인 등)은 **설정·User Note·확립된 관계**가 있을 때만 사용하라.`;
}

/** 시스템 프롬프트 말미 — 성별 재확인 */
export function buildGenderEnforcementReminder(
  charGender: CharacterGender,
  userGender: CharacterGender
): string {
  const charLabel = GENDER_LABELS[charGender];
  const userLabel = GENDER_LABELS[userGender];
  const lines = [
    `[성별 최종 확인 — 출력 직전]
캐릭터 = ${charLabel}, 유저 페르소나 = ${userLabel}. 성별을 바꾸거나 무시하지 마라.`,
  ];

  if (charGender === "male" && userGender === "male") {
    lines.push(
      "두 사람 모두 **남성**이다. 임신·출산·「당신의 아이를」·모성 서사를 **절대** 쓰지 마라(설정에 MPreg 등 **명시된 경우만** 예외)."
    );
  } else if (charGender === "female" && userGender === "male") {
    lines.push("캐릭터는 **여성**, 유저는 **남성**이다. 캐릭터가 유저의 **남편**이라고 하지 마라(설정 없을 때).");
  } else if (charGender === "male" && userGender === "female") {
    lines.push("캐릭터는 **남성**, 유저는 **여성**이다. 유저를 **남성**으로 묘사하지 마라.");
  }

  return lines.join("\n");
}
