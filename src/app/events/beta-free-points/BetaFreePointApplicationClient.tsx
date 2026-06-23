"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  applicationStatusLabel,
  type CreateMigrationApplicationStatus,
} from "@/lib/createMigrationEventShared";

type ApplicationInfo = {
  id: number;
  status: CreateMigrationApplicationStatus;
  reward_amount: number | null;
  admin_note: string;
  created_at: string;
};

export default function BetaFreePointApplicationClient() {
  const router = useRouter();
  const [application, setApplication] = useState<ApplicationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch("/api/events/beta-free-points");
    if (res.status === 401) {
      router.push("/login?redirect=/events/beta-free-points");
      return;
    }
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "정보를 불러오지 못했습니다.");
      return;
    }
    setApplication(data.application ?? null);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function apply() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/events/beta-free-points", { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "신청에 실패했습니다.");
      return;
    }
    setToast("신청이 접수되었습니다. 관리자 승인 후 포인트가 지급됩니다.");
    await load();
    setTimeout(() => setToast(""), 4000);
  }

  const canApply = !application || application.status === "rejected";
  const isPending = application?.status === "pending";
  const isApproved = application?.status === "approved";
  const isRejected = application?.status === "rejected";

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/" className="text-sm text-violet-400 hover:underline">
        ← 홈
      </Link>
      <p className="mt-4 text-xs font-bold uppercase tracking-wider text-violet-300/90">CLOSED BETA</p>
      <h1 className="mt-1 text-2xl font-black text-white">클로즈베타 무료 포인트 신청</h1>
      <p className="mt-2 text-sm leading-relaxed text-gray-400">
        클로즈베타 테스트 참여를 위해 무료 포인트를 신청할 수 있습니다. 관리자 검토 후 승인되면 무료 포인트가
        지급됩니다.
      </p>

      <div className="mt-4 rounded-xl border border-white/5 bg-[#131626] p-4 text-sm text-gray-400">
        <p className="font-semibold text-white">신청 안내</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
          <li>계정당 1회 지급 (승인 완료 후 재신청 불가)</li>
          <li>반려된 경우 다시 신청할 수 있습니다</li>
          <li>지급 포인트는 관리자가 검토 후 결정합니다</li>
        </ul>
      </div>

      {toast && (
        <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {toast}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-12 text-center text-sm text-gray-500">불러오는 중…</p>
      ) : (
        <div className="mt-8 rounded-2xl border border-white/5 bg-[#131626] p-6">
          {isPending && (
            <div className="text-center">
              <span className="inline-block rounded-full bg-amber-600/20 px-4 py-1 text-sm font-bold text-amber-300">
                {applicationStatusLabel("pending")}
              </span>
              <p className="mt-4 text-sm text-gray-300">신청이 접수되었습니다. 관리자 승인을 기다려 주세요.</p>
              <p className="mt-2 text-xs text-gray-500">신청일: {application.created_at}</p>
            </div>
          )}

          {isApproved && (
            <div className="text-center">
              <span className="inline-block rounded-full bg-emerald-600/20 px-4 py-1 text-sm font-bold text-emerald-300">
                {applicationStatusLabel("approved")}
              </span>
              <p className="mt-4 text-sm text-gray-300">
                무료 포인트{" "}
                <span className="font-bold text-emerald-300">
                  {application.reward_amount?.toLocaleString() ?? "?"}P
                </span>
                가 지급되었습니다.
              </p>
              {application.admin_note && (
                <p className="mt-2 text-xs text-gray-500">메모: {application.admin_note}</p>
              )}
            </div>
          )}

          {isRejected && (
            <div className="text-center">
              <span className="inline-block rounded-full bg-zinc-600/30 px-4 py-1 text-sm font-bold text-zinc-300">
                {applicationStatusLabel("rejected")}
              </span>
              {application.admin_note && (
                <p className="mt-4 text-sm text-rose-300">사유: {application.admin_note}</p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={apply}
                className="mt-5 rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {busy ? "처리 중…" : "다시 신청하기"}
              </button>
            </div>
          )}

          {canApply && !isPending && !isApproved && !isRejected && (
            <div className="text-center">
              <p className="text-sm text-gray-400">아직 신청하지 않았습니다.</p>
              <button
                type="button"
                disabled={busy}
                onClick={apply}
                className="mt-5 rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-50"
              >
                {busy ? "처리 중…" : "무료 포인트 신청하기"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
