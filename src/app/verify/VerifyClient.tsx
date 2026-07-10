"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DemoAdultSkip from "@/components/DemoAdultSkip";
import StudioButton from "@/components/studio/StudioButton";
import { cn, studioInputClass, studioSurface, studioType } from "@/lib/studioDesign";

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
      <div className={`mx-auto mt-20 max-w-sm p-8 text-center ${studioSurface.card}`}>
        <p className="text-4xl">✅</p>
        <h1 className={`mt-3 ${studioType.heading}`}>성인인증 완료</h1>
        <p className={`mt-2 ${studioType.body}`}>
          이제 성인용 캐릭터 이용과 캐릭터 제작이 가능합니다.
        </p>
        <StudioButton
          onClick={() => router.push(redirectTo)}
          className="mt-6 w-full"
        >
          {fromCharacter ? "캐릭터로 돌아가기" : "홈으로"}
        </StudioButton>
      </div>
    );
  }

  return (
    <div className={`mx-auto mt-20 max-w-sm p-8 ${studioSurface.card}`}>
      <h1 className={studioType.heading}>🔞 성인인증</h1>
      <p className={`mt-2 ${studioType.body}`}>
        {fromCharacter
          ? "성인용 캐릭터를 이용하려면 본인인증이 필요합니다. (만 19세 이상)"
          : "성인용 콘텐츠 이용 및 캐릭터 제작을 위해 본인인증이 필요합니다. (만 19세 이상)"}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          required
          placeholder="이름"
          className={studioInputClass}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          required
          placeholder="생년월일 8자리 (예: 19950101)"
          maxLength={8}
          pattern="\d{8}"
          className={studioInputClass}
          value={form.birth}
          onChange={(e) => setForm({ ...form, birth: e.target.value.replace(/\D/g, "") })}
        />
        <div className="grid grid-cols-4 gap-2">
          {CARRIERS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setForm({ ...form, carrier: c })}
              className={cn(
                "rounded-xl border py-2 text-xs font-semibold",
                form.carrier === c ? studioSurface.choiceActive : studioSurface.choiceIdle,
              )}
            >
              {c}
            </button>
          ))}
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <StudioButton type="submit" variant="danger" disabled={loading} className="w-full">
          휴대폰 본인인증 (모의)
        </StudioButton>
        {showDemo && (
          <>
            <DemoAdultSkip redirectTo={redirectTo} label="데모: 바로 성인인증 완료" />
            <p className={`text-center ${studioType.caption} text-zinc-600`}>
              ※ 모의 인증은 생년월일이 만 19세 이상이어야 합니다. 안 되면 위 「데모: 바로 성인인증
              완료」를 누르세요.
            </p>
          </>
        )}
      </form>
    </div>
  );
}
