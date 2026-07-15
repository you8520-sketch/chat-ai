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
    const isCharacterIntroEmbed =
      /^\/character\/\d+/.test(pathname) &&
      new URLSearchParams(window.location.search).get("embed") === "chat-intro";
    if (inChatRoom) root.classList.add("chat-room-active");
    else root.classList.remove("chat-room-active");
    if (isCharacterIntroEmbed) root.classList.add("character-intro-embed-active");
    else root.classList.remove("character-intro-embed-active");
    return () => {
      root.classList.remove("chat-room-active");
      root.classList.remove("character-intro-embed-active");
    };
  }, [inChatRoom, pathname]);

  return null;
}
