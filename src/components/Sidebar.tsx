import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { fetchUserChatSessions } from "@/lib/recentChats";
import SidebarShell, { type SidebarNavItem } from "./SidebarShell";

const SIDEBAR_SESSION_LIMIT = 25;

export default async function Sidebar() {
  const user = await getSessionUser();
  const blurNsfw = !user?.is_adult || !user?.nsfw_on;
  const chatSessions = user ? fetchUserChatSessions(getDb(), user.id, SIDEBAR_SESSION_LIMIT) : [];

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
