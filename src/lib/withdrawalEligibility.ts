import { getDb } from "./db";
import type { WithdrawalEligibility } from "./creatorShared";
import { isCreatorMonetizationEligible } from "./creatorMonetization";

export type { WithdrawalEligibility };

/** 비교용 실명 정규화 (공백·대소문자) */
export function normalizePersonName(name: string): string {
  return name.trim().replace(/\s+/g, "").toLowerCase();
}

export function personNamesMatch(a: string, b: string): boolean {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  return na.length > 0 && na === nb;
}

export function getWithdrawalEligibility(userId: number): WithdrawalEligibility {
  if (!isCreatorMonetizationEligible(userId)) {
    return {
      canWithdraw: false,
      verifiedRealName: "",
      blockReason: "공식 스튜디오 계정은 출금 대상이 아닙니다.",
    };
  }

  const row = getDb()
    .prepare("SELECT is_adult, real_name FROM users WHERE id = ?")
    .get(userId) as { is_adult: number; real_name: string } | undefined;

  if (!row) {
    return { canWithdraw: false, verifiedRealName: "", blockReason: "사용자 정보를 찾을 수 없습니다." };
  }

  const verifiedRealName = String(row.real_name ?? "").trim();

  if (!row.is_adult) {
    return {
      canWithdraw: false,
      verifiedRealName,
      blockReason: "출금은 성인인증(본인인증) 완료 후 가능합니다.",
    };
  }

  if (!verifiedRealName) {
    return {
      canWithdraw: false,
      verifiedRealName: "",
      blockReason: "본인인증 실명 정보가 없습니다. 성인인증을 완료해 주세요.",
    };
  }

  return { canWithdraw: true, verifiedRealName, blockReason: null };
}
