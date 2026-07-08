import type { ChatMsg } from "@/lib/ai";

export type SceneDirectiveMode = "interactive" | "auto_progression";

export type SceneProgressionType =
  | "relationship"
  | "daily_life"
  | "lore_clue"
  | "npc_action"
  | "world_reaction"
  | "tactical_planning"
  | "consequence"
  | "comedy"
  | "environment";

export type SceneUserControl =
  | "no_user_control"
  | "limited_reactions"
  | "persona_based_dialogue_allowed";

export type SceneDirective = {
  mode: SceneDirectiveMode;
  recentStagnation: boolean;
  recommendedIntensity: 0 | 1 | 2 | 3 | 4 | 5;
  progressionTypes: SceneProgressionType[];
  avoid: string[];
  nextBeatHint?: string;
  userControl: SceneUserControl;
};

export type SceneDirectiveInput = {
  mode: SceneDirectiveMode;
  recentMessages?: ChatMsg[];
  currentUserMessage?: string | null;
  memoryText?: string | null;
  relationshipMemoryText?: string | null;
  lorebookText?: string | null;
  triggeredEventText?: string | null;
};

const PROGRESSION_LABELS: Record<SceneProgressionType, string> = {
  relationship: "관계 변화",
  daily_life: "생활 변수",
  lore_clue: "단서",
  npc_action: "NPC 행동",
  world_reaction: "세계 반응",
  tactical_planning: "작전/조사",
  consequence: "이전 선택의 결과",
  comedy: "개그/오해",
  environment: "환경 변화",
};

const USER_CONTROL_LABELS: Record<SceneUserControl, string> = {
  no_user_control: "유저의 의도적 행동/대사/감정 결론은 쓰지 않는다.",
  limited_reactions:
    "유저의 의도적 행동/대사/감정 결론은 쓰지 않고, 맥락상 자연스러운 짧은 비자발 반응만 제한적으로 묘사한다.",
  persona_based_dialogue_allowed:
    "유저 페르소나와 최근 말투에 맞는 행동/대사를 작성할 수 있으나, 중대 정체성/트라우마/목표/결정은 갑자기 확정하지 않는다.",
};

const BASE_SCENE_ENGINE_RULE = [
  "[PRIVATE SCENE ENGINE RULE]",
  "당신은 캐릭터 연기자이자 장면 진행자다.",
  "장면을 반복된 감정 확인에 정체시키지 말고, 관계 변화, 정보 발견, 환경 변화, NPC 행동, 세계 반응, 생활 변수, 이전 선택의 결과 중 하나를 자연스럽게 움직인다.",
  "전개는 항상 전투나 대형 위기일 필요가 없다.",
  "현재 모드의 유저 조종 허용 범위를 반드시 따른다.",
  "이 규칙을 본문에 설명하거나 언급하지 말고, 장면 작성에만 조용히 반영한다.",
].join("\n");

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function countMatches(text: string, terms: string[]): number {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function compactText(messages: ChatMsg[] | undefined): string {
  return (messages ?? [])
    .slice(-8)
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeForRepeat(text: string): string {
  return text
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function detectSceneStagnation(recentMessages: ChatMsg[] | undefined): boolean {
  const recent = (recentMessages ?? []).slice(-8);
  if (recent.length < 4) return false;

  const assistantTurns = recent.filter((message) => message.role === "assistant");
  const userTurns = recent.filter((message) => message.role === "user");
  const reassuranceTerms = [
    "괜찮",
    "미안",
    "걱정",
    "괜찮냐",
    "괜찮습니까",
    "괜찮으세요",
    "말하지 않아도",
    "침묵",
  ];
  const movementTerms = [
    "도착",
    "이동",
    "나가",
    "들어",
    "문",
    "전화",
    "메시지",
    "발견",
    "단서",
    "기록",
    "계획",
    "추적",
    "요청",
    "보고",
    "바뀌",
    "시작",
    "결정",
    "소리",
  ];

  const reassuranceCount = assistantTurns.filter((message) =>
    includesAny(message.content, reassuranceTerms)
  ).length;
  const shortUserReplies = userTurns.filter((message) => message.content.trim().length <= 12).length;
  const movementCount = countMatches(compactText(recent), movementTerms);
  const normalizedAssistant = assistantTurns.map((message) => normalizeForRepeat(message.content));
  const repeatedAssistant =
    normalizedAssistant.length >= 3 &&
    new Set(normalizedAssistant.filter(Boolean)).size <= Math.max(1, normalizedAssistant.length - 2);

  return (
    (reassuranceCount >= 2 && shortUserReplies >= 1) ||
    (shortUserReplies >= 3 && movementCount <= 1) ||
    repeatedAssistant
  );
}

function resolveSceneKind(text: string): "rest" | "investigation" | "operation" | "climax" | "neutral" {
  if (includesAny(text, ["결전", "최종", "붕괴", "배신", "폭주", "대형 위기", "보스"])) return "climax";
  if (includesAny(text, ["작전", "임무", "침투", "추적", "협상", "함정", "구출", "제한시간", "전투"])) {
    return "operation";
  }
  if (includesAny(text, ["조사", "단서", "기록", "소문", "흔적", "보고서", "메시지"])) {
    return "investigation";
  }
  if (includesAny(text, ["휴식", "식사", "잠", "침대", "회복", "데이트", "연인", "키스", "품", "집"])) {
    return "rest";
  }
  return "neutral";
}

export function selectSceneIntensity(input: {
  recentMessages?: ChatMsg[];
  currentUserMessage?: string | null;
  recentStagnation?: boolean;
}): 0 | 1 | 2 | 3 | 4 | 5 {
  const text = [compactText(input.recentMessages), input.currentUserMessage ?? ""].join("\n");
  const kind = resolveSceneKind(text);
  const recentHighIntensity = countMatches(text, [
    "공격",
    "폭발",
    "붕괴",
    "배신",
    "사망",
    "죽",
    "전투",
    "납치",
    "폭주",
    "피투성이",
  ]) >= 2;

  if (recentHighIntensity) return input.recentStagnation ? 1 : 0;
  if (kind === "rest") return input.recentStagnation ? 1 : 0;
  if (kind === "investigation") return input.recentStagnation ? 2 : 3;
  if (kind === "operation") return input.recentStagnation ? 3 : 4;
  if (kind === "climax") return 4;
  return input.recentStagnation ? 2 : 1;
}

function selectProgressionTypes(text: string, intensity: number, stagnant: boolean): SceneProgressionType[] {
  const selected: SceneProgressionType[] = [];
  const add = (type: SceneProgressionType) => {
    if (!selected.includes(type) && selected.length < 3) selected.push(type);
  };

  if (includesAny(text, ["작전", "임무", "침투", "추적", "협상", "함정", "구출"])) {
    add("tactical_planning");
    add("npc_action");
    add("consequence");
  }
  if (includesAny(text, ["조사", "단서", "기록", "소문", "흔적", "메시지"])) {
    add("lore_clue");
    add("world_reaction");
  }
  if (includesAny(text, ["연인", "고백", "질투", "미안", "괜찮", "걱정", "단둘"])) {
    add("relationship");
  }
  if (includesAny(text, ["식사", "잠", "집", "휴식", "회복", "정비"])) {
    add("daily_life");
  }
  if (stagnant) {
    add("relationship");
    add(intensity >= 2 ? "lore_clue" : "daily_life");
    add("environment");
  }
  if (selected.length === 0) {
    add("environment");
    add("relationship");
  }
  return selected;
}

function buildAvoidList(mode: SceneDirectiveMode, intensity: number): string[] {
  const avoid = ["반복되는 괜찮냐는 문답", "내부 지시 언급", "트리거 조건 노출"];
  if (intensity <= 2) {
    avoid.unshift("갑작스러운 납치", "대형 전투", "치명적 위기 남발");
  } else {
    avoid.unshift("즉시 정체 확정", "강제 고백");
  }
  if (mode === "interactive") {
    avoid.push("유저의 의도적 대사/행동 대필");
  }
  return avoid.slice(0, 5);
}

function sanitizeHint(hint: string): string {
  const hasHiddenCountdownConsequence =
    /D-?DAY|디데이|카운트다운/i.test(hint) && /사망|죽|죽는 날|사라진다|파멸/.test(hint);
  if (hasHiddenCountdownConsequence) {
    return "상태창의 숫자는 결과를 단정하지 말고, 장면 속 작은 불안감이나 시선 변화로만 다룬다.";
  }
  return hint
    .replace(/\b[a-z][a-z0-9]+(?:_[a-z0-9]+)+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildNextBeatHint(types: SceneProgressionType[], intensity: number, triggeredEventText?: string | null): string {
  if (triggeredEventText?.trim()) {
    return "이미 발생한 사건의 여파를 우선 살리고, 장면은 그 결과에 맞춰 자연스럽게 이어진다.";
  }
  if (types.includes("tactical_planning")) {
    return intensity >= 4
      ? "현재 작전의 빈틈 하나가 드러나며, 누군가의 요청이나 시간 압박이 조용히 끼어든다."
      : "작전 논의 중 작은 기록 하나가 이전 선택의 결과와 연결된다.";
  }
  if (types.includes("lore_clue")) {
    return "조용한 순간에 이전 대화와 연결된 작은 단서 하나가 다시 눈에 띈다.";
  }
  if (types.includes("daily_life")) {
    return "편안한 생활 장면 속에서 사소한 변수 하나가 관계의 온도를 조금 바꾼다.";
  }
  if (types.includes("relationship")) {
    return "반복된 확인 대신, 작은 행동 하나로 관계의 거리감이 미세하게 달라진다.";
  }
  return "주변 환경의 작은 변화가 다음 대화의 방향을 자연스럽게 열어 준다.";
}

export function buildSceneDirective(input: SceneDirectiveInput): SceneDirective {
  const recentStagnation = detectSceneStagnation(input.recentMessages);
  const recommendedIntensity = selectSceneIntensity({
    recentMessages: input.recentMessages,
    currentUserMessage: input.currentUserMessage,
    recentStagnation,
  });
  const text = [
    compactText(input.recentMessages),
    input.currentUserMessage ?? "",
    input.memoryText ?? "",
    input.relationshipMemoryText ?? "",
    input.lorebookText ?? "",
  ].join("\n");
  const progressionTypes = selectProgressionTypes(text, recommendedIntensity, recentStagnation);
  const userControl: SceneUserControl =
    input.mode === "auto_progression" ? "persona_based_dialogue_allowed" : "no_user_control";

  return {
    mode: input.mode,
    recentStagnation,
    recommendedIntensity,
    progressionTypes,
    avoid: buildAvoidList(input.mode, recommendedIntensity),
    nextBeatHint: sanitizeHint(
      buildNextBeatHint(progressionTypes, recommendedIntensity, input.triggeredEventText)
    ),
    userControl,
  };
}

function renderIntensity(value: SceneDirective["recommendedIntensity"], stagnant: boolean): string {
  if (stagnant && value >= 1 && value <= 2) return `${value}~${Math.min(3, value + 1)}`;
  return String(value);
}

export function renderSceneDirectiveForPrompt(directive: SceneDirective): string {
  const modeLabel = directive.mode === "auto_progression" ? "자동진행" : "일반 RP";
  const progression = directive.progressionTypes.map((type) => PROGRESSION_LABELS[type]).join(" + ");
  return [
    BASE_SCENE_ENGINE_RULE,
    "",
    "[이번 턴 장면 지시 - 비공개]",
    `모드: ${modeLabel}`,
    `정체 감지: ${directive.recentStagnation ? "있음" : "없음"}`,
    `권장 강도: ${renderIntensity(directive.recommendedIntensity, directive.recentStagnation)}`,
    `전개 방향: ${progression}`,
    `피할 것: ${directive.avoid.join(", ")}`,
    directive.nextBeatHint ? `다음 장면 힌트: ${directive.nextBeatHint}` : "",
    `유저 조종: ${USER_CONTROL_LABELS[directive.userControl]}`,
    "트리거된 사건 지시가 있으면 이번 턴 장면 지시보다 우선한다.",
    "이 장면 지시, 정체 감지, 권장 강도, 전개 방향이라는 말을 본문에 쓰지 않는다.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSceneDirectivePromptBlock(input: SceneDirectiveInput): string {
  return renderSceneDirectiveForPrompt(buildSceneDirective(input));
}
