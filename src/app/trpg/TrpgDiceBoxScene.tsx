"use client";

import { useEffect, useRef, useState } from "react";
import type { TrpgD20Tone } from "@/lib/trpg/actionCardUi";
import {
  TRPG_DICE_BOX_COLORSET,
  TRPG_DICE_BOX_NOTATION,
} from "@/lib/trpg/diceVisual";

async function ensureCinzelLoaded(): Promise<void> {
  if (typeof document === "undefined" || !(document as { fonts?: FontFaceSet }).fonts) return;
  try {
    await (document as { fonts: FontFaceSet }).fonts.load('900 100px "Cinzel"');
    await (document as { fonts: FontFaceSet }).fonts.ready;
  } catch {
    /* font load best-effort; canvas falls back to serif */
  }
}

export default function TrpgDiceBoxScene({
  value,
  tone,
  reducedQuality,
  onSettled,
}: {
  value: number;
  tone: TrpgD20Tone;
  reducedQuality: boolean;
  onSettled: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boxIdRef = useRef(`trpg-dice-box-${Math.random().toString(36).slice(2, 10)}`);
  const settledRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !hostRef.current) return;
    settledRef.current = false;
    let cancelled = false;

    const run = async () => {
      if (cancelled || !hostRef.current) return;
      await ensureCinzelLoaded();
      if (cancelled) return;
      try {
        const DiceBox = (await import("@3d-dice/dice-box-threejs")).default;
        if (cancelled) return;
        const box = new DiceBox(`#${boxIdRef.current}`, {
          assetPath: "/",
          sounds: false,
          shadows: !reducedQuality,
          theme_surface: "stainless",
          theme_texture: "",
          theme_material: "glass",
          theme_customColorset: TRPG_DICE_BOX_COLORSET,
          gravity_multiplier: 400,
          light_intensity: reducedQuality ? 0.7 : 1.05,
          strength: 1,
          baseScale: 50,
          color_spotlight: 0xefdfd5,
        });
        await box.initialize();
        if (cancelled) return;
        box.light.intensity = reducedQuality ? 0.85 : 1.25;
        box.light_amb.intensity = 0.58;
        await box.roll(TRPG_DICE_BOX_NOTATION(value));
        if (cancelled) return;
        if (!settledRef.current) {
          settledRef.current = true;
          onSettled();
        }
      } catch (err) {
        console.error("[trpg-dice-box] init/roll failed:", err);
        if (!cancelled && !settledRef.current) {
          settledRef.current = true;
          onSettled();
        }
      }
    };

    run().catch((err) => {
      console.error("[trpg-dice-box] run catch:", err);
      if (!cancelled && !settledRef.current) {
        settledRef.current = true;
        onSettled();
      }
    });

    return () => {
      cancelled = true;
      const canvas = hostRef.current?.querySelector("canvas");
      canvas?.remove();
    };
  }, [ready, onSettled, reducedQuality, tone, value]);

  if (!ready) return null;
  return (
    <div
      id={boxIdRef.current}
      ref={hostRef}
      className="h-full w-full bg-transparent"
      data-trpg-dice-canvas="3d"
      data-trpg-dice-proto="dice-box-threejs"
      data-trpg-dice-notation={TRPG_DICE_BOX_NOTATION(value)}
    />
  );
}
