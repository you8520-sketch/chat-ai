"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import GoogleButton from "@/components/GoogleButton";
import GoogleAuthError from "@/components/GoogleAuthError";
import DemoLoginButton from "@/components/DemoLoginButton";

function LoginForm({ showDemo }: { showDemo: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirect") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <div className="mx-auto mt-20 max-w-sm rounded-2xl border border-white/5 bg-[#131626] p-8">
      <h1 className="text-xl font-black text-white">로그인</h1>
      {redirectTo !== "/" && (
        <p className="mt-1 text-xs text-gray-500">
          {redirectTo.startsWith("/character/")
            ? "로그인 후 캐릭터를 이용할 수 있습니다. 성인용 캐릭터는 추가로 성인인증이 필요합니다."
            : "로그인 후 요청하신 페이지로 이동합니다."}
        </p>
      )}
      <div className="mt-6">
        <GoogleButton label="Google로 계속하기" redirect={redirectTo} />
        <Suspense>
          <GoogleAuthError />
        </Suspense>
        <div className="my-4 flex items-center gap-3 text-xs text-gray-600">
          <span className="h-px flex-1 bg-white/10" />또는<span className="h-px flex-1 bg-white/10" />
        </div>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="이메일"
          className="w-full rounded-xl bg-[#0e1120] px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500"
        />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          className="w-full rounded-xl bg-[#0e1120] px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500"
        />
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          disabled={loading}
          className="w-full rounded-xl bg-violet-600 py-3 font-bold text-white disabled:opacity-50"
        >
          로그인
        </button>
      </form>
      {showDemo && (
        <DemoLoginButton redirectTo={redirectTo === "/" ? "/studio" : redirectTo} />
      )}
      <p className="mt-4 text-center text-sm text-gray-500">
        계정이 없나요?{" "}
        <Link href="/signup" className="text-violet-400 hover:underline">
          회원가입
        </Link>
      </p>
    </div>
  );
}

export default function LoginClient({ showDemo }: { showDemo: boolean }) {
  return (
    <Suspense>
      <LoginForm showDemo={showDemo} />
    </Suspense>
  );
}
