"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isChatRoomPathname } from "@/lib/chatDisplayPrefs";

/** 채팅방 경로일 때 html에 클래스 부여 — 모바일에서 글로벌 헤더·하단 네비 숨김용 */
export default function ChatRoomDocumentClass() {
  const pathname = usePathname();
  const inChatRoom = isChatRoomPathname(pathname);

  useEffect(() => {
    const root = document.documentElement;
    if (inChatRoom) root.classList.add("chat-room-active");
    else root.classList.remove("chat-room-active");
    return () => root.classList.remove("chat-room-active");
  }, [inChatRoom]);

  return null;
}
