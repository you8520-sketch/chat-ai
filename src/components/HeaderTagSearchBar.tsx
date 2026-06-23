"use client";

import { usePathname } from "next/navigation";
import TagSearchBar from "@/components/TagSearchBar";

const CHAT_ROOM_PATH = /^\/chat\/\d+/;

type Props = {
  className?: string;
};

/** 채팅방(/chat/:id)에서는 검색바·검색 버튼 숨김 */
export default function HeaderTagSearchBar({ className }: Props) {
  const pathname = usePathname() ?? "";
  if (CHAT_ROOM_PATH.test(pathname)) return null;
  return <TagSearchBar compact className={className} />;
}
