import { redirect } from "next/navigation";
import { AppPageShell } from "@/components/AppPageShell";
import ChatsPageGrid from "@/components/ChatsPageGrid";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { fetchRecentTrpgCampaigns } from "@/lib/recentActivity";
import {
  fetchUserChatSessionsForRecentCharacters,
  RECENT_CHARACTER_LIST_LIMIT,
} from "@/lib/recentChats";

export const dynamic = "force-dynamic";

export default async function ChatsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/chats");

  const blurNsfw = !user.is_adult || !user.nsfw_on;
  const db = getDb();
  const sessions = fetchUserChatSessionsForRecentCharacters(
    db,
    user.id,
    RECENT_CHARACTER_LIST_LIMIT
  );
  const campaigns = fetchRecentTrpgCampaigns(db, user.id, RECENT_CHARACTER_LIST_LIMIT);

  const characterCount = new Set(sessions.map((s) => s.character_id)).size;

  return (
    <AppPageShell
      title="대화 목록"
      description={`${sessions.length}개 일반 대화 · ${characterCount}명 캐릭터 · ${campaigns.length}개 TRPG`}
      className="pb-16"
    >
      <ChatsPageGrid sessions={sessions} campaigns={campaigns} blurNsfw={blurNsfw} />
    </AppPageShell>
  );
}
