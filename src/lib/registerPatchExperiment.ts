/**
 * Step 7.5 — Character dialogue register patch experiment (validation only).
 * REGISTER_PATCH env: none | A | B | C | D | step43
 * Production default (unset) = current behavior until winning patch is merged.
 */

import type { CharacterGenre } from "@/lib/characterGenres";

export type RegisterPatchId = "none" | "A" | "B" | "C" | "D" | "step43";

export function activeRegisterPatch(): RegisterPatchId {
  const v = process.env.REGISTER_PATCH?.trim();
  if (v === "A" || v === "B" || v === "C" || v === "D" || v === "step43") return v;
  return "none";
}

export function isRegisterPatch(id: RegisterPatchId): boolean {
  return activeRegisterPatch() === id;
}

/** Pre–Step 7.3 genre_tone (atmosphere only — no dialogue register). SoT: git 2dfcc32^ */
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

export function genreToneHintsForPatch(
  current: Partial<Record<CharacterGenre, string>>
): Partial<Record<CharacterGenre, string>> {
  const patch = activeRegisterPatch();
  if (patch === "A" || patch === "step43") return STEP43_GENRE_TONE_HINTS;
  return current;
}
