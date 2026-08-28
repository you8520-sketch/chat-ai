"use client";

import { useEffect, useMemo, useState } from "react";
import type { TrpgPublicRoll } from "@/lib/trpg/snapshot";
import TrpgDiceOverlay from "../TrpgDiceOverlay";
import TrpgRollResultLane from "../TrpgRollResultLane";

const FIXTURE: TrpgPublicRoll = {
  participantId: 1,
  name: "권태현",
  d20: 6,
  statKey: "str",
  finalScore: 6,
  dc: 12,
  tier: "FAILURE",
  success: false,
  actionBody: "dice-lab fixture",
  actionType: "free",
  kind: "human",
};

export default function TrpgDiceLabClient() {
  const [playKey, setPlayKey] = useState(0);
  const rolls = useMemo(() => [{ ...FIXTURE }], [playKey]);

  useEffect(() => {
    document.documentElement.classList.add("dice-lab-active");
    return () => document.documentElement.classList.remove("dice-lab-active");
  }, []);

  return (
    <div className="relative min-h-[100dvh] bg-[#12160f] text-zinc-100">
      <div className="pointer-events-none mx-auto max-w-xl px-6 pt-28 text-[15px] leading-7 text-zinc-200">
        <p data-trpg-dice-lab-prose>
          빗물에 젖은 회랑이 길게 이어진다. 석판 틈으로 이끼가 올라와 있고, 멀리서 종이 한 번 울린 뒤
          다시 고요해진다. 당신이 내민 손끝에서 유라의 시선이 잠깐 멈춘다.
        </p>
        <p className="mt-4 text-zinc-300/90">
          「여기서 더 들어가면, 돌아갈 길을 잃어요.」 그래도 문은 반쯤 열려 있다. 안쪽은 초록빛
          먼지와 오래된 청동 냄새가 섞여 있다.
        </p>
      </div>
      <div className="pointer-events-auto relative z-[70] m-4 flex max-w-md flex-col gap-2 rounded-2xl bg-black/45 px-3 py-3 backdrop-blur-sm">
        <h1 className="text-lg font-semibold">TRPG production dice lab</h1>
        <p className="text-sm text-zinc-400">
          Fixture server d20 = 6. Single production overlay owner with renderer diagnostics only.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full bg-zinc-800 px-3 py-1.5 text-sm"
            onClick={() => setPlayKey((key) => key + 1)}
          >
            Replay
          </button>
        </div>
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          <span>Action card lane</span>
          <TrpgRollResultLane layout="desktop" d20={6} tone="fail" outcome="실패" />
        </div>
      </div>
      <TrpgDiceOverlay key={playKey} phase="ROLLING" rolls={rolls} replayOnMount previewInstrument />
    </div>
  );
}
