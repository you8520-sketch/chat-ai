"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DemoLoginButton({ redirectTo = "/create" }: { redirectTo?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function login() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/demo-login", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "데모 로그인에 실패했습니다.");
        return;
      }
      router.push(redirectTo);
      router.refresh();
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
        onClick={login}
        disabled={loading}
        className="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/10 py-3 text-sm font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
      >
        {loading ? "로그인 중…" : "데모: 바로 제작 화면 들어가기"}
      </button>
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
      <p className="mt-2 text-center text-[11px] text-gray-600">
        로컬 개발 전용 · demo@playai.local / 성인인증 자동 완료
      </p>
    </div>
  );
}
