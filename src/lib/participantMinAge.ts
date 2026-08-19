import type { AdultStatus } from "@/lib/adultSceneRouting";

/** Generous upper bound for fictional character ages (integer years). */
export const PARTICIPANT_MIN_AGE_MAX = 999;

export const ADULT_SCENE_MIN_AGE = 19;

export type ParsedParticipantMinAge =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

export function parseParticipantMinAgeInput(value: unknown): ParsedParticipantMinAge {
  if (value == null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return { ok: false, error: "나이는 정수로 입력해 주세요." };
    }
    return { ok: true, value };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { ok: true, value: null };
    if (!/^\d+$/.test(trimmed)) {
      return { ok: false, error: "나이는 정수로 입력해 주세요." };
    }
    return { ok: true, value: Number(trimmed) };
  }
  return { ok: false, error: "나이는 정수로 입력해 주세요." };
}

export function validateParticipantMinAgeValue(age: number): string | null {
  if (!Number.isInteger(age)) return "나이는 정수로 입력해 주세요.";
  if (age <= 0) return "나이는 1 이상이어야 합니다.";
  if (age > PARTICIPANT_MIN_AGE_MAX) {
    return `나이는 ${PARTICIPANT_MIN_AGE_MAX} 이하여야 합니다.`;
  }
  return null;
}

export function deriveAdultStatusFromParticipantMinAge(age: number): AdultStatus {
  return age >= ADULT_SCENE_MIN_AGE ? "confirmed" : "minor";
}

export function validateNsfwParticipantAgeContract(input: {
  nsfw: boolean;
  participantMinAge: number | null;
}): string | null {
  if (!input.nsfw) return null;
  if (input.participantMinAge == null) {
    return "성인용 캐릭터로 설정하려면 나이를 입력해 주세요.";
  }
  if (input.participantMinAge < ADULT_SCENE_MIN_AGE) {
    return "성인용 캐릭터/시뮬레이션은 성인 장면 참여 가능 인물이 모두 만 19세 이상이어야 합니다.";
  }
  return null;
}

export function resolveParticipantMinAgeForSave(input: {
  bodyValue: unknown;
  existingValue?: number | null;
  requireStructuredAge?: boolean;
}): ParsedParticipantMinAge {
  const parsed = parseParticipantMinAgeInput(input.bodyValue);
  if (!parsed.ok) return parsed;

  let resolved = parsed.value;
  if (resolved == null && input.existingValue != null) {
    resolved = input.existingValue;
  }

  if (input.requireStructuredAge && resolved == null) {
    return { ok: false, error: "캐릭터 나이를 입력해 주세요." };
  }

  if (resolved != null) {
    const rangeError = validateParticipantMinAgeValue(resolved);
    if (rangeError) return { ok: false, error: rangeError };
  }

  return { ok: true, value: resolved };
}
