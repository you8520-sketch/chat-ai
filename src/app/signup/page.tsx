"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import GoogleButton from "@/components/GoogleButton";
import GoogleAuthError from "@/components/GoogleAuthError";
import { SIGNUP_BONUS_POINTS } from "@/lib/plans";

function SignupForm() {
  const router = useRouter();
  const [form, setForm] = useState<{
    email: string;
    nickname: string;
    password: string;
    pref: "" | "female" | "male" | "all";
  }>({
    email: "",
    nickname: "",
    password: "",
    pref: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.pref) {
      setError("취향(전체/여성향/남성향)을 선택해주세요.");
      return;
    }
    setLoading(true);
    setError("");
    const { pref, ...rest } = form;
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...rest,
        pref: pref === "all" ? null : pref,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    router.push("/");
    router.refresh();
  }

  const cls =
    "w-full rounded-xl bg-[#0e1120] px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500";

  return (
    <div className="mx-auto mt-20 max-w-sm rounded-2xl border border-white/5 bg-[#131626] p-8">
      <h1 className="text-xl font-black text-white">회원가입</h1>
      <p className="mt-1 text-sm text-violet-300">
        가입 즉시 {SIGNUP_BONUS_POINTS.toLocaleString("ko-KR")}P 지급!
      </p>
      <div className="mt-6">
        <GoogleButton label="Google 계정으로 가입" returnTo="/signup" />
        <Suspense>
          <GoogleAuthError />
        </Suspense>
        <div className="my-4 flex items-center gap-3 text-xs text-gray-600">
          <span className="h-px flex-1 bg-white/10" />또는 이메일로 가입<span className="h-px flex-1 bg-white/10" />
        </div>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <input type="email" required placeholder="이메일" className={cls}
          value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input required placeholder="닉네임" className={cls}
          value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
        <input type="password" required minLength={6} placeholder="비밀번호 (6자 이상)" className={cls}
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <div>
          <p className="mb-2 text-sm text-gray-400">어떤 취향의 캐릭터를 보고 싶으세요?</p>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => setForm({ ...form, pref: "all" })}
              className={`rounded-xl py-3 text-sm font-bold ${
                form.pref === "all" ? "bg-violet-600/30 text-violet-200 ring-1 ring-violet-400" : "bg-[#0e1120] text-gray-400"
              }`}>
              ✨ 전체
            </button>
            <button type="button" onClick={() => setForm({ ...form, pref: "female" })}
              className={`rounded-xl py-3 text-sm font-bold ${
                form.pref === "female" ? "bg-pink-600/30 text-pink-200 ring-1 ring-pink-400" : "bg-[#0e1120] text-gray-400"
              }`}>
              🌸 여성향
            </button>
            <button type="button" onClick={() => setForm({ ...form, pref: "male" })}
              className={`rounded-xl py-3 text-sm font-bold ${
                form.pref === "male" ? "bg-sky-600/30 text-sky-200 ring-1 ring-sky-400" : "bg-[#0e1120] text-gray-400"
              }`}>
              ⚡ 남성향
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button disabled={loading} className="w-full rounded-xl bg-violet-600 py-3 font-bold text-white disabled:opacity-50">
          가입하기
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-500">
        이미 계정이 있나요?{" "}
        <Link href="/login" className="text-violet-400 hover:underline">로그인</Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
