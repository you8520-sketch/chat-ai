/**
 * Living Scene Directive V2 — Continuity Director.
 *
 * Does not delete legacy sceneDirective.ts. Gate OFF callers keep using
 * buildSceneDirective / renderSceneDirectiveForPrompt unchanged.
 */

import type { ChatMsg } from "@/lib/ai";
import { AUTO_PROGRESSION_SCENE_USER_CONTROL } from "@/lib/autoProgressionRules";
import { NO_FALSE_SHARED_MEMORY_RULE } from "@/lib/noGodmodding";
import type {
  SceneDirectiveMode,
  SceneUserControl,
} from "@/lib/sceneDirective";

export type ScenePhase =
  | "INTERACTION_OPEN"
  | "PARTING_OR_BOUNDARY"
  | "QUIET_CONTINUITY"
  | "ACTIVE_SCENE"
  | "MULTI_CHARACTER"
  | "MULTI_STAGE_CONFLICT"
  | "TRIGGERED_EVENT"
  | "AUTO_PROGRESSION";

export type SceneEnergy = "QUIET" | "ORDINARY" | "ACTIVE" | "URGENT";

export type EventSource =
  | "CURRENT_USER_CUE"
  | "RECENT_ACTIVE_THREAD"
  | "TRIGGERED_EVENT"
  | "AUTO_PROGRESSION"
  | "ESTABLISHED_SCHEDULE"
  | "LOCAL_AFFORDANCE"
  | "NONE";

export type LivingProgressionType =
  | "relationship_aftereffect"
  | "character_routine"
  | "established_task"
  | "ensemble_aftereffect"
  | "environment_continuity"
  | "future_intent"
  | "active_thread_consequence"
  | "triggered_event_followthrough";

export type LivingSceneDirective = {
  mode: SceneDirectiveMode;
  scenePhase: ScenePhase;
  sceneEnergy: SceneEnergy;
  repetitionRisk: boolean;
  progressionTypes: LivingProgressionType[];
  eventSource: EventSource;
  eventSourceEvidence: string[];
  avoid: string[];
  nextBeatHint?: string;
  userControl: SceneUserControl;
  /** Internal only — never rendered to the model prompt. */
  recommendedIntensityInternal: 0 | 1 | 2 | 3 | 4;
};

export type LivingSceneDirectiveInput = {
  mode: SceneDirectiveMode;
  recentMessages?: ChatMsg[];
  currentUserMessage?: string | null;
  triggeredEventText?: string | null;
  /** Grounded material pools — NOT used for direction classification. */
  memoryText?: string | null;
  relationshipMemoryText?: string | null;
  lorebookText?: string | null;
  /** Test/harness override — production callers leave unset. */
  forceScenePhase?: ScenePhase;
};

const PROGRESSION_LABELS: Record<LivingProgressionType, string> = {
  relationship_aftereffect: "관계의 여파",
  character_routine: "캐릭터 일상·습관",
  established_task: "기존 업무·미완료 일",
  ensemble_aftereffect: "메인 캐릭터 반응",
  environment_continuity: "장소·환경의 지속",
  future_intent: "다음 만남 의도",
  active_thread_consequence: "진행 중 사건의 결과",
  triggered_event_followthrough: "트리거 사건 후속",
};

const USER_CONTROL_LABELS: Record<SceneUserControl, string> = {
  no_user_control: "유저의 의도적 행동/대사/감정 결론은 쓰지 않는다.",
  limited_reactions: "유저의 의도는 쓰지 않고, 자연스러운 짧은 비자발 반응만 가능하다.",
  persona_based_dialogue_allowed: AUTO_PROGRESSION_SCENE_USER_CONTROL,
};

const PRIVATE_SCENE_CONTINUITY_RULE = [
  "[PRIVATE SCENE CONTINUITY RULE]",
  "입력 반응 뒤 내면·자기 일·관계 여파를 잇는다. 새 긴급 사건·NPC는 cue·최근 장면·트리거·확정 일정·자동진행 근거가 있을 때만. NONE이면 긴급 호출·신규 임무·공격·게이트·근거 없는 NPC 금지. LOCAL_AFFORDANCE는 가능.",
].join("\n");

const HINT_MULTI_CHARACTER =
  "둘 이상 메인이 각자 판단·말투로 대화·충돌·협력. 모든 대사가 유저만 향하지 않게, 결정 후 실행.";

const HINT_MULTI_STAGE =
  "갈등 인과로 능력·자원을 쓰고 국소 접촉은 성립시킬 수 있다. 성공한 유저 저항은 무효화하지 않으며, 되돌리기 어려운 연쇄 전에만 반응 공간을 남긴다.";

const MULTI_CHARACTER_CUES = [
  "두 사람",
  "둘은",
  "둘 다",
  "둘에게",
  "너희",
  "두 명",
  "번갈아",
];

const CONFLICT_CONTACT_CUES = [
  "닿지 마",
  "손 치워",
  "물러",
  "거부",
  "풀어",
  "떼어",
  "능력으로",
  "구속",
  "제압",
  "손목",
  "거리",
];

const HINT_PARTING =
  "직접 교환을 닫고 자기 일·관계로 돌아가며 여파를 남긴다. 다음 만남은 의도·기대만, 유저 미래 확정 금지.";

const HINT_QUIET =
  "새 긴급 사건 없이 장소·업무·습관·관계 여파·LOCAL_AFFORDANCE로 이어간다.";

const HINT_ACTIVE =
  "진행 중 갈등의 인과·역할 분담을 우선하고 무관한 새 사건을 추가하지 않는다.";

const HINT_TRIGGERED =
  "트리거 사건을 최우선으로 잇고 두 번째 별도 새 사건을 추가하지 않는다.";

const PARTING_PHRASES = [
  "오늘은 여기까지",
  "그쯤 하자",
  "그쯤 해도",
  "그만하자",
  "먼저 들어갈",
  "먼저 들어가",
  "나중에 말하",
  "혼자 있고",
  "거리를 두",
  "답하지 않아도",
  "오늘은 그쯤",
];

const ACTIVE_THREAD_TERMS = [
  "경보",
  "위험",
  "작전",
  "임무",
  "추적",
  "전투",
  "조사",
  "단서",
  "추격",
  "함정",
  "구출",
  "침투",
];

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function compactRecent(messages: ChatMsg[] | undefined): string {
  return (messages ?? [])
    .slice(-8)
    .map((m) => m.content.trim())
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

/** Repetition risk only — does NOT grant event authority. */
export function detectRepetitionRisk(recentMessages: ChatMsg[] | undefined): boolean {
  const recent = (recentMessages ?? []).slice(-8);
  if (recent.length < 4) return false;

  const assistantTurns = recent.filter((m) => m.role === "assistant");
  const userTurns = recent.filter((m) => m.role === "user");
  const reassuranceTerms = ["괜찮", "미안", "걱정", "말하지 않아도", "침묵"];
  const movementTerms = [
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
    "시작",
    "결정",
  ];

  const reassuranceCount = assistantTurns.filter((m) =>
    includesAny(m.content, reassuranceTerms)
  ).length;
  const shortUserReplies = userTurns.filter((m) => m.content.trim().length <= 12).length;
  const movementCount = movementTerms.reduce(
    (n, t) => n + (compactRecent(recent).includes(t) ? 1 : 0),
    0
  );
  const normalized = assistantTurns.map((m) => normalizeForRepeat(m.content));
  const repeatedAssistant =
    normalized.length >= 3 &&
    new Set(normalized.filter(Boolean)).size <= Math.max(1, normalized.length - 2);

  return (
    (reassuranceCount >= 2 && shortUserReplies >= 1) ||
    (shortUserReplies >= 3 && movementCount <= 1) ||
    repeatedAssistant
  );
}

export function detectPartingOrBoundary(
  currentUserMessage: string | null | undefined,
  recentMessages?: ChatMsg[]
): boolean {
  const current = (currentUserMessage ?? "").trim();
  if (!current) return false;
  const phraseHit = PARTING_PHRASES.some((p) => current.includes(p));
  if (!phraseHit) return false;

  // Require current-sentence context — reject if current is clearly starting a new active thread.
  if (includesAny(current, ["경보", "위험해", "싸워", "추격", "작전 시작"])) return false;

  // Soft confirm with recent interaction tone (short/quiet) when phrase alone is thin.
  const recent = compactRecent(recentMessages);
  const recentQuiet =
    !includesAny(recent, ACTIVE_THREAD_TERMS) ||
    includesAny(recent, ["괜찮", "미안", "침묵", "휴식", "들어가"]);
  return phraseHit && (current.length <= 80 || recentQuiet || current.includes("「"));
}

function detectActiveThread(
  currentUserMessage: string | null | undefined,
  recentMessages?: ChatMsg[]
): boolean {
  const text = `${currentUserMessage ?? ""}\n${compactRecent(recentMessages)}`;
  return includesAny(text, ACTIVE_THREAD_TERMS);
}

function detectMultiCharacter(current: string, recent: string): boolean {
  // Require current-user cue to avoid false MULTI_CHARACTER on thin handoff turns
  // that merely mention two names in prior assistant text.
  if (includesAny(current, MULTI_CHARACTER_CUES)) return true;
  // Soft secondary: current asks "둘/너희" style OR recent cue + current decision prompt
  return (
    includesAny(recent, MULTI_CHARACTER_CUES) &&
    includesAny(current, ["어떻게 할", "결정은", "너희", "둘", "의견"])
  );
}

function detectMultiStageConflict(current: string, recent: string): boolean {
  const conflictHit =
    includesAny(current, CONFLICT_CONTACT_CUES) || includesAny(recent, CONFLICT_CONTACT_CUES);
  const resistanceHit = includesAny(current, [
    "풀었",
    "해제",
    "거부",
    "물러",
    "닿지",
    "끝이야",
    "하지 마",
  ]);
  return conflictHit && resistanceHit;
}

export function resolveScenePhase(input: LivingSceneDirectiveInput): ScenePhase {
  if (input.forceScenePhase) return input.forceScenePhase;
  if (input.mode === "auto_progression") return "AUTO_PROGRESSION";
  if (input.triggeredEventText?.trim()) return "TRIGGERED_EVENT";
  if (detectPartingOrBoundary(input.currentUserMessage, input.recentMessages)) {
    return "PARTING_OR_BOUNDARY";
  }
  const current = (input.currentUserMessage ?? "").trim();
  const recent = compactRecent(input.recentMessages);
  if (detectMultiStageConflict(current, recent)) return "MULTI_STAGE_CONFLICT";
  if (detectMultiCharacter(current, recent)) return "MULTI_CHARACTER";
  if (detectActiveThread(input.currentUserMessage, input.recentMessages)) {
    return "ACTIVE_SCENE";
  }
  if (!current && !recent) return "QUIET_CONTINUITY";
  if (
    includesAny(current, ["뭐", "어때", "있었", "왜", "어디"]) &&
    !detectPartingOrBoundary(current, input.recentMessages)
  ) {
    return "INTERACTION_OPEN";
  }
  if (!detectActiveThread(current, input.recentMessages)) return "QUIET_CONTINUITY";
  return "INTERACTION_OPEN";
}

export function resolveEventSource(input: {
  mode: SceneDirectiveMode;
  scenePhase: ScenePhase;
  currentUserMessage?: string | null;
  recentMessages?: ChatMsg[];
  triggeredEventText?: string | null;
}): { eventSource: EventSource; evidence: string[] } {
  if (input.triggeredEventText?.trim()) {
    return { eventSource: "TRIGGERED_EVENT", evidence: ["triggeredEventText"] };
  }
  if (input.mode === "auto_progression") {
    return { eventSource: "AUTO_PROGRESSION", evidence: ["runtimeMode"] };
  }
  if (
    input.scenePhase === "ACTIVE_SCENE" ||
    input.scenePhase === "MULTI_STAGE_CONFLICT" ||
    input.scenePhase === "MULTI_CHARACTER"
  ) {
    const evidence: string[] = [];
    if (includesAny(input.currentUserMessage ?? "", ACTIVE_THREAD_TERMS) ||
      includesAny(input.currentUserMessage ?? "", CONFLICT_CONTACT_CUES) ||
      includesAny(input.currentUserMessage ?? "", MULTI_CHARACTER_CUES)) {
      evidence.push("CURRENT_USER");
    }
    if (
      includesAny(compactRecent(input.recentMessages), ACTIVE_THREAD_TERMS) ||
      includesAny(compactRecent(input.recentMessages), CONFLICT_CONTACT_CUES)
    ) {
      evidence.push("RECENT_SCENE");
    }
    return {
      eventSource: evidence.includes("CURRENT_USER")
        ? "CURRENT_USER_CUE"
        : evidence.length
          ? "RECENT_ACTIVE_THREAD"
          : "LOCAL_AFFORDANCE",
      evidence: evidence.length ? evidence : ["LOCAL_SCENE"],
    };
  }
  // Quiet / interaction / parting: no new plot event; local affordance remains available in prose.
  return { eventSource: "NONE", evidence: [] };
}

function energyForPhase(phase: ScenePhase, repetitionRisk: boolean): SceneEnergy {
  if (phase === "TRIGGERED_EVENT") return "URGENT";
  if (
    phase === "ACTIVE_SCENE" ||
    phase === "AUTO_PROGRESSION" ||
    phase === "MULTI_STAGE_CONFLICT" ||
    phase === "MULTI_CHARACTER"
  ) {
    return "ACTIVE";
  }
  if (phase === "PARTING_OR_BOUNDARY") return repetitionRisk ? "QUIET" : "ORDINARY";
  if (phase === "QUIET_CONTINUITY") return "QUIET";
  return "ORDINARY";
}

function selectLivingProgressionTypes(input: {
  scenePhase: ScenePhase;
  eventSource: EventSource;
  repetitionRisk: boolean;
  mode: SceneDirectiveMode;
}): LivingProgressionType[] {
  const selected: LivingProgressionType[] = [];
  const add = (t: LivingProgressionType) => {
    if (!selected.includes(t) && selected.length < 3) selected.push(t);
  };

  if (input.scenePhase === "TRIGGERED_EVENT" || input.eventSource === "TRIGGERED_EVENT") {
    add("triggered_event_followthrough");
    add("active_thread_consequence");
    return selected;
  }

  if (
    (input.scenePhase === "ACTIVE_SCENE" ||
      input.scenePhase === "MULTI_STAGE_CONFLICT" ||
      input.scenePhase === "MULTI_CHARACTER") &&
    input.eventSource !== "NONE"
  ) {
    add("active_thread_consequence");
    add("established_task");
    add("ensemble_aftereffect");
    return selected;
  }

  if (input.scenePhase === "PARTING_OR_BOUNDARY") {
    add("relationship_aftereffect");
    add("character_routine");
    add("future_intent");
    return selected;
  }

  if (input.repetitionRisk) {
    add("relationship_aftereffect");
    add("character_routine");
    add("environment_continuity");
    return selected;
  }

  if (input.mode === "auto_progression") {
    add("ensemble_aftereffect");
    add("established_task");
    add("environment_continuity");
    return selected;
  }

  // QUIET_CONTINUITY / INTERACTION_OPEN default — no lore_clue / npc_action / tactical
  add("character_routine");
  add("relationship_aftereffect");
  add("environment_continuity");
  return selected;
}

function buildAvoidList(phase: ScenePhase, eventSource: EventSource): string[] {
  const avoid = [
    "괜찮냐는 반복",
    "이미 지난 설명 반복",
    "트리거 조건 노출",
    "유저 의도 작성",
    "유저 미래 행동 확정",
  ];
  if (eventSource === "NONE") {
    avoid.unshift(
      "새 NPC 생성",
      "신규 기관 절차",
      "새 임무·위기·단서",
      "긴급 호출·시간 압박"
    );
  }
  if (phase === "PARTING_OR_BOUNDARY") {
    avoid.unshift("질문으로 대화 억지 연장", "별명·식사·새 제안으로 붙잡기");
  }
  return avoid.slice(0, 6);
}

function buildHint(phase: ScenePhase): string {
  if (phase === "TRIGGERED_EVENT") return HINT_TRIGGERED;
  if (phase === "PARTING_OR_BOUNDARY") return HINT_PARTING;
  if (phase === "MULTI_CHARACTER") return HINT_MULTI_CHARACTER;
  if (phase === "MULTI_STAGE_CONFLICT") return HINT_MULTI_STAGE;
  if (phase === "ACTIVE_SCENE" || phase === "AUTO_PROGRESSION") return HINT_ACTIVE;
  return HINT_QUIET;
}

function internalIntensity(energy: SceneEnergy): 0 | 1 | 2 | 3 | 4 {
  if (energy === "QUIET") return 0;
  if (energy === "ORDINARY") return 1;
  if (energy === "ACTIVE") return 3;
  return 4;
}

export function buildLivingSceneDirective(
  input: LivingSceneDirectiveInput
): LivingSceneDirective {
  const scenePhase = resolveScenePhase(input);
  const repetitionRisk = detectRepetitionRisk(input.recentMessages);
  const { eventSource, evidence } = resolveEventSource({
    mode: input.mode,
    scenePhase,
    currentUserMessage: input.currentUserMessage,
    recentMessages: input.recentMessages,
    triggeredEventText: input.triggeredEventText,
  });
  const sceneEnergy = energyForPhase(scenePhase, repetitionRisk);
  const progressionTypes = selectLivingProgressionTypes({
    scenePhase,
    eventSource,
    repetitionRisk,
    mode: input.mode,
  });
  const userControl: SceneUserControl =
    input.mode === "auto_progression" ? "persona_based_dialogue_allowed" : "no_user_control";

  return {
    mode: input.mode,
    scenePhase,
    sceneEnergy,
    repetitionRisk,
    progressionTypes,
    eventSource,
    eventSourceEvidence: evidence,
    avoid: buildAvoidList(scenePhase, eventSource),
    nextBeatHint: buildHint(scenePhase),
    userControl,
    recommendedIntensityInternal: internalIntensity(sceneEnergy),
  };
}

export function renderLivingSceneDirectiveForPrompt(
  directive: LivingSceneDirective
): string {
  const modeLabel = directive.mode === "auto_progression" ? "자동진행" : "일반 RP";
  const progression = directive.progressionTypes
    .map((type) => PROGRESSION_LABELS[type])
    .join(" + ");
  return [
    PRIVATE_SCENE_CONTINUITY_RULE,
    "",
    "[이번 턴 장면 연속 지시 - 비공개]",
    `모드: ${modeLabel} / 국면: ${directive.scenePhase} / ${directive.sceneEnergy}`,
    `사건근거: ${directive.eventSource} / 전개: ${progression}`,
    `피할 것: ${directive.avoid.slice(0, 3).join(", ")}`,
    directive.nextBeatHint ? `힌트: ${directive.nextBeatHint}` : "",
    `유저 조종: ${USER_CONTROL_LABELS[directive.userControl]}`,
    directive.mode === "auto_progression"
      ? "다인물 대화·판단·갈등·협력. [B] 내면 시점 금지."
      : "",
    directive.mode === "auto_progression" ? NO_FALSE_SHARED_MEMORY_RULE : "",
    "트리거 우선. 별도 사건 금지.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildLivingSceneDirectivePromptBlock(
  input: LivingSceneDirectiveInput
): string {
  return renderLivingSceneDirectiveForPrompt(buildLivingSceneDirective(input));
}
