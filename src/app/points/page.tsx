import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getAttendanceStatus } from "@/lib/attendance";
import { getPointBalance } from "@/lib/points";
import { getGiftableBalance } from "@/lib/pointGifts";
import {
  fetchFreeCreditLogsPage,
  fetchPaidCreditLogsPage,
  fetchUsageLogsPage,
} from "@/lib/pointLogsQuery";
import { isPortOneChargeEnabled, isPaymentsEnabled } from "@/lib/portoneConfig";
import PointsClient from "./PointsClient";

export const dynamic = "force-dynamic";

export default async function PointsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const usagePage = fetchUsageLogsPage(user.id, 1);
  const paidPage = fetchPaidCreditLogsPage(user.id, 1);
  const freePage = fetchFreeCreditLogsPage(user.id, 1);
  const balance = getPointBalance(user.id);
  const giftable = getGiftableBalance(user.id);
  const attendance = getAttendanceStatus(user.id);

  return (
    <PointsClient
      points={balance.total}
      paidPoints={balance.paid}
      freePoints={balance.free}
      giftableFreePoints={giftable.giftableFree}
      attendanceFreePoints={giftable.attendanceFree}
      usageLogs={usagePage.logs}
      usagePage={usagePage.page}
      usageTotal={usagePage.total}
      usageTotalPages={usagePage.totalPages}
      paidLogs={paidPage.logs}
      paidPage={paidPage.page}
      paidTotal={paidPage.total}
      paidTotalPages={paidPage.totalPages}
      freeLogs={freePage.logs}
      freePage={freePage.page}
      freeTotal={freePage.total}
      freeTotalPages={freePage.totalPages}
      initialCheckedIn={attendance.checkedInToday}
      initialAttendanceStreak={attendance.currentStreak}
      portoneEnabled={isPortOneChargeEnabled()}
      paymentsEnabled={isPaymentsEnabled()}
      userEmail={user.email}
      userNickname={user.nickname}
    />
  );
}
