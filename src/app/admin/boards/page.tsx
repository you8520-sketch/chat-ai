import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import AdminBoardsClient from "./AdminBoardsClient";

export const dynamic = "force-dynamic";

export default async function AdminBoardsPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?redirect=/admin/boards");

  return <AdminBoardsClient />;
}
