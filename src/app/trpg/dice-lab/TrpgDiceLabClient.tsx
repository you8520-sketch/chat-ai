"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { TrpgDiceLabRenderer } from "@/lib/trpg/diceRollUx";
import type { TrpgPublicRoll } from "@/lib/trpg/snapshot";
import TrpgDiceOverlay from "../TrpgDiceOverlay";
import TrpgRollResultLane from "../TrpgRollResultLane";

const TrpgDiceBoxScene = dynamic(() => import("../TrpgDiceBoxScene"), { ssr: false });
const TrpgGildedDiceScene = dynamic(() => import("../TrpgGildedDiceScene"), { ssr: false });

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

type LabMode = "verdant-relic" | "gilded-verdant-relic" | "dice-box-threejs";

function initialMode(renderer: TrpgDiceLabRenderer, theme: string | undefined): LabMode {
  if (renderer === "dice-box-threejs") return "dice-box-threejs";
  if (theme === "gilded-verdant-relic") return "gilded-verdant-relic";
  return "verdant-relic";
}

export default function TrpgDiceLabClient({
  initialRenderer,
  initialTheme,
}: {
  initialRenderer: TrpgDiceLabRenderer;
  initialTheme?: string;
}) {
  const [mode, setMode] = useState<LabMode>(() => initialMode(initialRenderer, initialTheme));
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
        <h1 className="text-lg font-semibold">TRPG D20 visual lab</h1>
        <p className="text-sm text-zinc-400">
          Fixture server d20 = 6. A = current Verdant. B = Gilded Verdant Relic (geometry redesign
          candidate, NEEDS_HUMAN_REVIEW). Physics B stays lab-only and is not wired into the campaign
          overlay.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`rounded-full px-3 py-1.5 text-sm ${mode === "verdant-relic" ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800"}`}
            onClick={() => {
              setMode("verdant-relic");
              setPlayKey((key) => key + 1);
            }}
          >
            A · Verdant
          </button>
          <button
            type="button"
            className={`rounded-full px-3 py-1.5 text-sm ${mode === "gilded-verdant-relic" ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800"}`}
            onClick={() => {
              setMode("gilded-verdant-relic");
              setPlayKey((key) => key + 1);
            }}
          >
            B · Gilded Verdant Relic
          </button>
          <button
            type="button"
            className={`rounded-full px-3 py-1.5 text-sm ${mode === "dice-box-threejs" ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800"}`}
            onClick={() => {
              setMode("dice-box-threejs");
              setPlayKey((key) => key + 1);
            }}
          >
            Physics B
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
      {mode === "dice-box-threejs" ? (
        <div
          key={`b-${playKey}`}
          className="pointer-events-none fixed inset-0 z-[65] bg-black/15"
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
      ) : mode === "gilded-verdant-relic" ? (
        <div
          key={`gilded-${playKey}`}
          className="pointer-events-none fixed inset-0 z-[65] bg-black/15"
          data-trpg-dice-lab-proto="gilded"
        >
          <div className="flex h-full w-full items-center justify-center md:-translate-y-[6%]">
            <div className="flex flex-col items-center">
              <div className="relative h-[min(218px,32vw)] w-[min(250px,38vw)] max-md:h-[min(168px,40vw)] max-md:w-[min(186px,48vw)] overflow-hidden rounded-2xl">
                <TrpgGildedDiceScene
                  value={6}
                  tone="fail"
                  durationMs={1240}
                  reducedQuality={false}
                  onSettled={() => undefined}
                />
              </div>
              <p className="mt-2.5 text-center text-[13px] font-medium tracking-wide text-zinc-200/90">
                권태현 · D20 6 · 실패
              </p>
            </div>
          </div>
        </div>
      ) : (
        <TrpgDiceOverlay key={`verdant-${playKey}`} phase="ROLLING" rolls={rolls} theme="verdant-relic" />
      )}
    </div>
  );
}
