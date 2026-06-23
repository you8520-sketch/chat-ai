"use client";

import Link from "next/link";
import { useState } from "react";

import {
  MAX_ADMIN_FREE_POINT_GRANT,
  MAX_ADMIN_FREE_POINT_GRANT_NOTE_LENGTH,
  MIN_ADMIN_FREE_POINT_GRANT,
} from "@/lib/adminPointGrantConstants";
import { FREE_POINTS_VALID_MONTHS } from "@/lib/plans";

export default function AdminPointGrantClient() {
  const [recipientNickname, setRecipientNickname] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const parsedAmount = Number(amount);
    if (!recipientNickname.trim() && !recipientId.trim()) {
      setError("닉네임 또는 사용자 ID를 입력해 주세요.");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount < MIN_ADMIN_FREE_POINT_GRANT) {
      setError(`최소 지급 금액은 ${MIN_ADMIN_FREE_POINT_GRANT}P입니다.`);
      return;
    }
    if (parsedAmount > MAX_ADMIN_FREE_POINT_GRANT) {
      setError(`최대 지급 금액은 ${MAX_ADMIN_FREE_POINT_GRANT.toLocaleString()}P입니다.`);
      return;
    }

    const targetLabel = recipientNickname.trim()
      ? `@${recipientNickname.trim()}`
      : `ID ${recipientId.trim()}`;

    if (
      !confirm(
        `${targetLabel}님에게 무료 포인트 ${parsedAmount.toLocaleString()}P를 지급할까요?\n\n유효기간: 지급일로부터 ${FREE_POINTS_VALID_MONTHS}개월`
      )
    ) {
      return;
    }

    setLoading(true);
    const res = await fetch("/api/admin/point-grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientNickname: recipientNickname.trim() || undefined,
        recipientId: recipientId.trim() ? Number(recipientId.trim()) : undefined,
        amount: parsedAmount,
        note: note.trim() || undefined,
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "지급에 실패했습니다.");
      return;
    }

    setSuccess(
      `@${data.recipientNickname}님에게 ${data.amount.toLocaleString()}P를 지급했습니다. (보유 ${data.recipientBalance.total.toLocaleString()}P)`
    );
    setRecipientNickname("");
    setRecipientId("");
    setAmount("");
    setNote("");
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <Link href="/settings" className="text-sm text-violet-400 hover:underline">
        ← 설정
      </Link>
      <h1 className="mt-4 text-2xl font-black text-white">무료 포인트 지급</h1>
      <p className="mt-1 text-sm text-gray-400">
        사용자에게 무료 포인트를 지급합니다. 유효기간은 지급일로부터{" "}
        <span className="text-amber-200/90">{FREE_POINTS_VALID_MONTHS}개월</span>입니다.
      </p>

      <form
        onSubmit={submit}
        className="mt-6 space-y-4 rounded-2xl border border-violet-500/30 bg-violet-950/20 p-5"
      >
        <div>
          <label htmlFor="grant-nickname" className="text-xs font-semibold text-gray-400">
            닉네임
          </label>
          <input
            id="grant-nickname"
            type="text"
            value={recipientNickname}
            onChange={(e) => setRecipientNickname(e.target.value)}
            placeholder="받는 사람 닉네임"
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b0d14] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
          />
        </div>

        <div>
          <label htmlFor="grant-user-id" className="text-xs font-semibold text-gray-400">
            사용자 ID (선택)
          </label>
          <input
            id="grant-user-id"
            type="number"
            min={1}
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            placeholder="닉네임 대신 ID로 지정"
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b0d14] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
          />
        </div>

        <div>
          <label htmlFor="grant-amount" className="text-xs font-semibold text-gray-400">
            지급 포인트
          </label>
          <input
            id="grant-amount"
            type="number"
            min={MIN_ADMIN_FREE_POINT_GRANT}
            max={MAX_ADMIN_FREE_POINT_GRANT}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`${MIN_ADMIN_FREE_POINT_GRANT} ~ ${MAX_ADMIN_FREE_POINT_GRANT.toLocaleString()}`}
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b0d14] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
          />
        </div>

        <div>
          <label htmlFor="grant-note" className="text-xs font-semibold text-gray-400">
            메모 (선택 · 포인트 내역에 표시)
          </label>
          <input
            id="grant-note"
            type="text"
            maxLength={MAX_ADMIN_FREE_POINT_GRANT_NOTE_LENGTH}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: CS 보상, 이벤트 당첨"
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b0d14] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
          />
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}
        {success && <p className="text-sm text-emerald-400">{success}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-violet-600 py-2.5 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {loading ? "처리 중…" : "무료 포인트 지급"}
        </button>
      </form>
    </div>
  );
}
