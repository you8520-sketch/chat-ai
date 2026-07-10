"use client";

import { useState } from "react";
import { TasteFilterDropdown, type TastePref } from "@/components/UserPreferenceControls";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PointsBalanceTooltip from "@/components/PointsBalanceTooltip";

type Props = {
  user: {
    email: string;
    nickname: string;
    isAdult: boolean;
    nsfwOn: boolean;
    pref: "female" | "male" | null;
    google: boolean;
    points: number;
    paidPoints: number;
    freePoints: number;
    isAdmin?: boolean;
    isCreator?: boolean;
  };
};

export default function SettingsClient({ user }: Props) {
  const router = useRouter();
  const [nickname, setNickname] = useState(user.nickname);
  const [pref, setPref] = useState(user.pref);
  const [nsfwOn, setNsfwOn] = useState(user.nsfwOn);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function patch(body: object, success: string) {
    setBusy(true);
    setMsg("");
    setError("");
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return false;
    }
    setMsg(success);
    router.refresh();
    return true;
  }

  return (
    <div className="mx-auto mt-4 max-w-2xl">
      <h1 className="text-xl font-black text-white">내 정보 · 설정</h1>

      <section className="mt-6 rounded-2xl border border-white/5 bg-[#131626] p-5">
        <h2 className="font-bold text-white">제작 · 크리에이터</h2>
        <p className="mt-1 text-xs text-gray-400">캐릭터 제작과 수익·정산 페이지로 이동합니다.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/studio"
            className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/5"
          >
            제작 스튜디오
          </Link>
          {user.isCreator ? (
            <Link
              href="/creator"
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500"
            >
              크리에이터 페이지
            </Link>
          ) : (
            <p className="w-full text-[11px] leading-relaxed text-zinc-500">
              캐릭터를 1개 이상 만들면 크리에이터 페이지(수익·정산)를 이용할 수 있습니다.
            </p>
          )}
        </div>
      </section>

      {user.isAdmin && (
        <section className="mt-6 rounded-2xl border border-violet-500/30 bg-violet-950/30 p-5">
          <h2 className="font-bold text-violet-200">관리자</h2>
          <p className="mt-1 text-xs text-gray-400">이벤트 승인·포인트 지급·공지/FAQ·문의 답변·정산</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/admin/point-grant"
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500"
            >
              무료 포인트 지급
            </Link>
            <Link
              href="/admin/beta-free-points"
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/5"
            >
              클로즈베타 포인트 신청 관리
            </Link>
            <Link
              href="/admin/create-migration"
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/5"
            >
              캐릭터 제작 포인트 신청 관리
            </Link>
            <Link
              href="/admin/report-refunds"
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/5"
            >
              오류 신고 환불
            </Link>
            <Link
              href="/admin/comment-banned-words"
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/5"
            >
              댓글 금지어 관리
            </Link>
            <Link
              href="/admin/payout"
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/5"
            >
              크리에이터 정산
            </Link>
            <Link
              href="/admin/boards"
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/5"
            >
              공지 · FAQ 관리
            </Link>
            <Link
              href="/admin/inquiries"
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/5"
            >
              문의 게시판 관리
            </Link>
          </div>
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-white/5 bg-[#131626] p-5">
        <h2 className="font-bold text-white">로그인 정보</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">이메일</dt>
            <dd className="text-gray-200">{user.email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">로그인 방식</dt>
            <dd className="text-gray-200">{user.google ? "Google 간편 로그인" : "이메일 / 비밀번호"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">성인인증</dt>
            <dd>
              {user.isAdult ? (
                <span className="text-emerald-400">완료 ✅</span>
              ) : (
                <Link href="/verify" className="text-amber-300 hover:underline">미완료 — 인증하기</Link>
              )}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">포인트</dt>
            <dd>
              <PointsBalanceTooltip
                total={user.points}
                paid={user.paidPoints}
                free={user.freePoints}
              >
                <Link href="/points" className="text-violet-300 hover:underline">
                  {user.points.toLocaleString()}P
                </Link>
              </PointsBalanceTooltip>
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-4 rounded-2xl border border-white/5 bg-[#131626] p-5">
        <h2 className="font-bold text-white">닉네임</h2>
        <div className="mt-3 flex gap-2">
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={20}
            className="flex-1 rounded-xl bg-[#0e1120] px-4 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500"
          />
          <button
            onClick={() => patch({ nickname }, "닉네임이 변경되었습니다.")}
            disabled={busy || !nickname.trim()}
            className="rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white disabled:opacity-40"
          >
            저장
          </button>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-white/5 bg-[#131626] p-5">
        <h2 className="font-bold text-white">취향 필터</h2>
        <p className="mt-1 text-xs text-gray-500">홈과 목록에서 어떤 취향의 캐릭터를 볼지 선택합니다.</p>
        <div className="mt-3">
          <TasteFilterDropdown
            pref={pref}
            busy={busy}
            tone="settings"
            onSelect={async (value: TastePref) => {
              setPref(value);
              await patch({ pref: value }, "취향 설정이 변경되었습니다.");
            }}
          />
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-white/5 bg-[#131626] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-white">🔞 성인 캐릭터 보기</h2>
            <p className="mt-1 text-xs text-gray-500">
              {user.isAdult ? "켜면 NSFW 캐릭터가 목록에 표시됩니다." : "성인인증 후 사용할 수 있습니다."}
            </p>
          </div>
          <button
            onClick={async () => {
              if (!user.isAdult) return router.push("/verify");
              const next = !nsfwOn;
              setNsfwOn(next);
              if (!(await patch({ nsfw_on: next }, next ? "성인 캐릭터 보기 ON" : "성인 캐릭터 보기 OFF"))) {
                setNsfwOn(!next);
              }
            }}
            aria-pressed={nsfwOn}
            className={`relative h-7 w-[52px] rounded-full transition-colors ${nsfwOn ? "bg-rose-600" : "bg-gray-700"}`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${
                nsfwOn ? "left-[26px]" : "left-0.5"
              }`}
            />
          </button>
        </div>
      </section>

      {msg && <p className="mt-4 rounded-xl bg-emerald-600/10 p-3 text-sm text-emerald-300">{msg}</p>}
      {error && <p className="mt-4 rounded-xl bg-rose-600/10 p-3 text-sm text-rose-300">{error}</p>}
    </div>
  );
}
