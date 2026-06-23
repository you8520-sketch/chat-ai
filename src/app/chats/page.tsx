import { redirect } from "next/navigation";
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
    <div className="w-full pb-16">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-black text-white sm:text-3xl">대화 목록</h1>
        <p className="mt-2 text-sm text-gray-500 sm:text-base">
          {sessions.length}개 대화 · {characterCount}명 캐릭터
        </p>
      </div>

      <ChatsPageGrid sessions={sessions} blurNsfw={blurNsfw} />
    </div>
  );
}
