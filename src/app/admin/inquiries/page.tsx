import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import AdminInquiriesClient from "./AdminInquiriesClient";

export const dynamic = "force-dynamic";

export default async function AdminInquiriesPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?redirect=/admin/inquiries");

  return <AdminInquiriesClient />;
}
