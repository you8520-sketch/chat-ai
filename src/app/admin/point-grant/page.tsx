import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import AdminPointGrantClient from "./AdminPointGrantClient";

export const dynamic = "force-dynamic";

export default async function AdminPointGrantPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?redirect=/admin/point-grant");

  return <AdminPointGrantClient />;
}
