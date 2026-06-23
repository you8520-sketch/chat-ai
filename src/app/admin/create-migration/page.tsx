import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import AdminCreateMigrationClient from "./AdminCreateMigrationClient";

export const dynamic = "force-dynamic";

export default async function AdminCreateMigrationPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?redirect=/admin/create-migration");

  return <AdminCreateMigrationClient />;
}
