import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import { fetchGithubScheduledAutomationProjection } from "@/lib/adminAutomationReports";
import {
  listAdminOpsIncidents,
  mergeAdminOpsIncidents,
  projectGithubAutomationIncidents,
} from "@/lib/adminOpsInbox";
import { ADMIN_OPS_STUCK_EXECUTION_MINUTES } from "@/lib/adminOpsInboxShared";
import { getDb } from "@/lib/db";
import AdminOpsInboxClient from "./AdminOpsInboxClient";

export const dynamic = "force-dynamic";

export default async function AdminOpsPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?next=/admin/ops");

  const now = new Date();
  const localIncidents = listAdminOpsIncidents(getDb(), now, 500);
  const githubProjection = await fetchGithubScheduledAutomationProjection();
  const incidents = mergeAdminOpsIncidents(
    [localIncidents, projectGithubAutomationIncidents(githubProjection, now)],
    200
  );

  return (
    <AdminOpsInboxClient
      initialIncidents={incidents}
      stuckExecutionMinutes={ADMIN_OPS_STUCK_EXECUTION_MINUTES}
    />
  );
}
