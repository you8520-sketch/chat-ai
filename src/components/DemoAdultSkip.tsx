"use client";

import { useState } from "react";

/** 데모 환경: DB에 성인인증 완료 처리 */
export default function DemoAdultSkip({
  redirectTo = "/create",
  label = "데모: 성인인증 건너뛰기",
}: {
  redirectTo?: string;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function skip() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demo: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "데모 인증에 실패했습니다.");
        return;
      }
      if (redirectTo) {
        window.location.href = redirectTo;
      } else {
        window.location.reload();
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={skip}
        disabled={loading}
        className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.08] disabled:opacity-50"
      >
        {loading ? "처리 중…" : label}
      </button>
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
      <p className="mt-2 text-center text-xs text-zinc-500">
        로컬 데모 전용 · 실제 본인인증 없이 제작·NSFW 기능을 테스트합니다.
      </p>
    </div>
  );
}
