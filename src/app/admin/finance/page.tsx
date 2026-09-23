import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import { buildAdminFinanceSummary, currentKstMonthKey } from "@/lib/adminFinance";
import { getDb } from "@/lib/db";
import { listSchedulerRunOverview } from "@/lib/schedulerRunRegistry";
import AdminFinanceClient from "./AdminFinanceClient";

export const dynamic = "force-dynamic";

export default async function AdminFinancePage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?next=/admin/finance");
  const db = getDb();
  const summary = buildAdminFinanceSummary(db, currentKstMonthKey());
  const schedulerRuns = listSchedulerRunOverview(db);
  return (
    <AdminFinanceClient
      initialSummary={summary}
      initialSchedulerRuns={schedulerRuns}
    />
  );
}
