import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  fetchLatestSessionsPerCharacter,
  RECENT_CHARACTER_LIST_LIMIT,
} from "@/lib/recentChats";
import SidebarShell, { type SidebarNavItem } from "./SidebarShell";

/** 캐릭터 기준 — 분기 세션이 많아도 다른 캐릭터가 밀려나지 않음 */
const SIDEBAR_CHARACTER_LIMIT = RECENT_CHARACTER_LIST_LIMIT;

export default async function Sidebar() {
  const user = await getSessionUser();
  const blurNsfw = !user?.is_adult || !user?.nsfw_on;
  const chatSessions = user
    ? fetchLatestSessionsPerCharacter(getDb(), user.id, SIDEBAR_CHARACTER_LIMIT)
    : [];

  const navItems: SidebarNavItem[] = [];
  if (user) {
    navItems.push({ href: "/chats", icon: "chat", label: "대화 목록" });
  } else {
    navItems.push({ href: "/login?redirect=/chats", icon: "chat", label: "대화 목록" });
  }
  navItems.push(
    { href: "/persona", icon: "persona", label: "페르소나·노트" },
    { href: "/studio", icon: "studio", label: "제작" },
    { href: "/creator", icon: "creator", label: "크리에이터" }
  );
  if (!user?.is_adult) {
    navItems.push({ href: "/verify", icon: "verify", label: "성인인증" });
  }

  return (
    <SidebarShell
      user={user ? { nickname: user.nickname } : null}
      chatSessions={chatSessions}
      blurNsfw={blurNsfw}
      navItems={navItems}
    />
  );
}
