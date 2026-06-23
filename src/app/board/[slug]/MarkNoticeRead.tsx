"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** 공지 페이지 진입 시 읽음 처리 (쿠키는 Route Handler에서만 설정 가능) */
export default function MarkNoticeRead() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/notices/read", { method: "POST" })
      .then(() => router.refresh())
      .catch(() => {});
  }, [router]);

  return null;
}
