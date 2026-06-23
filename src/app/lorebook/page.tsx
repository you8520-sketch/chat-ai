import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import LorebookManageClient from "@/components/LorebookManageClient";

export const dynamic = "force-dynamic";

export default async function LorebookManagePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/lorebook");

  return <LorebookManageClient />;
}
