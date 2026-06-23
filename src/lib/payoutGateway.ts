import { personNamesMatch } from "./withdrawalEligibility";

/** 지급대행 API(포트원·토스페이먼츠 등) 연동 래퍼 — 현재는 시뮬레이션 */

export type AccountHolderInquiryResult =
  | { ok: true; holder: string }
  | { ok: false; message: string };

export type PayoutTransferResult =
  | { ok: true; providerRef: string }
  | { ok: false; code: string; message: string };

/** 국내 은행명 → 표준 은행코드 (3자리) */
const BANK_CODE_BY_NAME: Record<string, string> = {
  국민: "004",
  국민은행: "004",
  kb: "004",
  신한: "088",
  신한은행: "088",
  우리: "020",
  우리은행: "020",
  하나: "081",
  하나은행: "081",
  nh: "011",
  농협: "011",
  nh농협: "011",
  ibk: "003",
  기업: "003",
  기업은행: "003",
  카카오: "090",
  카카오뱅크: "090",
  kbank: "089",
  케이뱅크: "089",
  토스: "092",
  토스뱅크: "092",
  새마을: "045",
  우체국: "071",
  sc: "023",
  sc제일: "023",
  제일: "023",
  citi: "027",
  씨티: "027",
};

export function resolveBankCode(bankName: string): string | null {
  const key = bankName.trim().toLowerCase().replace(/\s+/g, "");
  if (!key) return null;
  for (const [name, code] of Object.entries(BANK_CODE_BY_NAME)) {
    if (key.includes(name.toLowerCase().replace(/\s+/g, ""))) return code;
  }
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 계좌 예금주 조회 (가상 구현).
 * 실서비스에서는 포트원·토스페이먼츠 등 예금주 확인 API로 교체.
 */
export async function inquireAccountHolder(
  bankName: string,
  accountNo: string,
  expectedHolder: string
): Promise<AccountHolderInquiryResult> {
  const bankCode = resolveBankCode(bankName);
  const digits = accountNo.replace(/\D/g, "");
  if (!bankCode) {
    return { ok: false, message: "은행명을 확인할 수 없습니다." };
  }
  if (digits.length < 10) {
    return { ok: false, message: "계좌번호 형식을 확인해 주세요." };
  }

  await sleep(40 + Math.random() * 80);

  // 데모: 끝 4자리 0000 → 존재하지 않는 계좌
  if (digits.endsWith("0000")) {
    return { ok: false, message: "계좌를 확인할 수 없습니다. 은행·계좌번호를 다시 확인해 주세요." };
  }
  // 데모: 끝 4자리 9999 → 타인 명의 시뮬레이션
  if (digits.endsWith("9999")) {
    return {
      ok: false,
      message: "본인 명의 계좌만 출금 가능합니다. 예금주가 본인인증 실명과 일치하지 않습니다.",
    };
  }

  const holder = expectedHolder.trim();
  if (!personNamesMatch(holder, expectedHolder)) {
    return {
      ok: false,
      message: "계좌 예금주가 본인인증 실명과 일치하지 않습니다.",
    };
  }

  return { ok: true, holder };
}

/**
 * 외부 지급대행 API 호출 (가상 구현).
 * 실제 연동 시 포트원/토스페이먼츠 송금 API로 교체.
 */
export async function sendMoneyToUser(
  bankCode: string,
  accountNo: string,
  amount: number
): Promise<PayoutTransferResult> {
  const digits = accountNo.replace(/\D/g, "");
  if (!bankCode || bankCode.length < 3) {
    return { ok: false, code: "INVALID_BANK", message: "은행 코드를 확인할 수 없습니다." };
  }
  if (digits.length < 10) {
    return { ok: false, code: "INVALID_ACCOUNT", message: "계좌번호 형식 오류" };
  }
  if (amount <= 0) {
    return { ok: false, code: "INVALID_AMOUNT", message: "송금 금액 오류" };
  }

  await sleep(80 + Math.random() * 120);

  // 데모: 계좌 끝 4자리 0000 → 계좌 오류 시뮬레이션
  if (digits.endsWith("0000")) {
    return {
      ok: false,
      code: "ACCOUNT_ERROR",
      message: "수취 계좌 확인 실패 (예금주 불일치 또는 존재하지 않는 계좌)",
    };
  }

  if (process.env.PAYOUT_FORCE_FAIL === "1") {
    return { ok: false, code: "PROVIDER_ERROR", message: "지급대행사 일시 장애" };
  }

  const providerRef = `SIM-${bankCode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { ok: true, providerRef };
}
