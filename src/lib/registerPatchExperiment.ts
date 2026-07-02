/**
 * Step 7.5 — Register patch experiment + production genre_tone SoT.
 * Production (REGISTER_PATCH unset): Step 4.3 atmosphere-only hints (Patch A).
 * REGISTER_PATCH=none: legacy Step 7.3 hints (validation baseline only).
 */

import type { CharacterGenre } from "@/lib/characterGenres";

export type RegisterPatchId = "none" | "A" | "B" | "C" | "D" | "step43";

/** Step 7.3 — dialogue register in genre_tone (validation baseline `none` only). */
export const LEGACY_GENRE_TONE_HINTS: Partial<Record<CharacterGenre, string>> = {
  "판타지/SF":
    "판타지 세계관 분위기 유지; 대사는 현대 한국 웹소설 존댓말(합니다·입니다·그렇습니다) — 하오·이오·소이다·하였소 금지",
  "로맨스 판타지":
    "판타지 분위기 유지; 감정은 행동·거리로 — 대사 register 현대 존댓말(합니다·입니다)",
  "현대 판타지": "현대+판타지; 대사 register 현대 존댓말(합니다·입니다·그렇습니다)",
  "무협/시대극": "시대·무협 분위기; 대사 하오·이오체 허용 — 캐릭터당 한 register, 턴 안 섞지 마라",
  인외: "세계관 감각 유지; 대사 register 현대 존댓말(합니다·입니다)",
  "현대/일상": "현대적 리듬; 대사 register 현대 존댓말(합니다·입니다·그렇습니다)",
  "학원/스포츠": "현대적 리듬; 대사 register 현대 존댓말(합니다·입니다)",
  시뮬레이션: "현대적 리듬; 대사 register 현대 존댓말(합니다·입니다)",
  "공포/추리": "짧은 문장·구체 디테일 — 대사 register 현대 존댓말; 감정 라벨 대신 감각",
  "코믹/액션": "빠른 비트 — 대사 register 현대 존댓말(합니다·입니다)",
  로맨스: "감정은 행동·거리 — 대사 register 현대 존댓말(합니다·입니다·해요)",
  BL: "감정은 행동·반응 — 대사 register 현대 존댓말",
  GL: "감정은 행동·반응 — 대사 register 현대 존댓말",
  기타: "대사 register 현대 한국 웹소설 존댓말(합니다·입니다)",
};

/** Production SoT — atmosphere only (Step 4.3 / Patch A winner). */
export const STEP43_GENRE_TONE_HINTS: Partial<Record<CharacterGenre, string>> = {
  "판타지/SF": "판타지 세계관의 분위기만 유지하되 번역투·고어체로 과장하지 마라",
  "로맨스 판타지":
    "판타지 분위기는 유지하고, 감정은 설명하지 말고 행동·거리감·호흡으로 표현한다",
  "현대 판타지": "현대와 판타지 분위기를 구분하되, 감정은 행동·감각으로",
  "무협/시대극": "시대·무협 분위기만 유지하되 고어체·번역투 과장 금지",
  인외: "세계관의 감각·설정에 맞게, 감정은 행동·반응으로",
  "현대/일상": "현대적 리듬 — 구체적 일상 디테일·행동으로",
  "학원/스포츠": "현대적 리듬 — 구체적 일상 디테일·행동으로",
  시뮬레이션: "현대적 리듬 — 구체적 일상 디테일·행동으로",
  "공포/추리": "짧은 문장·구체 디테일로 공포·긴장 — 감정 라벨 대신 감각",
  "코믹/액션": "빠른 비트 — 경쾌한 리듬 — 전투 구간·감정 설명 금지",
  로맨스: "감정은 설명하지 말고 행동·거리감·호흡으로 표현한다",
  BL: "감정은 설명하지 말고 행동·반응으로",
  GL: "감정은 설명하지 말고 행동·반응으로",
  기타: "장르 분위기 유지",
};

export function activeRegisterPatch(): RegisterPatchId | "production" {
  const v = process.env.REGISTER_PATCH?.trim();
  if (v === "none" || v === "A" || v === "B" || v === "C" || v === "D" || v === "step43") {
    return v;
  }
  return "production";
}

export function isRegisterPatch(id: RegisterPatchId): boolean {
  return activeRegisterPatch() === id;
}

/** Production default = STEP43; explicit REGISTER_PATCH=none = legacy baseline for audits. */
export function resolveGenreToneHints(): Partial<Record<CharacterGenre, string>> {
  if (process.env.REGISTER_PATCH?.trim() === "none") return LEGACY_GENRE_TONE_HINTS;
  return STEP43_GENRE_TONE_HINTS;
}

/** @deprecated use resolveGenreToneHints */
export function genreToneHintsForPatch(
  legacy: Partial<Record<CharacterGenre, string>>
): Partial<Record<CharacterGenre, string>> {
  void legacy;
  return resolveGenreToneHints();
}
