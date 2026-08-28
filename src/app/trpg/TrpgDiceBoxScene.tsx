"use client";

import { useEffect, useRef, useState } from "react";
import type { TrpgD20Tone } from "@/lib/trpg/actionCardUi";
import {
  TRPG_DICE_BOX_COLORSET,
  TRPG_DICE_BOX_NOTATION,
} from "@/lib/trpg/diceVisual";
import { logTrpgDiceRuntimeInstrument } from "@/lib/trpg/dicePreviewTheme";

export type TrpgDiceSettleSource = "physics" | "watchdog" | "init-error" | "static";

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
  previewInstrument = false,
  onSettled,
}: {
  value: number;
  tone: TrpgD20Tone;
  reducedQuality: boolean;
  previewInstrument?: boolean;
  onSettled: (source: TrpgDiceSettleSource) => void;
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
    let operation: "initialize" | "roll" = "initialize";

    const dimensions = () => {
      const host = hostRef.current;
      const canvas = host?.querySelector("canvas");
      return {
        hostWidth: host?.clientWidth ?? null,
        hostHeight: host?.clientHeight ?? null,
        canvasClientWidth: canvas?.clientWidth ?? null,
        canvasClientHeight: canvas?.clientHeight ?? null,
        canvasWidth: canvas?.width ?? null,
        canvasHeight: canvas?.height ?? null,
      };
    };
    const settleInitError = (err: unknown) => {
      console.error("[trpg-dice-box] init/roll failed:", err);
      if (previewInstrument) {
        logTrpgDiceRuntimeInstrument({
          event: "DICE_ERROR_CODE",
          data: {
            boxId: boxIdRef.current,
            code: operation === "initialize" ? "DICE_INIT_ERROR" : "DICE_ROLL_ERROR",
            errorName: err instanceof Error ? err.name : "UnknownError",
            ...dimensions(),
          },
        });
      }
      if (!cancelled && !settledRef.current) {
        settledRef.current = true;
        if (previewInstrument) {
          logTrpgDiceRuntimeInstrument({
            event: "DICE_SETTLE_SOURCE",
            data: { boxId: boxIdRef.current, source: "init-error", operation },
          });
        }
        onSettled("init-error");
      }
    };

    const run = async () => {
      if (cancelled || !hostRef.current) return;
      if (previewInstrument) {
        logTrpgDiceRuntimeInstrument({
          event: "DICE_INIT_STARTED",
          data: { boxId: boxIdRef.current, value, ...dimensions() },
        });
      }
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
          baseScale: 75,
          color_spotlight: 0xefdfd5,
        });
        await box.initialize();
        if (previewInstrument) {
          logTrpgDiceRuntimeInstrument({
            event: "DICE_INITIALIZED",
            data: { boxId: boxIdRef.current, diceListLength: box.diceList.length, ...dimensions() },
          });
        }
        if (cancelled) return;
        box.light.intensity = reducedQuality ? 0.85 : 1.25;
        box.light_amb.intensity = 0.58;
        operation = "roll";
        if (previewInstrument) {
          logTrpgDiceRuntimeInstrument({
            event: "DICE_ROLL_STARTED",
            data: {
              boxId: boxIdRef.current,
              notation: TRPG_DICE_BOX_NOTATION(value),
              diceListLength: box.diceList.length,
              ...dimensions(),
            },
          });
        }
        await box.roll(TRPG_DICE_BOX_NOTATION(value));
        if (previewInstrument) {
          logTrpgDiceRuntimeInstrument({
            event: "DICE_ROLL_RESOLVED",
            data: { boxId: boxIdRef.current, diceListLength: box.diceList.length, ...dimensions() },
          });
        }
        if (cancelled) return;
        if (!settledRef.current) {
          settledRef.current = true;
          if (previewInstrument) {
            logTrpgDiceRuntimeInstrument({
              event: "DICE_SETTLE_SOURCE",
              data: { boxId: boxIdRef.current, source: "physics", diceListLength: box.diceList.length },
            });
          }
          onSettled("physics");
        }
      } catch (err) {
        settleInitError(err);
      }
    };

    run().catch(settleInitError);

    return () => {
      cancelled = true;
      const canvas = hostRef.current?.querySelector("canvas");
      canvas?.remove();
    };
  }, [previewInstrument, ready, onSettled, reducedQuality, tone, value]);

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
