"use client";

import { useEffect } from "react";

type Props = {
  noticeId: number;
};

/** 공지 상세 진입 시 단건 읽음 처리 */
export default function MarkNoticeReadOnView({ noticeId }: Props) {
  useEffect(() => {
    fetch("/api/notices/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noticeId }),
    }).catch(() => {});
  }, [noticeId]);

  return null;
}
