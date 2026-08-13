import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import AdminCharacterModerationClient from "./AdminCharacterModerationClient";

export const dynamic = "force-dynamic";

export default async function AdminCharacterModerationPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?redirect=/admin/character-moderation");
  return <AdminCharacterModerationClient />;
}
