import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/adminAuth";
import { getDb } from "@/lib/db";
import { getHomePopupNotice } from "@/lib/homePopupNotice";
import AdminHomePopupNoticeClient from "./AdminHomePopupNoticeClient";

export const dynamic = "force-dynamic";

export default async function AdminHomePopupNoticePage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?redirect=/admin/home-popup-notice");

  const notice = getHomePopupNotice(getDb());
  return <AdminHomePopupNoticeClient initialNotice={notice} />;
}
