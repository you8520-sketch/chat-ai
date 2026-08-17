"use client";

import { useEffect, useMemo, useState } from "react";
import type { TrpgPublicRoll } from "@/lib/trpg/snapshot";
import TrpgDiceOverlay, { type TrpgDiceRenderer } from "../TrpgDiceOverlay";
import TrpgD20 from "../TrpgD20";

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
  initialRenderer: TrpgDiceRenderer;
}) {
  const [renderer, setRenderer] = useState<TrpgDiceRenderer>(initialRenderer);
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
          Fixture server d20 = 6. Client never invents a roll. Prototype A is the corrected custom
          renderer. Prototype B is dice-box-threejs + Cannon with 1d20@6.
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
          <span>Static token</span>
          <TrpgD20 value={6} tone="fail" size="desktop" />
        </div>
      </div>
      <TrpgDiceOverlay
        key={`${renderer}-${playKey}`}
        phase="ROLLING"
        rolls={rolls}
        renderer={renderer}
      />
    </div>
  );
}
