/** Minimal committed sentences for deterministic ownership shadow detector v2 tests. */

export type OwnershipFixtureLabel =
  | "CLEAR_B_DIALOGUE"
  | "CLEAR_B_THOUGHT"
  | "CLEAR_B_DECISION"
  | "CLEAR_B_EMOTION"
  | "CLEAR_B_VOLUNTARY_ACTION"
  | "CLEAR_B_POSITION_POSTURE"
  | "CLEAR_B_PERCEPTION_SENSORY"
  | "CLEAR_B_MEDICAL_PHYSICAL_STATE"
  | "CLEAR_B_EXPRESSION_REACTION"
  | "CLEAR_B_UNSTATED_PREFERENCE"
  | "SAFE_A_TO_B_PHYSICAL_INTERACTION"
  | "SAFE_A_TO_B_PHYSICAL_CONSEQUENCE"
  | "SAFE_EXTERNAL_OBSERVATION"
  | "SAFE_CURRENT_USER_INPUT_GROUNDED"
  | "SAFE_USER_AUTHORED_HISTORY_GROUNDED"
  | "SOFT_AMBIGUOUS";

export type OwnershipFixtureEntry = {
  id: string;
  text: string;
  expectedCategory: OwnershipFixtureLabel;
  expectedSeverity: "HARD" | "SOFT" | "NONE";
  userAlias?: string;
  actorNames?: string[];
  currentUserInput?: string;
  userAuthoredHistory?: string[];
};

export const OWNERSHIP_SHADOW_KNOWN_HARD_VIOLATIONS: OwnershipFixtureEntry[] = [
  {
    id: "hard-position-1",
    text: "렌이 문 앞에 서서 등을 기대고 있었다.",
    expectedCategory: "CLEAR_B_POSITION_POSTURE",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["이준서"],
  },
  {
    id: "hard-position-2",
    text: "렌은 여전히 문가에 서 있었다.",
    expectedCategory: "CLEAR_B_POSITION_POSTURE",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["이준서"],
  },
  {
    id: "hard-position-3",
    text: "렌의 어깨와 몇 센티미터 떨어져 있었다.",
    expectedCategory: "CLEAR_B_POSITION_POSTURE",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["카일"],
  },
  {
    id: "hard-position-4",
    text: "렌의 뒷머리는 소파 등받이에 닿아 있었다.",
    expectedCategory: "CLEAR_B_POSITION_POSTURE",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["이준서"],
  },
  {
    id: "hard-voluntary-1",
    text: "렌은 시선을 따라가지 않았다.",
    expectedCategory: "CLEAR_B_VOLUNTARY_ACTION",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
  {
    id: "hard-voluntary-2",
    text: "렌은 가만히 서서 듣고 있었다.",
    expectedCategory: "CLEAR_B_VOLUNTARY_ACTION",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["이준서"],
  },
  {
    id: "hard-voluntary-3",
    text: "렌은 아무 말도 하지 않았다.",
    expectedCategory: "CLEAR_B_VOLUNTARY_ACTION",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["이준서"],
  },
  {
    id: "hard-voluntary-4",
    text: "렌도 함께 물러났다.",
    expectedCategory: "CLEAR_B_VOLUNTARY_ACTION",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
  {
    id: "hard-perception-1",
    text: "렌이 그 목소리를 들었다.",
    expectedCategory: "CLEAR_B_PERCEPTION_SENSORY",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
  {
    id: "hard-perception-2",
    text: "렌의 머릿속에서 목소리가 울렸다.",
    expectedCategory: "CLEAR_B_PERCEPTION_SENSORY",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
  {
    id: "hard-medical-1",
    text: "렌은 브레인 포드 초기 감염 상태였다.",
    expectedCategory: "CLEAR_B_MEDICAL_PHYSICAL_STATE",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
  {
    id: "hard-medical-2",
    text: "렌의 맥박은 안정적이었다.",
    expectedCategory: "CLEAR_B_MEDICAL_PHYSICAL_STATE",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
  {
    id: "hard-medical-3",
    text: "렌의 숨소리는 안정적이었다.",
    expectedCategory: "CLEAR_B_MEDICAL_PHYSICAL_STATE",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
  {
    id: "hard-emotion-1",
    text: "렌은 겁먹지 않았다.",
    expectedCategory: "CLEAR_B_EMOTION",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
  {
    id: "hard-emotion-2",
    text: "렌은 한강을 싫어하지 않았다.",
    expectedCategory: "CLEAR_B_UNSTATED_PREFERENCE",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["이준서"],
  },
  {
    id: "hard-expression-1",
    text: "렌의 눈동자 속에서 작은 빛이 움직였다.",
    expectedCategory: "CLEAR_B_EXPRESSION_REACTION",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["이준서"],
  },
  {
    id: "hard-expression-2",
    text: "렌은 받아들일 준비가 된 얼굴이었다.",
    expectedCategory: "CLEAR_B_EXPRESSION_REACTION",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["이준서"],
  },
  {
    id: "hard-sustained-after-push",
    text: "렌은 에녹의 뒤에 서 있었다.",
    expectedCategory: "CLEAR_B_POSITION_POSTURE",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
];

export const OWNERSHIP_SHADOW_KNOWN_SAFE_INTERACTIONS: OwnershipFixtureEntry[] = [
  {
    id: "safe-a-to-b-1",
    text: "에녹이 렌의 손목을 잡았다.",
    expectedCategory: "SAFE_A_TO_B_PHYSICAL_INTERACTION",
    expectedSeverity: "NONE",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
  {
    id: "safe-a-to-b-2",
    text: "에녹이 렌의 팔을 잡아당겼다.",
    expectedCategory: "SAFE_A_TO_B_PHYSICAL_INTERACTION",
    expectedSeverity: "NONE",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
  {
    id: "safe-a-to-b-3",
    text: "에녹이 렌을 자신의 뒤쪽으로 밀었다.",
    expectedCategory: "SAFE_A_TO_B_PHYSICAL_INTERACTION",
    expectedSeverity: "NONE",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
  {
    id: "safe-a-to-b-4",
    text: "이준서가 렌이 앉을 공간을 비웠다.",
    expectedCategory: "SAFE_A_TO_B_PHYSICAL_INTERACTION",
    expectedSeverity: "NONE",
    userAlias: "렌",
    actorNames: ["이준서"],
  },
  {
    id: "safe-a-to-b-5",
    text: "카일이 렌의 얼굴을 바라보았다.",
    expectedCategory: "SAFE_A_TO_B_PHYSICAL_INTERACTION",
    expectedSeverity: "NONE",
    userAlias: "렌",
    actorNames: ["카일"],
  },
  {
    id: "safe-a-to-b-6",
    text: "에녹이 렌에게 오른쪽으로 움직이라고 명령했다.",
    expectedCategory: "SAFE_A_TO_B_PHYSICAL_INTERACTION",
    expectedSeverity: "NONE",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
  {
    id: "safe-consequence-1",
    text: "에녹이 렌의 가슴을 밀었고, 그 힘에 렌의 몸이 반 걸음 밀려났다.",
    expectedCategory: "SAFE_A_TO_B_PHYSICAL_CONSEQUENCE",
    expectedSeverity: "NONE",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
  {
    id: "safe-consequence-2",
    text: "렌의 몸이 그 힘에 밀려 반 걸음 뒤로 물러났다.",
    expectedCategory: "SAFE_A_TO_B_PHYSICAL_CONSEQUENCE",
    expectedSeverity: "NONE",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
];

export const OWNERSHIP_SHADOW_SMOKE_REGRESSION: OwnershipFixtureEntry[] = [
  {
    id: "smoke-consolidated-call3-position",
    text: "렌이 문 앞에 서서 등을 기대고 있었다.",
    expectedCategory: "CLEAR_B_POSITION_POSTURE",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["이준서"],
  },
  {
    id: "smoke-consolidated-call2-perception",
    text: "렌이 방금 들은 그 목소리.",
    expectedCategory: "CLEAR_B_PERCEPTION_SENSORY",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
  {
    id: "smoke-consolidated-call2-consequence",
    text: "렌의 몸이 그 힘에 밀려 반 걸음 뒤로 물러났다.",
    expectedCategory: "SAFE_A_TO_B_PHYSICAL_CONSEQUENCE",
    expectedSeverity: "NONE",
    userAlias: "렌",
    actorNames: ["에녹"],
  },
  {
    id: "smoke-clean-call3-voluntary",
    text: "거울 속 렌은 가만히 서서 듣고 있었다.",
    expectedCategory: "CLEAR_B_VOLUNTARY_ACTION",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["이준서"],
  },
];

export const OWNERSHIP_SHADOW_GROUNDING_FIXTURES: OwnershipFixtureEntry[] = [
  {
    id: "grounded-current-input",
    text: "렌은 문 앞에 서 있었다.",
    expectedCategory: "SAFE_CURRENT_USER_INPUT_GROUNDED",
    expectedSeverity: "NONE",
    userAlias: "렌",
    actorNames: ["이준서"],
    currentUserInput: "나는 문 앞에 서 있어.",
  },
  {
    id: "grounded-user-history",
    text: "렌은 손목을 감싸 쥐고 있었다.",
    expectedCategory: "SAFE_USER_AUTHORED_HISTORY_GROUNDED",
    expectedSeverity: "NONE",
    userAlias: "렌",
    actorNames: ["이준서"],
    userAuthoredHistory: ["*손목을 감싸 쥔다.*"],
  },
  {
    id: "not-grounded-assistant-history",
    text: "렌은 여전히 문가에 서 있었다.",
    expectedCategory: "CLEAR_B_POSITION_POSTURE",
    expectedSeverity: "HARD",
    userAlias: "렌",
    actorNames: ["이준서"],
  },
];

export const OWNERSHIP_SHADOW_ALIAS_FIXTURES: OwnershipFixtureEntry[] = [
  {
    id: "alias-b-token-dialogue",
    text: '[B]는 말했다. "그래."',
    expectedCategory: "CLEAR_B_DIALOGUE",
    expectedSeverity: "HARD",
    userAlias: "민수",
    actorNames: ["캐릭터"],
  },
  {
    id: "alias-custom-name",
    text: "민수는 생각했다. 이건 내 선택이다.",
    expectedCategory: "CLEAR_B_THOUGHT",
    expectedSeverity: "HARD",
    userAlias: "민수",
    actorNames: ["캐릭터"],
  },
  {
    id: "alias-particle-ege",
    text: "캐릭터가 민수에게 다가갔다.",
    expectedCategory: "SAFE_A_TO_B_PHYSICAL_INTERACTION",
    expectedSeverity: "NONE",
    userAlias: "민수",
    actorNames: ["캐릭터"],
  },
];

export const OWNERSHIP_SHADOW_ALL_FIXTURES: OwnershipFixtureEntry[] = [
  ...OWNERSHIP_SHADOW_KNOWN_HARD_VIOLATIONS,
  ...OWNERSHIP_SHADOW_KNOWN_SAFE_INTERACTIONS,
  ...OWNERSHIP_SHADOW_SMOKE_REGRESSION,
  ...OWNERSHIP_SHADOW_GROUNDING_FIXTURES,
  ...OWNERSHIP_SHADOW_ALIAS_FIXTURES,
];
