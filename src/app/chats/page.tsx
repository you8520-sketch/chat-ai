import { redirect } from "next/navigation";
import { AppPageShell } from "@/components/AppPageShell";
import ChatsPageGrid from "@/components/ChatsPageGrid";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { fetchUserChatSessions } from "@/lib/recentChats";

export const dynamic = "force-dynamic";

export default async function ChatsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/chats");

  const blurNsfw = !user.is_adult || !user.nsfw_on;
  const sessions = fetchUserChatSessions(getDb(), user.id, 100);

  const characterCount = new Set(sessions.map((s) => s.character_id)).size;

  return (
    <AppPageShell
      title="대화 목록"
      description={`${sessions.length}개 대화 · ${characterCount}명 캐릭터`}
      className="pb-16"
    >
      <ChatsPageGrid sessions={sessions} blurNsfw={blurNsfw} />
    </AppPageShell>
  );
}
