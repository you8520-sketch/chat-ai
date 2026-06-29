import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import AdminCommentBannedWordsClient from "./AdminCommentBannedWordsClient";

export const dynamic = "force-dynamic";

export default async function AdminCommentBannedWordsPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?redirect=/admin/comment-banned-words");
  return <AdminCommentBannedWordsClient />;
}
