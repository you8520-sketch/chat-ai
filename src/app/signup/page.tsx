"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import GoogleButton from "@/components/GoogleButton";
import GoogleAuthError from "@/components/GoogleAuthError";
import StudioButton from "@/components/studio/StudioButton";
import { SIGNUP_BONUS_POINTS } from "@/lib/plans";
import { cn, studioInputClass, studioSurface, studioType } from "@/lib/studioDesign";

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

  return (
    <div className={`mx-auto mt-20 max-w-sm p-8 ${studioSurface.card}`}>
      <h1 className={studioType.heading}>회원가입</h1>
      <p className="mt-1 text-sm text-violet-300">
        가입 즉시 {SIGNUP_BONUS_POINTS.toLocaleString("ko-KR")}P 지급!
      </p>
      <div className="mt-6">
        <GoogleButton label="Google 계정으로 가입" returnTo="/signup" />
        <Suspense>
          <GoogleAuthError />
        </Suspense>
        <div className="my-4 flex items-center gap-3 text-xs text-zinc-600">
          <span className="h-px flex-1 bg-white/10" />또는 이메일로 가입<span className="h-px flex-1 bg-white/10" />
        </div>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <input type="email" required placeholder="이메일" className={studioInputClass}
          value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input required placeholder="닉네임" className={studioInputClass}
          value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
        <input type="password" required minLength={6} placeholder="비밀번호 (6자 이상)" className={studioInputClass}
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <div>
          <p className={studioType.label}>어떤 취향의 캐릭터를 보고 싶으세요?</p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["all", "✨ 전체"],
                ["female", "🌸 여성향"],
                ["male", "⚡ 남성향"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setForm({ ...form, pref: value })}
                className={cn(
                  "rounded-xl border py-3 text-sm font-semibold",
                  form.pref === value ? studioSurface.choiceActive : studioSurface.choiceIdle,
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <StudioButton type="submit" disabled={loading} className="w-full">
          가입하기
        </StudioButton>
      </form>
      <p className={`mt-4 text-center ${studioType.body} text-zinc-500`}>
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
