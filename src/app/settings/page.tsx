import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getPointBalance } from "@/lib/points";
import { isAdminUser } from "@/lib/adminAuth";
import { userHasCreatedCharacters } from "@/lib/creatorAccess";
import { getDb } from "@/lib/db";
import { getLatestNoticeId, getUnreadNoticeCount, hasUnreadNotices } from "@/lib/notices";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const db = getDb();
  const balance = getPointBalance(user.id);
  const adminRow = db
    .prepare("SELECT is_admin FROM users WHERE id = ?")
    .get(user.id) as { is_admin: number } | undefined;
  const isAdmin = isAdminUser({ ...user, is_admin: adminRow?.is_admin ?? 0 });
  const isCreator = userHasCreatedCharacters(user.id);

  const cookieStore = await cookies();
  const cookieReadId = Number(cookieStore.get("notice_read_id")?.value ?? 0);
  const readId = user.notice_last_read_id ?? cookieReadId;
  const latestNoticeId = getLatestNoticeId(db);
  const unreadNoticeCount = getUnreadNoticeCount(db, user.id, cookieReadId);
  const unreadNotice = hasUnreadNotices(latestNoticeId, readId, unreadNoticeCount);

  return (
    <SettingsClient
      user={{
        email: user.email,
        nickname: user.nickname,
        isAdult: !!user.is_adult,
        nsfwOn: !!user.nsfw_on,
        pref: (user.pref as "female" | "male" | null) ?? null,
        google: !!user.google_id,
        points: balance.total,
        paidPoints: balance.paid,
        freePoints: balance.free,
        isAdmin,
        isCreator,
      }}
      unreadNotice={unreadNotice}
    />
  );
}
