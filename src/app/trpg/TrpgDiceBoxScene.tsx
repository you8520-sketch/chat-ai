"use client";

import { useEffect, useRef } from "react";
import DiceBox from "@3d-dice/dice-box-threejs";
import type { TrpgD20Tone } from "@/lib/trpg/actionCardUi";
import {
  TRPG_D20_NUMERAL,
  TRPG_DICE_BOX_COLORSET,
  TRPG_DICE_BOX_NOTATION,
} from "@/lib/trpg/diceVisual";

function colorsetForTone(tone: TrpgD20Tone) {
  if (tone === "nat20") {
    return {
      ...TRPG_DICE_BOX_COLORSET,
      name: "obsidian-relic-nat20",
      foreground: "#ffe7a3",
      outline: "#c9a227",
      background: "#241c10",
    };
  }
  if (tone === "nat1") {
    return {
      ...TRPG_DICE_BOX_COLORSET,
      name: "obsidian-relic-nat1",
      foreground: "#ffd4d6",
      outline: "#6b1c24",
      background: "#1c1014",
    };
  }
  return {
    ...TRPG_DICE_BOX_COLORSET,
    foreground: TRPG_D20_NUMERAL,
  };
}

function applyTabletopCamera(box: {
  camera: { position: { set: (x: number, y: number, z: number) => void }; lookAt: (x: number, y: number, z: number) => void };
  cameraHeight: { far: number };
}) {
  const far = box.cameraHeight.far;
  box.camera.position.set(0, -far * 0.4, far * 0.78);
  box.camera.lookAt(0, 0, 0);
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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    settledRef.current = false;
    let cancelled = false;
    let rim: ReturnType<DiceBox["light"]["clone"]> | null = null;
    let pulse: number | null = null;

    const run = async () => {
      if (cancelled || !hostRef.current) return;
      const box = new DiceBox(`#${boxIdRef.current}`, {
        assetPath: "/",
        sounds: false,
        shadows: !reducedQuality,
        theme_surface: "green-felt",
        theme_texture: "",
        theme_material: "glass",
        theme_customColorset: colorsetForTone(tone),
        gravity_multiplier: 560,
        light_intensity: reducedQuality ? 0.55 : 0.82,
        strength: 1.15,
        color_spotlight: tone === "nat20" ? 0xf0d78c : tone === "nat1" ? 0xc07070 : 0xefdfd5,
      });
      await box.initialize();
      if (cancelled) return;
      applyTabletopCamera(box);
      box.light.intensity = reducedQuality ? 0.7 : 1.05;
      box.light_amb.intensity = 0.42;
      rim = box.light.clone();
      rim.intensity = tone === "nat20" || tone === "nat1" ? 0.38 : 0.22;
      rim.position.set(-box.light.position.x * 0.35, box.light.position.y * 0.2, box.light.position.z * 0.55);
      box.scene.add(rim);
      if (tone === "nat20" || tone === "nat1") {
        const started = performance.now();
        const tick = (now: number) => {
          if (cancelled || !rim) return;
          const wave = Math.sin((now - started) / 80);
          rim.intensity = 0.28 + wave * 0.16;
          pulse = requestAnimationFrame(tick);
        };
        pulse = requestAnimationFrame(tick);
      }
      await box.roll(TRPG_DICE_BOX_NOTATION(value));
      if (cancelled) return;
      applyTabletopCamera(box);
      if (!settledRef.current) {
        settledRef.current = true;
        onSettled();
      }
    };

    run().catch(() => {
      if (!cancelled && !settledRef.current) {
        settledRef.current = true;
        onSettled();
      }
    });

    return () => {
      cancelled = true;
      if (pulse != null) cancelAnimationFrame(pulse);
      const canvas = host.querySelector("canvas");
      canvas?.remove();
    };
  }, [onSettled, reducedQuality, tone, value]);

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
