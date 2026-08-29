/**
 * Action-adjudication method hints — separate from persona stat hints in TRPG_STAT_CATALOG.
 * Used only when resolving which sheet stat applies to a submitted action body.
 */

export const ACTION_COMPATIBLE_STATS: Record<string, readonly string[]> = {
  attack: ["str", "mag", "dex", "acc", "spd", "foc"],
  defend: ["con", "grd", "res", "wil", "dex", "siz"],
  investigate: ["int", "per", "ins", "wis", "tec"],
  persuade: ["cha", "wis", "wil", "pre", "inf", "emp"],
  stealth: ["dex", "spd", "surv", "tec", "lck"],
  support: ["str", "dex", "acc", "wis", "rec", "tec", "int", "fth", "wil", "foc"],
  use_item: ["int", "tec", "foc", "mag", "dex"],
  free: ["dex", "foc", "ins", "int", "str", "per", "tec", "wis"],
};

/** Method semantics for adjudication — intentionally excludes persona-only words like "도주". */
export const ACTION_METHOD_STAT_HINTS: Record<string, readonly string[]> = {
  str: [
    "마체테",
    "절단",
    "내리찍",
    "휘두",
    "때리",
    "파괴",
    "부수",
    "찌르",
    "주먹",
    "칼날",
    "칼을",
    "도끼",
    "창",
    "근접",
    "힘껏",
    "연결부",
    "파쇄",
    "베어",
    "베인",
    "베어서",
  ],
  dex: ["회피", "피하", "날렵", "재빨리", "손놀림", "잔기술", "구르", "뛰어", "몸을 날"],
  acc: ["조준", "사격", "활", "총", "명중", "원거리", "정밀", "엄호", "엄호 사격"],
  mag: ["주문", "마법", "마력", "화염", "빙결", "번개", "소환", "초능력", "염력"],
  int: ["분석", "패턴", "구조", "연결", "흐름", "확인", "연구", "추론", "해석", "계산", "단서", "정리", "경로", "감염"],
  per: ["관찰", "흔적", "살핀", "살피", "둘러", "주시", "들여다", "탐색", "수색", "기척"],
  ins: ["직감", "육감", "예감", "느낌"],
  wis: ["판단", "통찰", "감지", "치료", "붕대", "지혈", "응급", "해독", "간호"],
  rec: ["치료", "치유", "붕대", "지혈", "응급", "회복"],
  tec: ["장치", "해제", "수리", "자물쇠", "기계", "도구", "해킹", "조작", "분해", "점검"],
  con: ["버티", "몸으로", "체구", "맷집", "지구력", "버텨", "견디", "넓은", "막고", "막아", "막는"],
  grd: ["가드", "막기", "패링", "받아치", "방패"],
  res: ["저항", "견디", "독", "해독", "면역"],
  wil: ["정신", "의지", "굴복", "공포"],
  cha: ["설득", "협상", "위압", "매력", "화술"],
  spd: ["달리", "질주", "추격", "선제"],
  foc: ["집중", "조준", "몰입", "유지"],
  surv: ["추적", "야영", "야생", "사냥"],
  fth: ["기도", "축복", "신성", "기적"],
  san: ["이성", "광기", "정신붕괴"],
  lck: ["운", "행운", "우연"],
  siz: ["체구", "거구", "덩치", "몸집"],
  pre: ["위압", "존재감", "기세"],
  inf: ["인맥", "연줄"],
  emp: ["공감", "위로", "다독"],
};

export function scoreActionMethodHints(text: string, key: string): number {
  const hay = text.toLowerCase();
  const hints = ACTION_METHOD_STAT_HINTS[key];
  if (!hints?.length) return 0;
  return hints.reduce((n, hint) => n + (hay.includes(hint.toLowerCase()) ? 1 : 0), 0);
}

export function compatibleStatsForAction(actionType: string | null): readonly string[] {
  if (actionType && actionType in ACTION_COMPATIBLE_STATS) {
    return ACTION_COMPATIBLE_STATS[actionType]!;
  }
  return ACTION_COMPATIBLE_STATS.free!;
}
