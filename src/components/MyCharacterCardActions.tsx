"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";
import StudioButton from "@/components/studio/StudioButton";

type Props = {
  characterId: number;
  characterName: string;
  official: number;
  editHref?: string;
  contentLabel?: string;
};

export default function MyCharacterCardActions({
  characterId,
  characterName,
  official,
  editHref,
  contentLabel = "캐릭터",
}: Props) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  if (official !== 0) return null;

  async function confirmDelete() {
    if (inFlight.current) return;
    inFlight.current = true;
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
      inFlight.current = false;
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex items-stretch gap-2" data-testid="studio-work-actions">
        <StudioButton
          href={editHref ?? `/create?edit=${characterId}`}
          size="sm"
          className="min-w-0 flex-1"
          aria-label={`${characterName} 수정`}
        >
          수정
        </StudioButton>
        <StudioButton
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`${characterName} 삭제`}
          disabled={deleting}
          onClick={() => {
            setError("");
            setConfirmOpen(true);
          }}
          className="shrink-0 border-rose-400/30 text-rose-200 hover:bg-rose-500/10"
        >
          삭제
        </StudioButton>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`${contentLabel} 삭제`}
        message={
          <>
            <p>
              {`「${characterName}」 ${contentLabel}을(를) 삭제할까요? 대화 기록·좋아요·댓글 등 관련 데이터가 영구적으로 삭제되며 되돌릴 수 없습니다.`}
            </p>
            {error ? (
              <p role="alert" className="mt-3 rounded-lg bg-rose-950/70 px-3 py-2 text-[13px] text-rose-200">
                {error}
              </p>
            ) : null}
          </>
        }
        confirmLabel={deleting ? "삭제 중…" : "삭제"}
        cancelLabel="취소"
        danger
        confirmDisabled={deleting}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deleting) setConfirmOpen(false);
        }}
      />
    </>
  );
}
