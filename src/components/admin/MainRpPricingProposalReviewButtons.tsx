"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MainRpPricingProposalReviewButtons(props: { proposalId: number }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");

  async function submit(action: "approve" | "reject") {
    setPending(action);
    setError("");
    try {
      const response = await fetch(`/api/admin/pricing-proposals/${props.proposalId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(body.error || "제안 처리에 실패했습니다.");
        return;
      }
      setNote("");
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="min-w-64 space-y-2">
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={1000}
        placeholder="검토 메모 (선택)"
        className="w-full rounded border border-white/10 bg-black/20 px-2 py-1 text-xs text-zinc-200"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending != null}
          onClick={() => void submit("approve")}
          className="rounded border border-emerald-500/30 px-2 py-1 text-xs text-emerald-200 disabled:opacity-50"
        >
          {pending === "approve" ? "처리 중…" : "Approve record"}
        </button>
        <button
          type="button"
          disabled={pending != null}
          onClick={() => void submit("reject")}
          className="rounded border border-rose-500/30 px-2 py-1 text-xs text-rose-200 disabled:opacity-50"
        >
          {pending === "reject" ? "처리 중…" : "Reject"}
        </button>
      </div>
      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
