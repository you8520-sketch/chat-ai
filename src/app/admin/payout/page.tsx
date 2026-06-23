import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import AdminPayoutExportClient from "./AdminPayoutExportClient";

export const dynamic = "force-dynamic";

export default async function AdminPayoutPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?next=/admin/payout");

  return <AdminPayoutExportClient />;
}
