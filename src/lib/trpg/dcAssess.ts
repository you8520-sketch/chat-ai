import {
  parseTrpgDiceRules,
  type TrpgDcBand,
  type TrpgDiceRules,
} from "./types";
import type { TrpgActionType } from "./actionTypes";

/** Obvious “this should be hard” cues in Korean action/place text. */
const HARD_HITS = [
  "절벽",
  "낭떠러지",
  "수직",
  "얼음벽",
  "뛰어내",
  "맨손",
  "잠긴",
  "자물쇠",
  "철창",
  "철문",
  "빗장",
  "봉인",
  "결계",
  "함정",
  "독침",
  "암살",
  "저격",
  "포위",
  "추격",
  "폭풍",
  "눈보라",
  "화재",
  "붕괴",
  "무너지",
  "성벽",
  "경비병",
  "중무장",
  "결투",
  "결전",
  "적진",
  "마왕",
  "수호자",
  "금기",
  "사지",
  "필사적",
  "목숨 걸",
  "보스",
];

/** Obvious “anyone can see this is easy” cues. */
const EASY_HITS = [
  "인사",
  "잡담",
  "둘러보",
  "구경",
  "따라가",
  "앉아서",
  "쉬고",
  "한잔",
  "주워",
  "가볍게",
  "고개 끄덕",
  "미소",
  "열린 문",
  "평범한",
  "그냥 걷",
  "물어보",
  "대화하",
];

function hitCount(hay: string, needles: readonly string[]): number {
  let n = 0;
  for (const word of needles) {
    if (hay.includes(word)) n += 1;
  }
  return n;
}

export function assessSituationBand(opts: {
  body: string;
  actionType?: TrpgActionType | string | null;
  location?: string;
  nextRoundContext?: string;
  worldFlags?: string[];
}): TrpgDcBand {
  const hay = [
    opts.body,
    opts.location ?? "",
    opts.nextRoundContext ?? "",
    ...(opts.worldFlags ?? []),
  ]
    .join("\n")
    .toLowerCase();
  const hard = hitCount(hay, HARD_HITS);
  const easy = hitCount(hay, EASY_HITS);
  if (hard >= 2 || (hard >= 1 && hard > easy)) return "hard";
  if (easy >= 2 && hard === 0) return "easy";
  if (easy > hard) return "easy";
  return "normal";
}

export function dcForBand(rules: TrpgDiceRules, band: TrpgDcBand): number {
  switch (band) {
    case "easy":
      return rules.easyDc;
    case "normal":
      return rules.normalDc;
    case "hard":
      return rules.hardDc;
    default: {
      const _exhaustive: never = band;
      return _exhaustive;
    }
  }
}

export function bandFromDc(dc: number, rules: TrpgDiceRules): TrpgDcBand {
  if (dc <= rules.easyDc) return "easy";
  if (dc >= rules.hardDc) return "hard";
  return "normal";
}

/** Pick DC before the roll. Fixed campaigns stay on 12. No extra LLM. */
export function resolveActionDc(opts: {
  rules: TrpgDiceRules;
  body: string;
  actionType?: TrpgActionType | string | null;
  location?: string;
  nextRoundContext?: string;
  worldFlags?: string[];
}): number {
  const rules = parseTrpgDiceRules(opts.rules);
  switch (rules.dcMode) {
    case "fixed":
      return rules.dc;
    case "situational":
      return dcForBand(rules, assessSituationBand(opts));
    default: {
      const _exhaustive: never = rules.dcMode;
      return _exhaustive;
    }
  }
}
