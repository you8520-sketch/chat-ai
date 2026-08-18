"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveTrpgD20Tone, trpgRollOutcomeLabel } from "@/lib/trpg/actionCardUi";
import {
  TRPG_D20_HOLD_AFTER_SETTLE_MS,
  TRPG_DICE_ENGINE,
  TRPG_DICE_RENDERER,
  orderTrpgDiceRolls,
  shouldAnimateTrpgDice3d,
  trpgDiceDurationMs,
  trpgDiceOverlayActive,
  trpgPredeterminedD20Notation,
} from "@/lib/trpg/diceRollUx";
import {
  PRODUCTION_D20_THEME,
  PRODUCTION_DICE_PROTO,
  TRPG_D20_STAGE_DESKTOP,
  TRPG_D20_STAGE_MOBILE,
  TRPG_DICE_PHYSICS_ENGINE,
  trpgD20ThemeSpec,
  type TrpgD20ThemeId,
} from "@/lib/trpg/diceVisual";
import type { TrpgResolutionOrderEntry } from "@/lib/trpg/initiative";
import type { TrpgPublicRoll } from "@/lib/trpg/snapshot";
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
  theme = PRODUCTION_D20_THEME,
}: {
  phase: string;
  rolls: readonly TrpgPublicRoll[];
  resolutionOrder?: readonly TrpgResolutionOrderEntry[];
  theme?: TrpgD20ThemeId;
}) {
  const active = trpgDiceOverlayActive(phase, rolls);
  const ordered = useMemo(() => orderTrpgDiceRolls(rolls, resolutionOrder), [resolutionOrder, rolls]);
  const timing = trpgDiceDurationMs(ordered.length);
  const spec = trpgD20ThemeSpec(theme);
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
      className="pointer-events-none fixed inset-0 z-[65] bg-black/15"
      data-trpg-dice-overlay
      data-trpg-dice-engine={theme === PRODUCTION_D20_THEME ? TRPG_DICE_ENGINE : spec.engine}
      data-trpg-dice-theme={theme}
      data-trpg-dice-mode={use3d ? "3d" : "static"}
      data-trpg-dice-renderer={use3d ? TRPG_DICE_RENDERER : "static"}
      data-trpg-dice-physics={TRPG_DICE_PHYSICS_ENGINE}
      data-trpg-dice-proto={PRODUCTION_DICE_PROTO}
      data-trpg-dice-value={roll.d20}
      data-trpg-dice-predetermined={notation}
      aria-hidden="true"
    >
      <div className="flex h-full w-full items-center justify-center md:-translate-y-[6%]">
        <div className="flex flex-col items-center">
          <div
            className="relative h-[min(218px,32vw)] w-[min(250px,38vw)] max-md:h-[min(168px,40vw)] max-md:w-[min(186px,48vw)] overflow-hidden rounded-2xl"
            data-trpg-dice-stage
            data-trpg-dice-stage-w={TRPG_D20_STAGE_DESKTOP.width}
            data-trpg-dice-stage-h={TRPG_D20_STAGE_DESKTOP.height}
            data-trpg-dice-stage-mobile-w={TRPG_D20_STAGE_MOBILE.width}
            data-trpg-dice-stage-mobile-h={TRPG_D20_STAGE_MOBILE.height}
          >
            {use3d ? (
              <TrpgDiceScene
                value={roll.d20}
                tone={tone}
                theme={theme}
                durationMs={timing.perDie}
                reducedQuality={reducedQuality}
                onSettled={onSettled}
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center [&_svg]:h-[72%] [&_svg]:w-[72%]"
                data-trpg-dice-canvas="static"
              >
                <TrpgD20 value={roll.d20} tone={tone} size="desktop" />
              </div>
            )}
          </div>
          <p className="mt-2.5 text-center text-[13px] font-medium tracking-wide text-zinc-200/90">
            {roll.name} · D20 {roll.d20} · {outcome}
          </p>
        </div>
      </div>
    </div>
  );
}
