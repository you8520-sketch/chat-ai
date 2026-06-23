import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getPointBalance } from "@/lib/points";
import { isAdminUser } from "@/lib/adminAuth";
import { getDb } from "@/lib/db";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const balance = getPointBalance(user.id);
  const adminRow = getDb()
    .prepare("SELECT is_admin FROM users WHERE id = ?")
    .get(user.id) as { is_admin: number } | undefined;
  const isAdmin = isAdminUser({ ...user, is_admin: adminRow?.is_admin ?? 0 });

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
      }}
    />
  );
}
