import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getAttendanceStatus } from "@/lib/attendance";
import { getPointBalance } from "@/lib/points";
import {
  fetchFreeCreditLogsPage,
  fetchPaidCreditLogsPage,
  fetchUsageLogsPage,
} from "@/lib/pointLogsQuery";
import { processDueRenewals } from "@/lib/subscription";
import { isPortOneChargeEnabled } from "@/lib/portoneConfig";
import PointsClient from "./PointsClient";

export const dynamic = "force-dynamic";

export default async function PointsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  processDueRenewals();

  const refreshed = await getSessionUser();
  if (!refreshed) redirect("/login");

  const usagePage = fetchUsageLogsPage(refreshed.id, 1);
  const paidPage = fetchPaidCreditLogsPage(refreshed.id, 1);
  const freePage = fetchFreeCreditLogsPage(refreshed.id, 1);
  const balance = getPointBalance(refreshed.id);
  const attendance = getAttendanceStatus(refreshed.id);

  return (
    <PointsClient
      points={balance.total}
      paidPoints={balance.paid}
      freePoints={balance.free}
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
      portoneEnabled={isPortOneChargeEnabled()}
      userEmail={refreshed.email}
      userNickname={refreshed.nickname}
    />
  );
}
