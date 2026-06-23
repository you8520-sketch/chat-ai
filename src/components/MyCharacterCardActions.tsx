"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";

type Props = {
  characterId: number;
  characterName: string;
  official: number;
};

export default function MyCharacterCardActions({
  characterId,
  characterName,
  official,
}: Props) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  if (official !== 0) return null;

  async function confirmDelete() {
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/characters/${characterId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "삭제에 실패했습니다.");
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    } catch {
      setError("삭제 중 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <Link
          href={`/create?edit=${characterId}`}
          className="rounded-lg bg-violet-600/90 px-2.5 py-1 text-[10px] font-bold text-white shadow hover:bg-violet-500"
        >
          수정
        </Link>
        <button
          type="button"
          disabled={deleting}
          onClick={() => {
            setError("");
            setConfirmOpen(true);
          }}
          className="rounded-lg bg-rose-600/90 px-2.5 py-1 text-[10px] font-bold text-white shadow hover:bg-rose-500 disabled:opacity-50"
        >
          {deleting ? "…" : "삭제"}
        </button>
      </div>

      {error && (
        <p className="absolute left-2 right-2 top-10 z-10 rounded bg-rose-950/90 px-2 py-1 text-[10px] text-rose-200">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="캐릭터 삭제"
        message={`「${characterName}」 캐릭터를 삭제할까요? 대화 기록·좋아요·댓글 등 관련 데이터가 영구적으로 삭제되며 되돌릴 수 없습니다.`}
        confirmLabel="삭제"
        cancelLabel="취소"
        danger
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deleting) setConfirmOpen(false);
        }}
      />
    </>
  );
}
