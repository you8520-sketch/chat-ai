/** 주민등록번호 입력·검증 (숫자 13자리) */

export function normalizeResidentNumber(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 13);
}

export function formatResidentNumberDisplay(raw: string): string {
  const digits = normalizeResidentNumber(raw);
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

export function isValidResidentNumber(raw: string): boolean {
  return normalizeResidentNumber(raw).length === 13;
}

/** CSV·화면용 마스킹 */
export function maskResidentNumber(raw: string): string {
  const d = normalizeResidentNumber(raw);
  if (d.length !== 13) return "";
  return `${d.slice(0, 6)}-${d[6]}******`;
}
