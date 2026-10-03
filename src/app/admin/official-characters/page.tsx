import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import AdminOfficialCharactersClient from "./AdminOfficialCharactersClient";

export const dynamic = "force-dynamic";

export default async function AdminOfficialCharactersPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?redirect=/admin/official-characters");
  return <AdminOfficialCharactersClient />;
}
