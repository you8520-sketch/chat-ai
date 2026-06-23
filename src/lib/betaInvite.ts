/** Closed beta — comma-separated invite codes in BETA_INVITE_CODES. Empty = gate off (local dev). */

export function isBetaInviteGateEnabled(): boolean {
  return parseBetaInviteCodes().length > 0;
}

export function parseBetaInviteCodes(): string[] {
  const raw = process.env.BETA_INVITE_CODES?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((c) => normalizeInviteCode(c))
    .filter(Boolean);
}

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidBetaInviteCode(code: string | null | undefined): boolean {
  const codes = parseBetaInviteCodes();
  if (codes.length === 0) return true;
  const normalized = normalizeInviteCode(code ?? "");
  if (!normalized) return false;
  return codes.includes(normalized);
}

export const BETA_INVITE_INVALID_MESSAGE =
  "유효하지 않은 베타 초대 코드입니다. 테스터에게 받은 코드를 확인해 주세요.";

export const BETA_INVITE_REQUIRED_MESSAGE =
  "베타 테스트는 초대 코드가 필요합니다. 초대 코드를 입력한 뒤 가입해 주세요.";
