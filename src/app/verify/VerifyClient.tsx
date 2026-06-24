"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DemoAdultSkip from "@/components/DemoAdultSkip";

const CARRIERS = ["SKT", "KT", "LG U+", "알뜰폰"];

type Props = {
  redirectTo: string;
  showDemo?: boolean;
};

export default function VerifyClient({ redirectTo, showDemo = false }: Props) {
  const router = useRouter();
  const fromCharacter = redirectTo.startsWith("/character/");
  const [form, setForm] = useState({ name: "", birth: "", carrier: "SKT" });
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      if (res.status === 401) {
        router.push(
          `/login?redirect=${encodeURIComponent(`/verify?redirect=${encodeURIComponent(redirectTo)}`)}`
        );
      }
      return;
    }
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <div className="mx-auto mt-20 max-w-sm rounded-2xl border border-emerald-500/30 bg-[#131626] p-8 text-center">
        <p className="text-4xl">✅</p>
        <h1 className="mt-3 text-xl font-black text-white">성인인증 완료</h1>
        <p className="mt-2 text-sm text-gray-400">
          이제 성인용 캐릭터 이용과 캐릭터 제작이 가능합니다.
        </p>
        <button
          onClick={() => router.push(redirectTo)}
          className="mt-6 w-full rounded-xl bg-violet-600 py-3 font-bold text-white"
        >
          {fromCharacter ? "캐릭터로 돌아가기" : "홈으로"}
        </button>
      </div>
    );
  }

  const cls =
    "w-full rounded-xl bg-[#0e1120] px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500";

  return (
    <div className="mx-auto mt-20 max-w-sm rounded-2xl border border-white/5 bg-[#131626] p-8">
      <h1 className="text-xl font-black text-white">🔞 성인인증</h1>
      <p className="mt-2 text-sm text-gray-400">
        {fromCharacter
          ? "성인용 캐릭터를 이용하려면 본인인증이 필요합니다. (만 19세 이상)"
          : "성인용 콘텐츠 이용 및 캐릭터 제작을 위해 본인인증이 필요합니다. (만 19세 이상)"}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          required
          placeholder="이름"
          className={cls}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          required
          placeholder="생년월일 8자리 (예: 19950101)"
          maxLength={8}
          pattern="\d{8}"
          className={cls}
          value={form.birth}
          onChange={(e) => setForm({ ...form, birth: e.target.value.replace(/\D/g, "") })}
        />
        <div className="grid grid-cols-4 gap-2">
          {CARRIERS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setForm({ ...form, carrier: c })}
              className={`rounded-lg py-2 text-xs font-semibold ${
                form.carrier === c ? "bg-violet-600 text-white" : "bg-[#0e1120] text-gray-400"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          disabled={loading}
          className="w-full rounded-xl bg-rose-600 py-3 font-bold text-white disabled:opacity-50"
        >
          휴대폰 본인인증 (모의)
        </button>
        {showDemo && (
          <>
            <DemoAdultSkip redirectTo={redirectTo} label="데모: 바로 성인인증 완료" />
            <p className="text-center text-[11px] text-gray-600">
              ※ 모의 인증은 생년월일이 만 19세 이상이어야 합니다. 안 되면 위 「데모: 바로 성인인증
              완료」를 누르세요.
            </p>
          </>
        )}
      </form>
    </div>
  );
}
