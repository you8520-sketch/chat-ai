import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import AdminBetaFreePointClient from "./AdminBetaFreePointClient";

export const dynamic = "force-dynamic";

export default async function AdminBetaFreePointPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?redirect=/admin/beta-free-points");

  return <AdminBetaFreePointClient />;
}
