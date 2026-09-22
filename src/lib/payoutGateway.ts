import { personNamesMatch } from "./withdrawalEligibility";
import type {
  PayoutProviderLookupResult,
  PayoutProviderPort,
  PayoutProviderTransferInput,
  PayoutProviderTransferResult,
} from "@/lib/payoutProviderTypes";

/** 지급대행 API(포트원·토스페이먼츠 등) 연동 래퍼 — 현재는 시뮬레이션 */

export type AccountHolderInquiryResult =
  | { ok: true; holder: string }
  | { ok: false; message: string };

/** @deprecated Prefer PayoutProviderTransferResult via payoutExecution. */
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

type SimTransferRecord = {
  resultClass: "success" | "failed" | "unknown" | "pending";
  providerRef: string;
  code: string;
  message: string;
};

const simTransferLedger = new Map<string, SimTransferRecord>();

/** Test-only: reset simulation ledger between tests. */
export function resetPayoutGatewaySimulationForTests(): void {
  simTransferLedger.clear();
}

let payoutProviderOverride: PayoutProviderPort | null = null;

/** Test-only: inject deterministic fake provider. */
export function setPayoutProviderForTests(provider: PayoutProviderPort | null): void {
  payoutProviderOverride = provider;
}

export function getPayoutProviderPort(): PayoutProviderPort {
  if (payoutProviderOverride) return payoutProviderOverride;
  return simulationPayoutProvider;
}

/**
 * Simulation provider capability (code-verified, not production PortOne contract):
 * A. idempotency key accepted on transfer
 * B. caller-defined stable request id (wd-{withdrawalId})
 * C. same key returns prior terminal outcome (success/failed)
 * D. lookup(idempotencyKey) supported
 * E. lookup after simulated timeout supported
 * F. result classes: success | failed | unknown | pending
 * G. TEST_PAYOUT_UNKNOWN=1 → unknown (not failed)
 * H. in-memory ledger dedupes by idempotency key
 *
 * Real PortOne/Toss integration must re-audit A–H before production.
 */
const simulationPayoutProvider: PayoutProviderPort = {
  async transfer(input: PayoutProviderTransferInput): Promise<PayoutProviderTransferResult> {
    const existing = simTransferLedger.get(input.idempotencyKey);
    if (existing) {
      if (existing.resultClass === "success") {
        return {
          resultClass: "success",
          providerRef: existing.providerRef,
          deduplicated: true,
        };
      }
      if (existing.resultClass === "failed") {
        return {
          resultClass: "failed",
          code: existing.code,
          message: existing.message,
          deduplicated: true,
        };
      }
      if (existing.resultClass === "unknown") {
        return {
          resultClass: "unknown",
          code: existing.code,
          message: existing.message,
        };
      }
    }

    const digits = input.accountNo.replace(/\D/g, "");
    if (!input.bankCode || input.bankCode.length < 3) {
      const rec: SimTransferRecord = {
        resultClass: "failed",
        providerRef: "",
        code: "INVALID_BANK",
        message: "은행 코드를 확인할 수 없습니다.",
      };
      simTransferLedger.set(input.idempotencyKey, rec);
      return {
        resultClass: "failed",
        code: rec.code,
        message: rec.message,
        deduplicated: false,
      };
    }
    if (digits.length < 10) {
      const rec: SimTransferRecord = {
        resultClass: "failed",
        providerRef: "",
        code: "INVALID_ACCOUNT",
        message: "계좌번호 형식 오류",
      };
      simTransferLedger.set(input.idempotencyKey, rec);
      return {
        resultClass: "failed",
        code: rec.code,
        message: rec.message,
        deduplicated: false,
      };
    }
    if (input.amount <= 0) {
      const rec: SimTransferRecord = {
        resultClass: "failed",
        providerRef: "",
        code: "INVALID_AMOUNT",
        message: "송금 금액 오류",
      };
      simTransferLedger.set(input.idempotencyKey, rec);
      return {
        resultClass: "failed",
        code: rec.code,
        message: rec.message,
        deduplicated: false,
      };
    }

    await sleep(5);

    if (process.env.TEST_PAYOUT_UNKNOWN === "1") {
      const rec: SimTransferRecord = {
        resultClass: "unknown",
        providerRef: "",
        code: "PROVIDER_TIMEOUT",
        message: "지급대행 응답 시간 초과 — 송금 여부 불명",
      };
      simTransferLedger.set(input.idempotencyKey, rec);
      return { resultClass: "unknown", code: rec.code, message: rec.message };
    }

    if (digits.endsWith("0000")) {
      const rec: SimTransferRecord = {
        resultClass: "failed",
        providerRef: "",
        code: "ACCOUNT_ERROR",
        message: "수취 계좌 확인 실패 (예금주 불일치 또는 존재하지 않는 계좌)",
      };
      simTransferLedger.set(input.idempotencyKey, rec);
      return {
        resultClass: "failed",
        code: rec.code,
        message: rec.message,
        deduplicated: false,
      };
    }

    if (process.env.PAYOUT_FORCE_FAIL === "1") {
      const rec: SimTransferRecord = {
        resultClass: "failed",
        providerRef: "",
        code: "PROVIDER_ERROR",
        message: "지급대행사 일시 장애",
      };
      simTransferLedger.set(input.idempotencyKey, rec);
      return {
        resultClass: "failed",
        code: rec.code,
        message: rec.message,
        deduplicated: false,
      };
    }

    const providerRef = `SIM-${input.bankCode}-${input.idempotencyKey}`;
    simTransferLedger.set(input.idempotencyKey, {
      resultClass: "success",
      providerRef,
      code: "",
      message: "",
    });
    return { resultClass: "success", providerRef, deduplicated: false };
  },

  async lookup(idempotencyKey: string): Promise<PayoutProviderLookupResult> {
    const existing = simTransferLedger.get(idempotencyKey);
    if (!existing) return { status: "not_found" };
    switch (existing.resultClass) {
      case "success":
        return { status: "success", providerRef: existing.providerRef };
      case "failed":
        return { status: "failed", code: existing.code, message: existing.message };
      case "unknown":
        return { status: "unknown" };
      case "pending":
        return { status: "pending" };
      default: {
        const _exhaustive: never = existing.resultClass;
        return _exhaustive;
      }
    }
  },
};

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

  if (digits.endsWith("0000")) {
    return { ok: false, message: "계좌를 확인할 수 없습니다. 은행·계좌번호를 다시 확인해 주세요." };
  }
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
 * @deprecated Use payoutExecution + PayoutProviderPort. Kept for legacy callers/tests.
 */
export async function sendMoneyToUser(
  bankCode: string,
  accountNo: string,
  amount: number
): Promise<PayoutTransferResult> {
  const result = await getPayoutProviderPort().transfer({
    bankCode,
    accountNo,
    amount,
    idempotencyKey: `legacy-${bankCode}-${accountNo}-${amount}-${Date.now()}`,
    withdrawalId: 0,
  });
  if (result.resultClass === "success") {
    return { ok: true, providerRef: result.providerRef };
  }
  if (result.resultClass === "failed") {
    return { ok: false, code: result.code, message: result.message };
  }
  return {
    ok: false,
    code: result.code,
    message: result.message,
  };
}
