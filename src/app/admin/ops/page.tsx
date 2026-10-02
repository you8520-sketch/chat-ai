import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import { fetchGithubScheduledAutomationProjection } from "@/lib/adminAutomationReports";
import {
  listAdminOpsIncidents,
  mergeAdminOpsIncidents,
  projectFinanceAnomalyIncidents,
  projectGithubAutomationIncidents,
} from "@/lib/adminOpsInbox";
import { ADMIN_OPS_STUCK_EXECUTION_MINUTES } from "@/lib/adminOpsInboxShared";
import { buildAdminFinanceSummary, currentKstMonthKey } from "@/lib/adminFinance";
import { getDb } from "@/lib/db";
import { buildFinanceAnomalyReport } from "@/lib/financeAnomalyRadar";
import { buildMainRpPricingObservabilityProjection } from "@/lib/mainRpPricingObservability";
import AdminOpsInboxClient from "./AdminOpsInboxClient";

export const dynamic = "force-dynamic";

export default async function AdminOpsPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?next=/admin/ops");

  const now = new Date();
  const db = getDb();
  const localIncidents = listAdminOpsIncidents(db, now, 500);
  const financeSummary = buildAdminFinanceSummary(db, currentKstMonthKey(now.getTime()));
  const financePricing = buildMainRpPricingObservabilityProjection({ db, now });
  const financeReport = buildFinanceAnomalyReport({
    summary: financeSummary,
    pricing: financePricing,
    now,
  });
  const githubProjection = await fetchGithubScheduledAutomationProjection();
  const incidents = mergeAdminOpsIncidents(
    [
      localIncidents,
      projectFinanceAnomalyIncidents(financeReport, now),
      projectGithubAutomationIncidents(githubProjection, now),
    ],
    200
  );

  return (
    <AdminOpsInboxClient
      initialIncidents={incidents}
      stuckExecutionMinutes={ADMIN_OPS_STUCK_EXECUTION_MINUTES}
    />
  );
}
