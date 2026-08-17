"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { IconImageSpark, IconRegenerate } from "@/components/ChatToolbarIcons";
import { formatPoints } from "@/lib/billingDisplay";
import type { TrpgBillingMode } from "@/lib/trpg/types";

const toolbarBtn =
  "flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-white/[0.08] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30";

export default function TrpgSceneToolbar({
  billedPoints,
  viewerSharePoints,
  humanCount,
  botCount,
  billingHint,
  billingMode,
  viewerIsHost,
  canReroll,
  canImage,
  busy,
  onReroll,
  onImage,
}: {
  billedPoints: number | null;
  viewerSharePoints: number | null;
  humanCount?: number;
  botCount?: number;
  billingHint?: string;
  billingMode?: TrpgBillingMode;
  viewerIsHost?: boolean;
  canReroll: boolean;
  canImage: boolean;
  busy: boolean;
  onReroll: () => void;
  onImage: () => void;
}) {
  const [confirmReroll, setConfirmReroll] = useState(false);
  const showPoints = billedPoints != null;

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2">
        <div className="flex items-center gap-0.5">
          {canReroll ? (
            <button
              type="button"
              className={toolbarBtn}
              disabled={busy}
              aria-label="장면 리롤"
              title="장면 리롤"
              onClick={() => setConfirmReroll(true)}
            >
              <IconRegenerate />
            </button>
          ) : null}
          {canImage ? (
            <button
              type="button"
              className={toolbarBtn}
              disabled={busy}
              aria-label="이미지 생성"
              title="이 장면으로 이미지 생성"
              onClick={onImage}
            >
              <IconImageSpark />
            </button>
          ) : null}
        </div>
        {showPoints ? (
          <p
            className="text-[11px] tabular-nums text-zinc-400"
            title={billingHint || "GM/AI 이용료 포함"}
          >
            <span className="font-semibold text-zinc-200">{`총 ${formatPoints(billedPoints)}P`}</span>
            {viewerSharePoints != null ? (
              <span>{` · 내 부담 ${formatPoints(viewerSharePoints)}P`}</span>
            ) : null}
            {billingMode === "host_pays" && !viewerIsHost ? (
              <span>{" · 방장 전액 부담"}</span>
            ) : null}
            {humanCount != null ? <span>{` · 참가 ${humanCount}명`}</span> : null}
            {botCount != null ? <span>{` · AI ${botCount}`}</span> : null}
          </p>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmReroll}
        title="장면 리롤"
        message="주사위와 제출한 행동은 그대로 두고 GM 장면만 다시 씁니다. 포인트가 다시 차감됩니다."
        confirmLabel="리롤"
        onCancel={() => setConfirmReroll(false)}
        onConfirm={() => {
          setConfirmReroll(false);
          onReroll();
        }}
      />
    </>
  );
}
