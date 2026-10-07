import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canShowFullBillingReceipt } from "@/lib/billingReceiptAccess";
import { getDb } from "@/lib/db";
import {
  NEXT_TURN_ESTIMATE_VERSION,
  type NextTurnEstimateRow,
} from "@/lib/mainRpNextTurnEstimate";
import { resolveMainRpNextTurnPickerEstimates } from "@/services/mainRpNextTurnEstimate";

function nextTurnAdminCalibration(row: NextTurnEstimateRow) {
  return {
    localAssembledInputTokens: row.localAssembledInputTokens,
    priorApiInputTokens: row.actualBillableInputTokens,
    priorAssembledInputTokens: row.priorAssembledInputTokens,
    calibrationSource: row.calibrationSource,
    predictedBillableInputTokens: row.predictedBillableInputTokens,
    expectedOutputTokens: row.expectedOutputTokens,
    outputBasis: row.outputBasis,
    outputHistorySampleCount: row.outputHistorySampleCount,
    displayPoints: row.displayPoints,
  };
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const chatId = Number(body.chatId);
  if (!Number.isInteger(chatId) || chatId <= 0) {
    return NextResponse.json({ error: "chatId가 필요합니다." }, { status: 400 });
  }

  const result = await resolveMainRpNextTurnPickerEstimates({
    chatId,
    user,
  });
  if (!result) {
    return NextResponse.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });
  }

  const adminRow = getDb()
    .prepare("SELECT is_admin FROM users WHERE id = ?")
    .get(user.id) as { is_admin: number } | undefined;
  const showAdminCalibration = canShowFullBillingReceipt({
    email: user.email,
    is_admin: adminRow?.is_admin ?? 0,
  });

  const calibration = showAdminCalibration
    ? Object.fromEntries(
        Object.entries(result.estimates).map(([modelId, row]) => [
          modelId,
          row ? nextTurnAdminCalibration(row) : null,
        ])
      )
    : undefined;

  return NextResponse.json({
    chatId: result.chatId,
    estimates: result.displayPoints,
    models: result.estimates,
    lastVisibleAssistantChars: result.lastVisibleAssistantChars,
    source: result.source,
    version: NEXT_TURN_ESTIMATE_VERSION,
    ...(calibration ? { calibration } : {}),
  });
}
