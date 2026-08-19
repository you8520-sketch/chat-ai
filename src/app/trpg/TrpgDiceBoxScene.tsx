"use client";

import { useEffect, useRef } from "react";
import DiceBox from "@3d-dice/dice-box-threejs";
import type { TrpgD20Tone } from "@/lib/trpg/actionCardUi";
import {
  TRPG_DICE_BOX_COLORSET,
  TRPG_DICE_BOX_NOTATION,
} from "@/lib/trpg/diceVisual";

function colorsetForTone(tone: TrpgD20Tone) {
  if (tone === "nat20") {
    return {
      ...TRPG_DICE_BOX_COLORSET,
      name: "obsidian-royal-nat20",
      foreground: "#fff5cc",
      edge: "#e8c56a",
      color_spotlight: 0xf0d78c,
    };
  }
  if (tone === "nat1") {
    return {
      ...TRPG_DICE_BOX_COLORSET,
      name: "obsidian-royal-nat1",
      foreground: "#f0c8d0",
      edge: "#8a2430",
      color_spotlight: 0xc07070,
    };
  }
  return TRPG_DICE_BOX_COLORSET;
}

function renderBox(box: DiceBox) {
  box.renderer.render(box.scene, box.camera);
}

function applyWideCamera(box: DiceBox) {
  const far = box.cameraHeight.far;
  box.camera.position.set(0, -far * 0.16, far);
  box.camera.lookAt(0, 0, 0);
  renderBox(box);
}

function applyCloseCamera(box: DiceBox, target: { x: number; y: number; z: number }) {
  box.camera.position.set(target.x + 20, target.y - 140, 390);
  box.camera.lookAt(target.x, target.y, 8);
  renderBox(box);
}

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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    settledRef.current = false;
    let cancelled = false;
    let rim: ReturnType<DiceBox["light"]["clone"]> | null = null;
    let pulse: number | null = null;

    const run = async () => {
      if (cancelled || !hostRef.current) return;
      await ensureCinzelLoaded();
      if (cancelled) return;
      const colorset = colorsetForTone(tone);
      const box = new DiceBox(`#${boxIdRef.current}`, {
        assetPath: "/",
        sounds: false,
        shadows: !reducedQuality,
        theme_surface: "black",
        theme_texture: "",
        theme_material: "glass",
        theme_customColorset: colorset,
        gravity_multiplier: 620,
        light_intensity: reducedQuality ? 0.7 : 1.05,
        strength: 1.05,
        color_spotlight: (colorset as { color_spotlight?: number }).color_spotlight ?? 0xefdfd5,
      });
      await box.initialize();
      if (cancelled) return;
      applyWideCamera(box);
      box.light.intensity = reducedQuality ? 0.85 : 1.25;
      box.light_amb.intensity = 0.58;
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
      const landed = box.diceList[0]?.position;
      if (landed) applyCloseCamera(box, landed);
      else applyWideCamera(box);
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
