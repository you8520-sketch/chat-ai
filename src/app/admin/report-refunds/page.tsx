import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import AdminReportRefundsClient from "./AdminReportRefundsClient";

export const dynamic = "force-dynamic";

export default async function AdminReportRefundsPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?redirect=/admin/report-refunds");

  return <AdminReportRefundsClient />;
}
