/**
 * Scene continuity / replay audit (Phase D).
 *
 * PRIOR CANON / MEMORY / RECENT SCENE = STATE that drives the next beat
 * NOT source text to re-output.
 *
 * Temporal start of a reply is after:
 *   latest canonical assistant scene + latest completed user input
 */
import { longestCommonSubstring } from "./settingOverlap";
import { extractDialogueSpans, splitParagraphs } from "./quotes";

/** Human 0–3 (auto signals are advisory). */
export type ContinuityHumanScores = {
  RECENT_SCENE_REPLAY: 0 | 1 | 2 | 3;
  CURRENT_INPUT_REPLAY: 0 | 1 | 2 | 3;
  INTRA_TURN_REEXPLANATION: 0 | 1 | 2 | 3;
  INTRO_REPLAY: 0 | 1 | 2 | 3;
  TURN1_REPLAY_ON_TURN2: 0 | 1 | 2 | 3;
  SCENE_ADVANCEMENT: 0 | 1 | 2;
  /** G5 human flag — first-turn-only special setting/scene re-intro. */
  FIRST_TURN_SPECIAL_TREATMENT: 0 | 1;
};

export const CONTINUITY_HUMAN_SCHEMA = {
  RECENT_SCENE_REPLAY:
    "0=없음 · 1=짧은 자연스러운 참조 · 2=이미 본 장면을 눈에 띄게 다시 설명 · 3=한 문단 이상 재연/요약하여 실제 진행을 지연",
  CURRENT_INPUT_REPLAY:
    "0=없음 · 1=반응을 위해 짧게 지칭 · 2=행동/대사 일부를 다시 재현 · 3=유저 입력 상당 부분을 재서술/재대사 (재연)",
  INTRA_TURN_REEXPLANATION:
    "0=없음 · 1=가벼운 재진술 · 2=이미 드러난 의미를 추상 문장으로 반복 확인 · 3=지속적 tell-after-show 루프",
  INTRO_REPLAY:
    "0=없음 · 1=짧은 콜백 · 2=greeting/intro 장면 재설명 · 3=새 반응 전에 intro 전체를 재연",
  TURN1_REPLAY_ON_TURN2:
    "0=없음 · 1=짧은 참조 · 2=turn1 사건 재설명 · 3=turn1 장면을 재연하며 진행 지연",
  SCENE_ADVANCEMENT:
    "0=정체/rewind · 1=약한 전진 · 2=prior+input 직후 명확한 새 반응/변화",
  FIRST_TURN_SPECIAL_TREATMENT:
    "0=없음 · 1=첫 턴만 예외적으로 설정/장면을 재소개 · (G5 human flag)",
} as const;

/** Fixture G5 / G6 required human measure keys (D1+). */
export const CONTINUITY_FIXTURE_MEASURES = {
  G5: [
    "INTRO_REPLAY",
    "CURRENT_INPUT_REPLAY",
    "SETTING_RECITAL",
    "FIRST_TURN_SPECIAL_TREATMENT",
    "SCENE_ADVANCEMENT",
  ],
  G6: ["TURN1_REPLAY_ON_TURN2"],
} as const;

export type ContinuityAutoAudit = {
  current_input_lcs_chars: number;
  current_input_overlap_alarm: boolean;
  current_input_dialogue_echo: boolean;
  recent_assistant_lcs_chars: number;
  recent_assistant_overlap_alarm: boolean;
  opening_paragraph_mirrors_prior: boolean;
  intra_turn_abstract_restatement_hits: number;
  intra_turn_reexplanation_alarm: boolean;
  continuity_review_required: boolean;
  alarms: string[];
};

const ABSTRACT_REEXPLAIN_RE =
  /(이것은\s*~?(?:가|이)?\s*아니었|라는\s*뜻이었|의\s*표시였|하는\s*(?:눈빛|어조)이었|결국\s*.{0,24}의미|다시\s*말해|요컨대|한마디로|그것은\s*.{0,20}증명)/;

function normalizeLoose(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_~`]/g, "")
    .replace(/[\s\n\r\t]+/g, "")
    .replace(/[.,!?;:'"“”‘’…·—–\-_/\\()[\]{}]/g, "");
}

function extractUserDialogueSnippets(userInput: string): string[] {
  return extractDialogueSpans(userInput)
    .map((s) => s.content.trim())
    .filter((s) => s.replace(/\s+/g, "").length >= 4);
}

function extractUserActionSnippets(userInput: string): string[] {
  const out: string[] = [];
  const star = /\*([^*]{4,200})\*/g;
  let m: RegExpExecArray | null;
  while ((m = star.exec(userInput))) {
    out.push(m[1]!.trim());
  }
  // Parenthetical actions common in KR fixtures: (갸웃)
  const paren = /\(([^)]{2,40})\)/g;
  while ((m = paren.exec(userInput))) {
    out.push(m[1]!.trim());
  }
  return out;
}

/**
 * Auto continuity signals. Human 0–3 scores remain authoritative for winner calls.
 */
export function computeContinuityAutoAudit(input: {
  output: string;
  currentUserInput?: string | null;
  priorAssistantText?: string | null;
  greetingOrIntroText?: string | null;
}): ContinuityAutoAudit {
  const output = input.output ?? "";
  const user = input.currentUserInput ?? "";
  const prior = input.priorAssistantText ?? "";
  const intro = input.greetingOrIntroText ?? "";
  const alarms: string[] = [];

  const userLcs = user.trim()
    ? longestCommonSubstring(output, user, 8_000)
    : { len: 0, snippet: "" };
  const current_input_lcs_chars = userLcs.len;
  const current_input_overlap_alarm = current_input_lcs_chars >= 18;

  let current_input_dialogue_echo = false;
  for (const snip of extractUserDialogueSnippets(user)) {
    const n = normalizeLoose(snip);
    if (n.length >= 6 && normalizeLoose(output).includes(n)) {
      current_input_dialogue_echo = true;
      break;
    }
  }
  // Strong action echo: normalized action clause appears in opening narration
  if (!current_input_dialogue_echo) {
    const opening = splitParagraphs(output).slice(0, 3).join("\n");
    for (const act of extractUserActionSnippets(user)) {
      const n = normalizeLoose(act);
      if (n.length >= 10 && normalizeLoose(opening).includes(n)) {
        current_input_dialogue_echo = true;
        break;
      }
    }
  }
  if (current_input_overlap_alarm || current_input_dialogue_echo) {
    alarms.push("CURRENT_INPUT_REPLAY_SIGNAL");
  }

  const priorSrc = prior.trim() || intro.trim();
  const priorLcs = priorSrc
    ? longestCommonSubstring(output, priorSrc, 10_000)
    : { len: 0, snippet: "" };
  const recent_assistant_lcs_chars = priorLcs.len;
  const recent_assistant_overlap_alarm = recent_assistant_lcs_chars >= 28;

  const firstPara = splitParagraphs(output)[0] ?? "";
  let opening_paragraph_mirrors_prior = false;
  if (priorSrc && firstPara.replace(/\s+/g, "").length >= 40) {
    const openLcs = longestCommonSubstring(firstPara, priorSrc, 4_000);
    opening_paragraph_mirrors_prior = openLcs.len >= 24;
  }
  if (recent_assistant_overlap_alarm || opening_paragraph_mirrors_prior) {
    alarms.push("RECENT_SCENE_REPLAY_SIGNAL");
  }

  const paras = splitParagraphs(output);
  let intra_turn_abstract_restatement_hits = 0;
  for (const p of paras) {
    if (ABSTRACT_REEXPLAIN_RE.test(p)) intra_turn_abstract_restatement_hits += 1;
  }
  const intra_turn_reexplanation_alarm =
    intra_turn_abstract_restatement_hits >= 2;
  if (intra_turn_reexplanation_alarm) {
    alarms.push("INTRA_TURN_REEXPLANATION_SIGNAL");
  }

  const continuity_review_required =
    current_input_overlap_alarm ||
    current_input_dialogue_echo ||
    recent_assistant_overlap_alarm ||
    opening_paragraph_mirrors_prior ||
    intra_turn_reexplanation_alarm;

  return {
    current_input_lcs_chars,
    current_input_overlap_alarm,
    current_input_dialogue_echo,
    recent_assistant_lcs_chars,
    recent_assistant_overlap_alarm,
    opening_paragraph_mirrors_prior,
    intra_turn_abstract_restatement_hits,
    intra_turn_reexplanation_alarm,
    continuity_review_required,
    alarms,
  };
}

export function emptyContinuityHumanScores(): ContinuityHumanScores {
  return {
    RECENT_SCENE_REPLAY: 0,
    CURRENT_INPUT_REPLAY: 0,
    INTRA_TURN_REEXPLANATION: 0,
    INTRO_REPLAY: 0,
    TURN1_REPLAY_ON_TURN2: 0,
    SCENE_ADVANCEMENT: 2,
    FIRST_TURN_SPECIAL_TREATMENT: 0,
  };
}
