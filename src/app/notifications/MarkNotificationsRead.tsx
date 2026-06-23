"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** 알림 페이지 진입 시 읽음 처리 */
export default function MarkNotificationsRead() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/notifications/read", { method: "POST" })
      .then(() => router.refresh())
      .catch(() => {});
  }, [router]);

  return null;
}
