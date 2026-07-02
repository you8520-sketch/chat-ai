/**
 * Step 7.4 — map authorial habits to production prompt rules (origin audit).
 * No new rules — trace only.
 */

import { PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";
import { GENERATION_PROCESS_BEAT_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";
import { NARRATIVE_DENSITY_BLOCK, NO_GENERIC_REACTIONS_BLOCK } from "@/lib/sceneExpansionPolicy";
import { SCENE_CONTINUATION_PRIORITY_BLOCK } from "@/lib/turnHandoffAndPacing";
import { buildLengthInstruction } from "@/lib/responseLength";

export type HabitTarget =
  | "hand_finger_anchor"
  | "explain_interpret_conclude"
  | "simile_machi_cherom"
  | "gaze_silence_wait_end";

export type FixRecommendation = "Rule Removal" | "Rule Merge" | "Rule Rewrite";

export type HabitOriginRule = {
  id: string;
  owner: string;
  section: string;
  file: string;
  snippet: string;
  habits: HabitTarget[];
  /** high | medium | low — how strongly the rule invites the habit */
  impact: "high" | "medium" | "low";
  duplicateOf?: string;
  deletable: "yes" | "partial" | "no";
  deletableNote: string;
};

/** Static inventory — production SoT blocks that can induce Step 7.3 habits */
export const HABIT_ORIGIN_RULE_INVENTORY: HabitOriginRule[] = [
  {
    id: "SENSATION-tactile-deep",
    owner: "SENSATION",
    section: "PROSE STYLE",
    file: "src/lib/advancedProseNsfwGuidelines.ts",
    snippet:
      "감각 채널(시각·청각·촉각·온도·냄새·근육감·공간감) 중 1~2개를 골라 깊게 — 질감",
    habits: ["hand_finger_anchor", "simile_machi_cherom"],
    impact: "high",
    duplicateOf: "NARRATIVE_DENSITY-body-contact · LENGTH-expand-sensation",
    deletable: "no",
    deletableNote: "촉각·질감 깊이 요구 → 손/손끝이 최단 구현 경로",
  },
  {
    id: "EMOTION-body-gaze-silence",
    owner: "EMOTION",
    section: "PROSE STYLE",
    file: "src/lib/advancedProseNsfwGuidelines.ts",
    snippet: "감정은 몸·시선·호흡·거리·침묵·주변 환경의 변화로",
    habits: ["hand_finger_anchor", "gaze_silence_wait_end", "explain_interpret_conclude"],
    impact: "high",
    duplicateOf: "WEBNOVEL_BREATH-pause · GENRE_TONE-gaze",
    deletable: "no",
    deletableNote: "시선·침묵을 명시 열거 — 바라보/침묵 습관 직접 유도",
  },
  {
    id: "EMOTION-reader-infer",
    owner: "EMOTION",
    section: "PROSE STYLE",
    file: "src/lib/advancedProseNsfwGuidelines.ts",
    snippet: "독자가 지문에서 스스로 읽어낼 수 있도록 / 강도와 속도는 반비례",
    habits: ["explain_interpret_conclude"],
    impact: "medium",
    duplicateOf: "GENERATION_PROCESS-withhold-reveal",
    deletable: "partial",
    deletableNote: "해석·여운 레이어 장려 → 설명→결론 문장 구조",
  },
  {
    id: "WEBNOVEL_BREATH-gaze-sense",
    owner: "WEBNOVEL BREATH",
    section: "PROSE STYLE",
    file: "src/lib/advancedProseNsfwGuidelines.ts",
    snippet: "지문 한 겹(시선·공간·감각)으로 속도를 한 박 늦춘다 / 여운: 공기만",
    habits: ["gaze_silence_wait_end", "simile_machi_cherom"],
    impact: "high",
    duplicateOf: "EMOTION-body-gaze-silence · GENERATION_PROCESS-pause",
    deletable: "partial",
    deletableNote: "pause beat = 시선+감각 pad — 턴 끝 바라봄·정적과 중복",
  },
  {
    id: "GENERATION_PROCESS-pause-withhold-hook",
    owner: "GENERATION PROCESS",
    section: "PROSE STYLE",
    file: "src/lib/generationProcessBeatFlow.ts",
    snippet: "withhold → reveal / pause → breath beat / hook → unresolved",
    habits: ["gaze_silence_wait_end", "explain_interpret_conclude"],
    impact: "medium",
    duplicateOf: "WEBNOVEL_BREATH · SCENE_CONTINUATION",
    deletable: "no",
    deletableNote: "pause·withhold가 침묵·기다림·미해결 시선으로 구현됨",
  },
  {
    id: "RHYTHM-mix-length",
    owner: "RHYTHM",
    section: "PROSE STYLE",
    file: "src/lib/advancedProseNsfwGuidelines.ts",
    snippet: "문장 시작형·길이 혼합 — 리듬",
    habits: [],
    impact: "low",
    deletable: "no",
    deletableNote: "대상 습관과 직접 연관 약함",
  },
  {
    id: "MOVEMENT-space-update",
    owner: "MOVEMENT & SPACE",
    section: "PROSE STYLE",
    file: "src/lib/advancedProseNsfwGuidelines.ts",
    snippet: "위치·거리·방향·결과 서술 / 공간 관계 갱신",
    habits: ["explain_interpret_conclude"],
    impact: "low",
    duplicateOf: "MOMENT-TO-MOMENT",
    deletable: "no",
    deletableNote: "단계별 공간 설명이 해설 체인에 기여할 수 있음",
  },
  {
    id: "NARRATION_REGISTER",
    owner: "NARRATION REGISTER",
    section: "PROSE STYLE",
    file: "src/lib/advancedProseNsfwGuidelines.ts",
    snippet: "지문 해체(-다)만 — 대사 register는 SPEECH METADATA",
    habits: [],
    impact: "low",
    deletable: "no",
    deletableNote: "대상 습관과 무관",
  },
  {
    id: "LENGTH-expand-sensation",
    owner: "LENGTH CONTROL",
    section: "LENGTH CONTROL & SCENE EXPANSION",
    file: "src/lib/responseLength.ts",
    snippet: "장면·대사 사이를 행동·반응·감각·분위기로 확장",
    habits: ["hand_finger_anchor", "gaze_silence_wait_end", "simile_machi_cherom"],
    impact: "high",
    duplicateOf: "SENSATION · NARRATIVE_DENSITY · MOMENT-TO-MOMENT",
    deletable: "no",
    deletableNote: "3000자+ 압력 — 감각 pad 반복 주범",
  },
  {
    id: "SCENE_CONTINUATION-yeonun",
    owner: "SCENE CONTINUATION",
    section: "LENGTH CONTROL",
    file: "src/lib/turnHandoffAndPacing.ts",
    snippet: "감정의 여운·몸짓·분위기 변화·새 상호작용 / 조기 종료 금지",
    habits: ["gaze_silence_wait_end", "hand_finger_anchor"],
    impact: "high",
    duplicateOf: "WEBNOVEL_BREATH · GENERATION_PROCESS-handoff",
    deletable: "partial",
    deletableNote: "여운·몸짓 = 침묵·손·시선 패턴으로 채움",
  },
  {
    id: "NARRATIVE_DENSITY-slow-body",
    owner: "NARRATIVE DENSITY",
    section: "LENGTH CONTROL",
    file: "src/lib/sceneExpansionPolicy.ts",
    snippet: "깊이>속도 / 감정 전환·신체 접촉·분위기 변화를 확장",
    habits: ["hand_finger_anchor", "explain_interpret_conclude", "gaze_silence_wait_end"],
    impact: "high",
    duplicateOf: "LENGTH-expand · MOMENT-TO-MOMENT · EMOTION",
    deletable: "partial",
    deletableNote: "신체 접촉 확장 = 손 anchor; 천천히 = 침묵 pad",
  },
  {
    id: "MOMENT-TO-MOMENT-chain",
    owner: "MOMENT-TO-MOMENT",
    section: "LENGTH CONTROL",
    file: "src/lib/sceneExpansionPolicy.ts",
    snippet: "순간마다 이어 서술 / 중간 단계 건너뛰지 마라",
    habits: ["explain_interpret_conclude"],
    impact: "medium",
    duplicateOf: "NARRATIVE_DENSITY · MOVEMENT",
    deletable: "partial",
    deletableNote: "관찰→해석→결론 3단 연쇄 장려",
  },
  {
    id: "NO_GENERIC_REACTIONS-anti-cliche",
    owner: "NO GENERIC REACTIONS",
    section: "LENGTH CONTROL",
    file: "src/lib/sceneExpansionPolicy.ts",
    snippet: "고개 끄덕·미소·잠시 침묵 상투 금지 → 구체적 몸짓·감각",
    habits: ["gaze_silence_wait_end"],
    impact: "medium",
    duplicateOf: "EMOTION (침묵은 EMOTION에서 다시 요구)",
    deletable: "no",
    deletableNote: "침묵 금지 vs EMOTION 침묵 사용 — 규칙 충돌; 모델은 EMOTION·BREATH 따름",
  },
  {
    id: "TERMINAL-FLOOR-3200",
    owner: "TERMINAL LENGTH",
    section: "system tail",
    file: "src/lib/responseLength.ts",
    snippet: "TARGET_LENGTH 3,200+ · MINIMUM_FLOOR · 조기 종료 금지",
    habits: ["hand_finger_anchor", "gaze_silence_wait_end", "explain_interpret_conclude"],
    impact: "high",
    duplicateOf: "LENGTH-expand · SCENE_CONTINUATION",
    deletable: "no",
    deletableNote: "분량 압력이 pad 습관 증폭 (현재 3000자+ 출력 확인)",
  },
  {
    id: "GENRE_TONE-gaze-emotion",
    owner: "GENRE_TONE",
    section: "narrativeStyle",
    file: "src/lib/narrativeStyle.ts",
    snippet: "감정은 행동·시선·거리감 (로맨스/판타지 등)",
    habits: ["gaze_silence_wait_end"],
    impact: "medium",
    duplicateOf: "EMOTION-body-gaze-silence",
    deletable: "partial",
    deletableNote: "장르마다 시선·거리 재언급",
  },
  {
    id: "FEWSHOT-hand-heavy",
    owner: "example_dialog / few-shot",
    section: "character canon",
    file: "src/lib/narrationFewShotTemplates.ts",
    snippet: "buildHandHeavyFewShot — 손끝·손가락·손목·손바닥 반복 예시",
    habits: ["hand_finger_anchor"],
    impact: "high",
    duplicateOf: "SENSATION-tactile (when fallback enabled)",
    deletable: "yes",
    deletableNote: "fallback ON 시 space/sound few-shot으로 교체 가능 — 이미 buildSpaceSoundFewShot 존재",
  },
  {
    id: "SENSATION-analogy-qualia",
    owner: "SENSATION",
    section: "PROSE STYLE",
    file: "src/lib/advancedProseNsfwGuidelines.ts",
    snippet: "색이 아니라 질감, 소리가 아니라 방향·거리·크기",
    habits: ["simile_machi_cherom"],
    impact: "medium",
    deletable: "partial",
    deletableNote: "대비형 서술 → 마치/처럼 비유로 승화",
  },
];

export const HABIT_FIX_RECOMMENDATIONS: Record<
  HabitTarget,
  { approach: FixRecommendation; rationale: string; owners: string[] }
> = {
  hand_finger_anchor: {
    approach: "Rule Merge",
    rationale:
      "SENSATION·NARRATIVE_DENSITY·LENGTH의 '감각/신체 확장'을 한 Owner(SENSATION)로 합치고, 촉각 예시를 공간·소리 채널로 Rewrite. FEWSHOT-hand-heavy는 Removal(교체).",
    owners: ["SENSATION", "NARRATIVE DENSITY", "LENGTH expand", "FEWSHOT"],
  },
  explain_interpret_conclude: {
    approach: "Rule Merge",
    rationale:
      "MOMENT-TO-MOMENT + NARRATIVE DENSITY + EMOTION(독자 추론) + GENERATION withhold/reveal 중복. MOMENT-TO-MOMENT를 DENSITY에 Merge, EMOTION은 '해석 문장'만 Rewrite(행동 열거 유지).",
    owners: ["MOMENT-TO-MOMENT", "NARRATIVE DENSITY", "EMOTION", "GENERATION PROCESS"],
  },
  simile_machi_cherom: {
    approach: "Rule Rewrite",
    rationale:
      "직접 '비유 써라' 규칙 없음 — SENSATION 대비형(질감/방향) Rewrite로 명사 비교 축소. 새 금지 규칙 추가 없이 기존 SENSATION 2줄만 조정.",
    owners: ["SENSATION"],
  },
  gaze_silence_wait_end: {
    approach: "Rule Merge",
    rationale:
      "EMOTION·WEBNOVEL BREATH·SCENE CONTINUATION·GENERATION pause가 동일 pad 요구. BREATH+CONTINUATION Merge, EMOTION에서 '침묵·시선' 명사 열거 Removal(다른 표현은 EMOTION에 Rewrite).",
    owners: ["EMOTION", "WEBNOVEL BREATH", "SCENE CONTINUATION", "GENERATION PROCESS pause"],
  },
};

export function buildProductionPromptSliceForOriginAudit(): string {
  return [
    PROSE_STYLE_SECTION,
    buildLengthInstruction(3200, {
      statusWindowEveryTurn: false,
      htmlFlashOwned: true,
      statusWidgetActive: false,
    }),
    NARRATIVE_DENSITY_BLOCK,
    SCENE_CONTINUATION_PRIORITY_BLOCK,
    NO_GENERIC_REACTIONS_BLOCK,
    GENERATION_PROCESS_BEAT_FLOW_BLOCK,
  ].join("\n\n");
}

export function rulesForHabit(habit: HabitTarget): HabitOriginRule[] {
  return HABIT_ORIGIN_RULE_INVENTORY.filter((r) => r.habits.includes(habit));
}

export function duplicateClusters(): { habit: HabitTarget; cluster: string[] }[] {
  return (Object.keys(HABIT_FIX_RECOMMENDATIONS) as HabitTarget[]).map((habit) => ({
    habit,
    cluster: [...new Set(rulesForHabit(habit).map((r) => r.owner))],
  }));
}

export const HABIT_LABELS: Record<HabitTarget, string> = {
  hand_finger_anchor: "손 / 손가락 anchor",
  explain_interpret_conclude: "설명 → 해석 → 결론",
  simile_machi_cherom: "마치 / 처럼 비유",
  gaze_silence_wait_end: "바라보았다 / 침묵 / 기다렸다",
};
