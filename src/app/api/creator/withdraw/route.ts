import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  WITHDRAWAL_MIN_CP,
  calcWithdrawalBreakdown,
  getCreatorPointsBalance,
  requestCreatorWithdrawal,
} from "@/lib/creatorPoints";
import { userHasCreatedCharacters } from "@/lib/creatorAccess";
import { encryptSensitive } from "@/lib/fieldEncryption";
import { inquireAccountHolder } from "@/lib/payoutGateway";
import { isValidResidentNumber, normalizeResidentNumber } from "@/lib/residentId";
import { getWithdrawalEligibility } from "@/lib/withdrawalEligibility";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!userHasCreatedCharacters(user.id)) {
    return NextResponse.json(
      { error: "캐릭터를 제작한 크리에이터만 출금할 수 있습니다." },
      { status: 403 }
    );
  }

  const eligibility = getWithdrawalEligibility(user.id);
  if (!eligibility.canWithdraw) {
    return NextResponse.json(
      { error: eligibility.blockReason ?? "출금 신청 조건을 충족하지 않습니다." },
      { status: 403 }
    );
  }

  const body = await req.json();
  const amount = Number(body.amount);
  const bankName = String(body.bankName ?? "");
  const accountNumber = String(body.accountNumber ?? "");
  const residentNumber = String(body.residentNumber ?? "");
  const taxConsent = Boolean(body.taxConsent);

  if (!amount || amount < WITHDRAWAL_MIN_CP) {
    return NextResponse.json(
      { error: `${WITHDRAWAL_MIN_CP.toLocaleString()} CP 이상부터 출금 신청이 가능합니다.` },
      { status: 400 }
    );
  }

  if (!taxConsent) {
    return NextResponse.json(
      { error: "원천징수 신고를 위한 주민등록번호 수집·이용에 동의해 주세요." },
      { status: 400 }
    );
  }

  if (!isValidResidentNumber(residentNumber)) {
    return NextResponse.json(
      { error: "주민등록번호 13자리를 올바르게 입력해 주세요." },
      { status: 400 }
    );
  }

  if (!bankName.trim() || !accountNumber.trim()) {
    return NextResponse.json({ error: "은행명과 계좌번호를 입력해 주세요." }, { status: 400 });
  }

  const accountCheck = await inquireAccountHolder(
    bankName,
    accountNumber,
    eligibility.verifiedRealName
  );
  if (!accountCheck.ok) {
    return NextResponse.json({ error: accountCheck.message }, { status: 400 });
  }

  try {
    const residentPlain = normalizeResidentNumber(residentNumber);
    const result = requestCreatorWithdrawal(
      user.id,
      amount,
      {
        bankName,
        accountNumber,
        accountHolder: eligibility.verifiedRealName,
      },
      {
        residentNumberEncrypted: encryptSensitive(residentPlain),
        taxConsent: true,
        verifiedRealName: eligibility.verifiedRealName,
      }
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "출금 신청 실패" }, { status: 400 });
  }
}

/** 인출 예상 금액 미리보기 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!userHasCreatedCharacters(user.id)) {
    return NextResponse.json(
      { error: "캐릭터를 제작한 크리에이터만 이용할 수 있습니다." },
      { status: 403 }
    );
  }

  const amount = Number(new URL(req.url).searchParams.get("amount") ?? "0");
  const eligibility = getWithdrawalEligibility(user.id);

  if (!amount || amount <= 0) {
    return NextResponse.json({
      balance: getCreatorPointsBalance(user.id),
      breakdown: null,
      withdrawal: eligibility,
    });
  }

  return NextResponse.json({
    balance: getCreatorPointsBalance(user.id),
    breakdown: calcWithdrawalBreakdown(amount),
    withdrawal: eligibility,
  });
}
