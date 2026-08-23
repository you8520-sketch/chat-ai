import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import AdminCommentReportsClient from "./AdminCommentReportsClient";

export const dynamic = "force-dynamic";

export default async function AdminCommentReportsPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?redirect=/admin/comment-reports");
  return <AdminCommentReportsClient />;
}
