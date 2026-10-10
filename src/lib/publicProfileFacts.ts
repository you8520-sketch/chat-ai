/**
 * 공개 프로필 기본 인적사항(성별·키·몸무게)의 단일 reader.
 *
 * DATA GATE: 현재 구조에는 공개용으로 승인된 필드가 없다.
 * - `characters.gender`는 "부가 설정 (비공개)" — AI 묘사용 프롬프트 입력이며 공개 동의가 없다.
 * - 키·몸무게는 어떤 필드에도 없다.
 * 비공개 프롬프트·설정 텍스트를 파싱해 값을 만들지 않는다. 공개 입력 필드가 별도 데이터 FEATURE로
 * 승인되면 `readPublicProfileFacts`만 그 컬럼을 읽도록 바꾸면 카드·reveal·프로필이 함께 반응한다.
 * 값이 없는 항목은 목록에서 빠지고, 전부 없으면 인적사항 영역 자체가 그려지지 않는다.
 */

export type PublicProfileFactKey = "gender" | "height" | "weight";
export type PublicProfileFact = { key: PublicProfileFactKey; label: string; value: string };

export type PublicProfileFactsInput = {
  gender?: "male" | "female" | null;
  heightCm?: number | null;
  weightKg?: number | null;
};

const HEIGHT_RANGE_CM = [50, 260] as const;
const WEIGHT_RANGE_KG = [10, 400] as const;
const FACT_ORDER: readonly PublicProfileFactKey[] = ["gender", "height", "weight"];
const FACT_LABELS: Record<PublicProfileFactKey, string> = { gender: "성별", height: "키", weight: "몸무게" };

function inRange(n: number | null | undefined, [min, max]: readonly [number, number]): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
}

/** 값이 유효한 항목만 고정 순서(성별·키·몸무게)로 돌려준다. */
export function normalizePublicProfileFacts(input: PublicProfileFactsInput): PublicProfileFact[] {
  const facts: PublicProfileFact[] = [];
  for (const key of FACT_ORDER) {
    switch (key) {
      case "gender":
        if (input.gender === "male") facts.push({ key, label: FACT_LABELS[key], value: "남성" });
        else if (input.gender === "female") facts.push({ key, label: FACT_LABELS[key], value: "여성" });
        break;
      case "height":
        if (inRange(input.heightCm, HEIGHT_RANGE_CM)) {
          facts.push({ key, label: FACT_LABELS[key], value: `${Math.round(input.heightCm)}cm` });
        }
        break;
      case "weight":
        if (inRange(input.weightKg, WEIGHT_RANGE_KG)) {
          facts.push({ key, label: FACT_LABELS[key], value: `${Math.round(input.weightKg)}kg` });
        }
        break;
      default: {
        const _exhaustive: never = key;
        return _exhaustive;
      }
    }
  }
  return facts;
}

/** 캐릭터 한 명의 공개 인적사항. 공개 입력 필드가 승인되기 전까지 항상 빈 목록이다. */
export function readPublicProfileFacts(_characterId: number): PublicProfileFact[] {
  return normalizePublicProfileFacts({});
}

/** 카드 마커(`data-character-facts`)용 직렬화. 정규화된 값만 허용한다. */
export function serializePublicProfileFacts(facts: readonly PublicProfileFact[]): string {
  return JSON.stringify(facts.map(({ key, label, value }) => ({ key, label, value })));
}

export function parsePublicProfileFacts(raw: string | null | undefined): PublicProfileFact[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: PublicProfileFact[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const { key, label, value } = item as Record<string, unknown>;
      if (typeof key !== "string" || !FACT_ORDER.includes(key as PublicProfileFactKey)) continue;
      if (typeof label !== "string" || typeof value !== "string" || !label.trim() || !value.trim()) continue;
      out.push({ key: key as PublicProfileFactKey, label: label.trim(), value: value.trim() });
    }
    return out.slice(0, FACT_ORDER.length);
  } catch {
    return [];
  }
}

/** `FILE 001` 형태의 기록 번호. 캐릭터 id에서만 파생하며 별도 정보를 만들지 않는다. */
export function formatRecordFileLabel(characterId: number): string {
  const n = Number.isSafeInteger(characterId) && characterId > 0 ? characterId : 0;
  return `FILE ${String(n).padStart(3, "0")}`;
}
