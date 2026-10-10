/**
 * 제작자 선택형 공개 인물 정보 — 유일한 공개 여부 owner.
 * 카드·공개 프로필·Kinetic Assembly는 이 모듈의 view만 소비한다.
 * `characters.gender`는 값 owner로 남기고, 여기서는 공개 동의만 판단한다.
 * 세계관 공개 표시명은 제작자가 직접 입력한 문자열만 사용하며
 * `worlds.name` / `world_shares.name` / `characters.world`에서 복사·추출하지 않는다.
 */

import { GENDER_LABELS, parseCharacterGender } from "@/lib/characterGender";

export const WORLD_PUBLIC_NAME_MAX = 40;
export const HEIGHT_CM_MIN = 1;
export const HEIGHT_CM_MAX = 300;
export const WEIGHT_KG_MIN = 1;
export const WEIGHT_KG_MAX = 500;

export type PublicDossierStored = {
  genderPublic: boolean;
  heightCm: number | null;
  weightKg: number | null;
  worldPublicName: string;
  worldPublic: boolean;
};

export type PublicDossierView = {
  world: string | null;
  gender: string | null;
  heightCm: number | null;
  weightKg: number | null;
};

export type PublicDossierLineKey = "world" | "gender" | "height" | "weight";

export type PublicDossierLine = {
  key: PublicDossierLineKey;
  label: string;
  value: string;
};

export type PublicDossierRow = {
  gender?: unknown;
  gender_public?: unknown;
  height_cm?: unknown;
  weight_kg?: unknown;
  world_public_name?: unknown;
  world_public?: unknown;
};

export function parsePublicFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function parseWorldPublicName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, WORLD_PUBLIC_NAME_MAX);
}

function parseOptionalPublicInt(
  value: unknown,
  opts: { min: number; max: number; label: string; unit: string },
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true, value: null };
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      return { ok: false, error: `${opts.label}는 정수(${opts.unit})로 입력해 주세요.` };
    }
    if (value < opts.min || value > opts.max) {
      return {
        ok: false,
        error: `${opts.label}는 ${opts.min}–${opts.max}${opts.unit} 사이여야 합니다.`,
      };
    }
    return { ok: true, value };
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (raw === "") return { ok: true, value: null };
    if (!/^\d+$/.test(raw)) {
      return {
        ok: false,
        error: `${opts.label}는 숫자만 입력해 주세요. 문자·소수점·단위는 사용할 수 없습니다.`,
      };
    }
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < opts.min || n > opts.max) {
      return {
        ok: false,
        error: `${opts.label}는 ${opts.min}–${opts.max}${opts.unit} 사이여야 합니다.`,
      };
    }
    return { ok: true, value: n };
  }
  return {
    ok: false,
    error: `${opts.label}는 숫자만 입력해 주세요. 문자·소수점·단위는 사용할 수 없습니다.`,
  };
}

export function parsePublicDossierFromBody(
  b: Record<string, unknown>,
): { ok: true; data: PublicDossierStored } | { ok: false; error: string } {
  const height = parseOptionalPublicInt(b.height_cm ?? b.heightCm, {
    min: HEIGHT_CM_MIN,
    max: HEIGHT_CM_MAX,
    label: "키",
    unit: "cm",
  });
  if (!height.ok) return height;
  const weight = parseOptionalPublicInt(b.weight_kg ?? b.weightKg, {
    min: WEIGHT_KG_MIN,
    max: WEIGHT_KG_MAX,
    label: "몸무게",
    unit: "kg",
  });
  if (!weight.ok) return weight;
  const worldPublicName = parseWorldPublicName(b.world_public_name ?? b.worldPublicName);
  return {
    ok: true,
    data: {
      genderPublic: parsePublicFlag(b.gender_public ?? b.genderPublic),
      heightCm: height.value,
      weightKg: weight.value,
      worldPublicName,
      worldPublic: parsePublicFlag(b.world_public ?? b.worldPublic),
    },
  };
}

export function emptyPublicDossierView(): PublicDossierView {
  return { world: null, gender: null, heightCm: null, weightKg: null };
}

/** 공개 동의된 값만 돌려준다. 비공개 gender·세계관 원문은 절대 포함하지 않는다. */
export function readPublicDossier(row: PublicDossierRow | null | undefined): PublicDossierView {
  if (!row) return emptyPublicDossierView();
  const worldName = parseWorldPublicName(row.world_public_name);
  const gender = parsePublicFlag(row.gender_public) ? parseCharacterGender(row.gender) : null;
  const height =
    typeof row.height_cm === "number" && Number.isInteger(row.height_cm) ? row.height_cm : null;
  const weight =
    typeof row.weight_kg === "number" && Number.isInteger(row.weight_kg) ? row.weight_kg : null;
  return {
    world: parsePublicFlag(row.world_public) && worldName ? worldName : null,
    gender: gender ? GENDER_LABELS[gender] : null,
    heightCm:
      height != null && height >= HEIGHT_CM_MIN && height <= HEIGHT_CM_MAX ? height : null,
    weightKg:
      weight != null && weight >= WEIGHT_KG_MIN && weight <= WEIGHT_KG_MAX ? weight : null,
  };
}

export function formatPublicHeight(cm: number): string {
  return `${cm}cm`;
}

export function formatPublicWeight(kg: number): string {
  return `${kg}kg`;
}

export function publicDossierLines(view: PublicDossierView): PublicDossierLine[] {
  const lines: PublicDossierLine[] = [];
  if (view.world) lines.push({ key: "world", label: "WORLD", value: view.world });
  if (view.gender) lines.push({ key: "gender", label: "성별", value: view.gender });
  if (view.heightCm != null) {
    lines.push({ key: "height", label: "키", value: formatPublicHeight(view.heightCm) });
  }
  if (view.weightKg != null) {
    lines.push({ key: "weight", label: "몸무게", value: formatPublicWeight(view.weightKg) });
  }
  return lines;
}

export function publicDossierHasItems(view: PublicDossierView): boolean {
  return publicDossierLines(view).length > 0;
}

export function publicDossierRecordLines(view: PublicDossierView): PublicDossierLine[] {
  return publicDossierLines(view).filter((line) => line.key !== "world");
}

/** 카드 DOM에는 공개 동의된 값만 붙인다. 비공개 gender·세계관은 속성에 쓰지 않는다. */
export function publicDossierRevealAttrs(view: PublicDossierView): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (view.world) attrs["data-character-world"] = view.world;
  if (view.gender) attrs["data-character-gender"] = view.gender;
  if (view.heightCm != null) attrs["data-character-height"] = formatPublicHeight(view.heightCm);
  if (view.weightKg != null) attrs["data-character-weight"] = formatPublicWeight(view.weightKg);
  return attrs;
}

export function readPublicDossierFromCard(card: {
  getAttribute(name: string): string | null;
}): PublicDossierView {
  const world = (card.getAttribute("data-character-world") ?? "").trim();
  const gender = (card.getAttribute("data-character-gender") ?? "").trim();
  const heightRaw = (card.getAttribute("data-character-height") ?? "").trim();
  const weightRaw = (card.getAttribute("data-character-weight") ?? "").trim();
  const height = /^(\d+)cm$/.exec(heightRaw);
  const weight = /^(\d+)kg$/.exec(weightRaw);
  return {
    world: world || null,
    gender: gender || null,
    heightCm: height ? Number(height[1]) : null,
    weightKg: weight ? Number(weight[1]) : null,
  };
}

export function publicDossierSqlValues(
  data: PublicDossierStored,
): [number, number | null, number | null, string, number] {
  return [
    data.genderPublic ? 1 : 0,
    data.heightCm,
    data.weightKg,
    data.worldPublicName,
    data.worldPublic ? 1 : 0,
  ];
}
