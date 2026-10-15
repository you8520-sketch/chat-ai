"use client";

import { useEffect, useState } from "react";
import TrpgExplorationPanel from "../TrpgExplorationPanel";
import type { ExplorationCommand, PublicExploration } from "@/lib/trpg/explorationPublic";

/** Full-bleed lab chrome so the panel and the composer can be shot without the site header. */
export default function PreviewFrame({
  exploration,
  queue,
  initiallyOpen,
  title,
}: {
  exploration: PublicExploration;
  queue: ExplorationCommand[];
  initiallyOpen: boolean;
  title: string;
}) {
  const [localQueue, setLocalQueue] = useState<ExplorationCommand[]>(queue);
  useEffect(() => {
    document.documentElement.classList.add("dice-lab-active");
    return () => document.documentElement.classList.remove("dice-lab-active");
  }, []);

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col bg-[#0c0f16] text-zinc-100">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pt-4">
        <p className="text-sm leading-6 text-zinc-300">
          GM: 현관홀이 두 갈래로 갈라져 있다. 북쪽은 중앙홀, 다른 쪽은 남쪽복도다.
        </p>
        <p className="text-sm leading-6 text-zinc-400">서하: 나는 여기서 현이가 고르는 쪽을 본다.</p>
        <p className="text-xs text-zinc-500" data-exploration-preview-shot={title}>
          {title}
        </p>
        <TrpgExplorationPanel
          exploration={exploration}
          queue={localQueue}
          locked={false}
          initiallyOpen={initiallyOpen}
          onQueue={(command) => setLocalQueue((current) => [...current, command])}
          onRemove={(index) => setLocalQueue((current) => current.filter((_, item) => item !== index))}
        />
      </div>
      <form
        className="shrink-0 border-t border-white/10 bg-[#10141c] px-3 py-3"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="mb-2 block text-xs text-zinc-400" htmlFor="exploration-preview-body">
          행동
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="exploration-preview-body"
            rows={2}
            defaultValue=""
            placeholder="자유롭게 적어도 됩니다. 지도는 이번 행동에 붙는 명령만 만듭니다."
            className="min-h-11 flex-1 resize-none rounded-xl border border-white/10 bg-[#161b26] px-3 py-2 text-sm"
          />
          <button type="submit" className="min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-semibold">
            보내기
          </button>
        </div>
      </form>
    </div>
  );
}
