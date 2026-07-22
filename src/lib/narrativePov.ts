export const NARRATIVE_POV_VALUES = ["third_person", "first_person"] as const;

export type NarrativePov = (typeof NARRATIVE_POV_VALUES)[number];

export type ResolvedNarrativePov = {
  mode: NarrativePov;
  povCharacterName: string;
};

export const DEFAULT_NARRATIVE_POV: NarrativePov = "third_person";

export function parseNarrativePov(value: unknown): NarrativePov {
  return value === "first_person" ? "first_person" : DEFAULT_NARRATIVE_POV;
}

/** Single server owner for room-level POV resolution. */
export function resolveNarrativePov(input: {
  mode: unknown;
  contentKind?: "character" | "simulation";
  mainCharacterName: string;
  povCharacterName?: unknown;
}): ResolvedNarrativePov {
  const requestedMode = parseNarrativePov(input.mode);
  const requestedName = String(input.povCharacterName ?? "").trim().slice(0, 80);
  const povCharacterName =
    input.contentKind === "simulation" ? requestedName : input.mainCharacterName.trim();

  // A simulation title is not a character. Never enable first person until an
  // actual cast member has been selected or entered for this room.
  const mode = requestedMode === "first_person" && !povCharacterName
    ? DEFAULT_NARRATIVE_POV
    : requestedMode;

  return { mode, povCharacterName };
}

export function buildNarrativePovPrompt(pov: ResolvedNarrativePov): string {
  if (pov.mode === "first_person") {
    return `[NARRATIVE POV OWNER: FIRST PERSON — POV CHARACTER: ${pov.povCharacterName}]
${pov.povCharacterName}의 제한적 1인칭 시점으로 현재 장면을 서술한다. ${pov.povCharacterName} 자신만 자연스러운 나/내 계열로 표현하되, 한국어 문맥상 주어는 자연스럽게 생략할 수 있다. 유저 호칭은 캐릭터의 말투·관계·Speech Lock을 그대로 따르며 너/당신 등으로 강제 치환하지 않는다. ${pov.povCharacterName}이 직접 보거나 듣거나 느끼거나 알고 있는 정보만 서술하고, 알 수 없는 타인의 내면이나 장면 밖 사건은 서술하지 않는다. 다른 인물은 3인칭으로 표현한다. 이 시점 규칙은 co-narration, Novel Mode, No Godmodding, Speech Lock의 권한과 규칙을 변경하지 않는다.`;
  }

  return `[NARRATIVE POV OWNER: THIRD PERSON]
현재 장면을 자연스러운 3인칭 소설형으로 서술한다. 여러 AI 캐릭터·NPC·환경 사이의 초점 전환은 기존 시뮬레이션 규칙을 그대로 따른다. 이 시점 규칙은 co-narration, Novel Mode, No Godmodding, Speech Lock의 권한과 규칙을 변경하지 않는다.`;
}
