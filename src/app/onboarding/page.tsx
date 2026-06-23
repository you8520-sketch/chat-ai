"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function choose(pref: "female" | "male" | null) {
    setLoading(true);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pref }),
    });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="mx-auto mt-24 max-w-md text-center">
      <h1 className="text-2xl font-black text-white">환영합니다! 🎉</h1>
      <p className="mt-2 text-gray-400">어떤 취향의 캐릭터를 보고 싶으세요?</p>
      <p className="text-xs text-gray-600">언제든 설정에서 변경할 수 있어요.</p>
      <div className="mt-8 grid grid-cols-3 gap-3">
        <button
          onClick={() => choose(null)}
          disabled={loading}
          className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-6 hover:bg-violet-500/20 disabled:opacity-50"
        >
          <p className="text-4xl">✨</p>
          <p className="mt-3 text-lg font-bold text-violet-300">전체</p>
          <p className="mt-1 text-xs text-gray-500">모든 캐릭터 보기</p>
        </button>
        <button
          onClick={() => choose("female")}
          disabled={loading}
          className="rounded-2xl border border-pink-500/30 bg-pink-500/10 p-6 hover:bg-pink-500/20 disabled:opacity-50"
        >
          <p className="text-4xl">🌸</p>
          <p className="mt-3 text-lg font-bold text-pink-300">여성향</p>
          <p className="mt-1 text-xs text-gray-500">여성 취향 캐릭터 위주로 보기</p>
        </button>
        <button
          onClick={() => choose("male")}
          disabled={loading}
          className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-6 hover:bg-sky-500/20 disabled:opacity-50"
        >
          <p className="text-4xl">⚡</p>
          <p className="mt-3 text-lg font-bold text-sky-300">남성향</p>
          <p className="mt-1 text-xs text-gray-500">남성 취향 캐릭터 위주로 보기</p>
        </button>
      </div>
    </div>
  );
}
