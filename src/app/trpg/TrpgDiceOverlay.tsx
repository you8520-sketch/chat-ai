"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveTrpgD20Tone, trpgRollOutcomeLabel } from "@/lib/trpg/actionCardUi";
import {
  TRPG_D20_HOLD_AFTER_SETTLE_MS,
  TRPG_D20_THEME,
  TRPG_DICE_ENGINE,
  orderTrpgDiceRolls,
  shouldAnimateTrpgDice3d,
  trpgDiceDurationMs,
  trpgDiceOverlayActive,
  trpgPredeterminedD20Notation,
} from "@/lib/trpg/diceRollUx";
import type { TrpgPublicRoll } from "@/lib/trpg/snapshot";
import type { TrpgResolutionOrderEntry } from "@/lib/trpg/initiative";
import TrpgD20 from "./TrpgD20";

const TrpgDiceScene = dynamic(() => import("./TrpgDiceScene"), { ssr: false });

function detectWebgl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function TrpgDiceOverlay({
  phase,
  rolls,
  resolutionOrder,
}: {
  phase: string;
  rolls: readonly TrpgPublicRoll[];
  resolutionOrder?: readonly TrpgResolutionOrderEntry[];
}) {
  const active = trpgDiceOverlayActive(phase, rolls);
  const ordered = useMemo(() => orderTrpgDiceRolls(rolls, resolutionOrder), [resolutionOrder, rolls]);
  const timing = trpgDiceDurationMs(ordered.length);
  const [index, setIndex] = useState(0);
  const [use3d, setUse3d] = useState(false);
  const [reducedQuality, setReducedQuality] = useState(false);
  const rollKey = ordered.map((roll) => `${roll.participantId}:${roll.d20}`).join("|");

  useEffect(() => {
    setIndex(0);
  }, [rollKey]);

  const onSettled = useCallback(() => {
    window.setTimeout(() => {
      setIndex((current) => Math.min(Math.max(ordered.length - 1, 0), current + 1));
    }, TRPG_D20_HOLD_AFTER_SETTLE_MS);
  }, [ordered.length]);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const webgl = detectWebgl();
    setUse3d(shouldAnimateTrpgDice3d({ webgl, reducedMotion }));
    setReducedQuality(
      window.matchMedia("(max-width: 640px)").matches ||
        (typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4)
    );
  }, [active]);

  useEffect(() => {
    if (!active || use3d || ordered.length === 0) return;
    const hold = Math.min(timing.perDie, 900);
    const timer = window.setTimeout(() => {
      setIndex((current) => Math.min(ordered.length - 1, current + 1));
    }, hold);
    return () => window.clearTimeout(timer);
  }, [active, index, ordered.length, timing.perDie, use3d]);

  if (!active || ordered.length === 0) return null;
  const roll = ordered[Math.min(index, ordered.length - 1)];
  if (!roll) return null;
  const tone = resolveTrpgD20Tone(roll.d20, roll.tier);
  const outcome = trpgRollOutcomeLabel(roll.tier);
  const notation = trpgPredeterminedD20Notation(roll.d20);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[65] flex items-center justify-center bg-[#07080c]/72"
      data-trpg-dice-overlay
      data-trpg-dice-engine={TRPG_DICE_ENGINE}
      data-trpg-dice-theme={TRPG_D20_THEME}
      data-trpg-dice-mode={use3d ? "3d" : "static"}
      data-trpg-dice-value={roll.d20}
      data-trpg-dice-predetermined={notation}
      aria-hidden="true"
    >
      <div className="flex w-[min(420px,92vw)] flex-col items-center gap-3">
        <div className="relative h-[240px] w-full overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#141821] to-[#07080c] shadow-[0_0_80px_rgba(0,0,0,0.55)]">
          {use3d ? (
            <TrpgDiceScene
              value={roll.d20}
              tone={tone}
              durationMs={timing.perDie}
              reducedQuality={reducedQuality}
              onSettled={onSettled}
            />
          ) : (
            <div className="flex h-full items-center justify-center" data-trpg-dice-canvas="static">
              <TrpgD20 value={roll.d20} tone={tone} size="desktop" />
            </div>
          )}
          {tone === "nat20" ? (
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,rgba(234,179,8,0.22),transparent_58%)]" />
          ) : null}
          {tone === "nat1" ? (
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,rgba(127,29,29,0.28),transparent_60%)]" />
          ) : null}
        </div>
        <p className="text-sm font-semibold tracking-wide text-zinc-100">
          {roll.name} · D20 {roll.d20} {outcome}
        </p>
      </div>
    </div>
  );
}
