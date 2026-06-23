"use client";

import { useEffect, useState } from "react";
import { formatPoints } from "@/lib/billingDisplay";

export default function ChatToast({ message }: { message: string | null }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!message || !visible) return null;

  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 max-w-sm -translate-x-1/2 px-4">
      <div className="rounded-xl border border-emerald-500/30 bg-[#1a2e1f]/95 px-4 py-3 text-center text-sm font-semibold text-emerald-200 shadow-xl shadow-black/40 backdrop-blur-sm">
        💸 {message}
      </div>
    </div>
  );
}

export function formatRefundToast(amount: number): string {
  return `오류가 확인되어 ${formatPoints(amount)}P가 즉시 환불되었습니다!`;
}
