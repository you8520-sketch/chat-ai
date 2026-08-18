"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { TrpgDiceLabRenderer } from "@/lib/trpg/diceRollUx";
import type { TrpgPublicRoll } from "@/lib/trpg/snapshot";
import TrpgDiceOverlay from "../TrpgDiceOverlay";
import TrpgRollResultLane from "../TrpgRollResultLane";

const TrpgDiceBoxScene = dynamic(() => import("../TrpgDiceBoxScene"), { ssr: false });

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

export default function TrpgDiceLabClient({
  initialRenderer,
}: {
  initialRenderer: TrpgDiceLabRenderer;
}) {
  const [renderer, setRenderer] = useState<TrpgDiceLabRenderer>(initialRenderer);
  const [playKey, setPlayKey] = useState(0);
  const rolls = useMemo(() => [{ ...FIXTURE }], [playKey]);

  useEffect(() => {
    document.documentElement.classList.add("dice-lab-active");
    return () => document.documentElement.classList.remove("dice-lab-active");
  }, []);

  return (
    <div className="relative min-h-[100dvh] bg-[#07080c] text-zinc-100">
      <div className="pointer-events-auto relative z-[70] m-4 flex max-w-md flex-col gap-2 rounded-2xl bg-black/45 px-3 py-3 backdrop-blur-sm">
        <h1 className="text-lg font-semibold">TRPG D20 visual lab</h1>
        <p className="text-sm text-zinc-400">
          Fixture server d20 = 6. Production runtime is Prototype A only. Prototype B stays on this
          lab page and is not wired into the campaign overlay.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`rounded-full px-3 py-1.5 text-sm ${renderer === "custom" ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800"}`}
            onClick={() => {
              setRenderer("custom");
              setPlayKey((key) => key + 1);
            }}
          >
            A · custom
          </button>
          <button
            type="button"
            className={`rounded-full px-3 py-1.5 text-sm ${renderer === "dice-box-threejs" ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800"}`}
            onClick={() => {
              setRenderer("dice-box-threejs");
              setPlayKey((key) => key + 1);
            }}
          >
            B · dice-box-threejs
          </button>
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
      {renderer === "custom" ? (
        <TrpgDiceOverlay key={`a-${playKey}`} phase="ROLLING" rolls={rolls} />
      ) : (
        <div
          key={`b-${playKey}`}
          className="pointer-events-none fixed inset-0 z-[65] bg-black/40"
          data-trpg-dice-lab-proto="B"
        >
          <TrpgDiceBoxScene
            value={6}
            tone="fail"
            reducedQuality={false}
            onSettled={() => undefined}
          />
          <p className="absolute inset-x-0 bottom-[11%] text-center text-[13px] font-medium tracking-wide text-zinc-200/90">
            권태현 · D20 6 · 실패
          </p>
        </div>
      )}
    </div>
  );
}
