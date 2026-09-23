import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import { listAdminOpsIncidents } from "@/lib/adminOpsInbox";
import { ADMIN_OPS_STUCK_EXECUTION_MINUTES } from "@/lib/adminOpsInboxShared";
import { getDb } from "@/lib/db";
import AdminOpsInboxClient from "./AdminOpsInboxClient";

export const dynamic = "force-dynamic";

export default async function AdminOpsPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?next=/admin/ops");

  const incidents = listAdminOpsIncidents(getDb());

  return (
    <AdminOpsInboxClient
      initialIncidents={incidents}
      stuckExecutionMinutes={ADMIN_OPS_STUCK_EXECUTION_MINUTES}
    />
  );
}
