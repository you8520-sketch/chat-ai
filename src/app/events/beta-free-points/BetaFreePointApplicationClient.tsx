"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import StudioButton from "@/components/studio/StudioButton";
import {
  applicationStatusLabel,
  type CreateMigrationApplicationStatus,
} from "@/lib/createMigrationEventShared";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

type ApplicationInfo = {
  id: number;
  status: CreateMigrationApplicationStatus;
  reward_amount: number | null;
  admin_note: string;
  created_at: string;
};

function statusPillClass(status: CreateMigrationApplicationStatus): string {
  if (status === "pending") return "bg-zinc-600/30 text-zinc-300";
  if (status === "approved") return "bg-violet-600/20 text-violet-200";
  return "bg-rose-600/30 text-rose-200";
}

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
      <span className="mt-4 inline-block rounded-full bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-400 ring-1 ring-white/10">
        CLOSED BETA
      </span>
      <h1 className={cn(studioType.heading, "mt-2")}>클로즈베타 무료 포인트 신청</h1>
      <p className={cn(studioType.body, "mt-2")}>
        클로즈베타 테스트 참여를 위해 무료 포인트를 신청할 수 있습니다. 관리자 검토 후 승인되면 무료 포인트가
        지급됩니다.
      </p>

      <div className={cn(studioSurface.card, "mt-4 text-sm")}>
        <p className="font-semibold text-zinc-50">신청 안내</p>
        <ul className={cn(studioType.caption, "mt-2 list-inside list-disc space-y-1")}>
          <li>계정당 1회 지급 (승인 완료 후 재신청 불가)</li>
          <li>반려된 경우 다시 신청할 수 있습니다</li>
          <li>지급 포인트는 관리자가 검토 후 결정합니다</li>
        </ul>
      </div>

      {toast && (
        <p className="mt-4 rounded-xl border border-white/10 bg-violet-600/10 px-4 py-3 text-sm text-violet-200">
          {toast}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </p>
      )}

      {loading ? (
        <p className={cn(studioType.helper, "mt-12 text-center")}>불러오는 중…</p>
      ) : (
        <div className={cn(studioSurface.card, "mt-8 p-6")}>
          {isPending && (
            <div className="text-center">
              <span
                className={cn(
                  "inline-block rounded-full px-4 py-1 text-sm font-semibold",
                  statusPillClass("pending"),
                )}
              >
                {applicationStatusLabel("pending")}
              </span>
              <p className={cn(studioType.body, "mt-4")}>
                신청이 접수되었습니다. 관리자 승인을 기다려 주세요.
              </p>
              <p className={cn(studioType.caption, "mt-2")}>신청일: {application.created_at}</p>
            </div>
          )}

          {isApproved && (
            <div className="text-center">
              <span
                className={cn(
                  "inline-block rounded-full px-4 py-1 text-sm font-semibold",
                  statusPillClass("approved"),
                )}
              >
                {applicationStatusLabel("approved")}
              </span>
              <p className={cn(studioType.body, "mt-4")}>
                무료 포인트{" "}
                <span className="font-semibold text-zinc-50">
                  {application.reward_amount?.toLocaleString() ?? "?"}P
                </span>
                가 지급되었습니다.
              </p>
              {application.admin_note && (
                <p className={cn(studioType.caption, "mt-2")}>메모: {application.admin_note}</p>
              )}
            </div>
          )}

          {isRejected && (
            <div className="text-center">
              <span
                className={cn(
                  "inline-block rounded-full px-4 py-1 text-sm font-semibold",
                  statusPillClass("rejected"),
                )}
              >
                {applicationStatusLabel("rejected")}
              </span>
              {application.admin_note && (
                <p className="mt-4 text-sm text-rose-300">사유: {application.admin_note}</p>
              )}
              <StudioButton type="button" disabled={busy} onClick={apply} className="mt-5">
                {busy ? "처리 중…" : "다시 신청하기"}
              </StudioButton>
            </div>
          )}

          {canApply && !isPending && !isApproved && !isRejected && (
            <div className="text-center">
              <p className={studioType.body}>아직 신청하지 않았습니다.</p>
              <StudioButton type="button" disabled={busy} onClick={apply} className="mt-5">
                {busy ? "처리 중…" : "무료 포인트 신청하기"}
              </StudioButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
