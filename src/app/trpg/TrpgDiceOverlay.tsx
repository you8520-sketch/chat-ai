"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveTrpgD20Tone, trpgRollOutcomeLabel } from "@/lib/trpg/actionCardUi";
import {
  applyTrpgDiceOverlaySession,
  orderTrpgDiceRolls,
  shouldConsumeMountRollSession,
  trpgDiceOverlayAfterSettle,
  trpgDiceOverlaySessionAction,
  trpgDiceOverlayVisible,
  trpgDiceRollSessionKey,
  trpgEmeraldDiceTiming,
  trpgPredeterminedD20Notation,
  trpgResultConfirmPerDieMs,
  TRPG_RESULT_ENTER_MS,
  TRPG_RESULT_EXIT_MS,
} from "@/lib/trpg/diceRollUx";
import {
  PRODUCTION_D20_THEME,
  PRODUCTION_DICE_PROTO,
  TRPG_D20_STAGE_DESKTOP,
  TRPG_D20_STAGE_MOBILE,
  TRPG_DICE_PHYSICS_ENGINE,
  trpgD20StaticOverlaySpec,
  type TrpgD20StaticOverlayTone,
  type TrpgD20ThemeId,
} from "@/lib/trpg/diceVisual";
import TrpgDiceBoxScene from "./TrpgDiceBoxScene";

export type TrpgDiceOverlayPlaybackState = {
  visible: boolean;
  settled: boolean;
  dismissed: boolean;
  roundNumber: number;
  sessionKey: string;
};
import type { TrpgResolutionOrderEntry } from "@/lib/trpg/initiative";
import type { TrpgPublicRoll } from "@/lib/trpg/snapshot";
import { logTrpgDicePreviewInstrument, previewDiceRollKey } from "@/lib/trpg/dicePreviewTheme";

type ResultPhase = "rolling" | "entering" | "holding" | "exiting";

function overlayTone(d20: number, tierTone: ReturnType<typeof resolveTrpgD20Tone>): TrpgD20StaticOverlayTone {
  if (tierTone === "nat20") return "nat20";
  if (tierTone === "nat1") return "nat1";
  return "normal";
}

function detectWebgl(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function TrpgDiceOverlay({
  phase,
  rolls,
  resolutionOrder,
  theme = PRODUCTION_D20_THEME,
  previewInstrument = false,
  roundNumber = 0,
  replayOnMount = false,
  onPlaybackStateChange,
}: {
  phase: string;
  rolls: readonly TrpgPublicRoll[];
  resolutionOrder?: readonly TrpgResolutionOrderEntry[];
  theme?: TrpgD20ThemeId;
  previewInstrument?: boolean;
  roundNumber?: number;
  replayOnMount?: boolean;
  onPlaybackStateChange?: (state: TrpgDiceOverlayPlaybackState) => void;
}) {
  const overlay = useMemo(() => trpgD20StaticOverlaySpec(theme), [theme]);
  const ordered = useMemo(() => orderTrpgDiceRolls(rolls, resolutionOrder), [resolutionOrder, rolls]);
  const sessionKey = useMemo(() => trpgDiceRollSessionKey(roundNumber, ordered), [ordered, roundNumber]);
  const timing = trpgEmeraldDiceTiming(ordered.length);
  const [play, setPlay] = useState({ started: false, dismissed: false, index: 0 });
  const [settled, setSettled] = useState(false);
  const [resultPhase, setResultPhase] = useState<ResultPhase>("rolling");
  const [use3d, setUse3d] = useState(true);
  const prevKeyRef = useRef("");
  const consumedKeysRef = useRef(new Set<string>());
  const firstObservationRef = useRef(true);
  const playRef = useRef(play);
  playRef.current = play;
  const instrumentRef = useRef({ previewInstrument, roundNumber, theme, ordered, phase, sessionKey });
  instrumentRef.current = { previewInstrument, roundNumber, theme, ordered, phase, sessionKey };
  const visible = trpgDiceOverlayVisible(play.started, play.dismissed, ordered.length);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setUse3d(detectWebgl() && !prefersReducedMotion());
  }, []);

  useEffect(() => {
    onPlaybackStateChange?.({
      visible,
      settled,
      dismissed: play.dismissed,
      roundNumber,
      sessionKey,
    });
  }, [onPlaybackStateChange, play.dismissed, roundNumber, sessionKey, settled, visible]);

  useEffect(() => {
    const isFirstObservation = firstObservationRef.current;
    firstObservationRef.current = false;
    if (
      shouldConsumeMountRollSession({
        rollSessionKey: sessionKey,
        replayOnMount,
        isFirstObservation,
      })
    ) {
      consumedKeysRef.current.add(sessionKey);
    }
    const action = trpgDiceOverlaySessionAction({
      rollSessionKey: sessionKey,
      prevRollSessionKey: prevKeyRef.current,
      consumed: sessionKey !== "" && consumedKeysRef.current.has(sessionKey),
      started: playRef.current.started,
      dismissed: playRef.current.dismissed,
    });
    const inst = instrumentRef.current;
    if (inst.previewInstrument) {
      const next = applyTrpgDiceOverlaySession(playRef.current, action);
      logTrpgDicePreviewInstrument({
        roundNumber: inst.roundNumber,
        phase: inst.phase,
        currentRollsLength: ordered.length,
        rollKey: previewDiceRollKey(inst.ordered),
        rollSessionKey: sessionKey,
        overlaySessionAction: action,
        overlayStarted: next.started,
        overlayDismissed: next.dismissed,
        theme: inst.theme,
        overlayMounted: trpgDiceOverlayVisible(next.started, next.dismissed, ordered.length),
      });
    }
    prevKeyRef.current = sessionKey;
    setPlay((current) => {
      const next = applyTrpgDiceOverlaySession(current, action);
      if (action === "start" || action === "clear") {
        setSettled(false);
        setResultPhase("rolling");
      }
      return next;
    });
  }, [ordered.length, replayOnMount, sessionKey]);

  // Called by the 3D scene when physics settles
  const onDieSettled = useCallback(() => {
    setSettled(true);
    setResultPhase("entering");
  }, []);

  // Result confirm phase timing
  useEffect(() => {
    if (resultPhase === "entering") {
      const enter = window.setTimeout(() => setResultPhase("holding"), TRPG_RESULT_ENTER_MS);
      return () => window.clearTimeout(enter);
    }
    if (resultPhase === "holding") {
      const holdMs = TRPG_RESULT_ENTER_MS + trpgResultConfirmPerDieMs(ordered.length) - TRPG_RESULT_ENTER_MS - TRPG_RESULT_EXIT_MS;
      const exit = window.setTimeout(() => setResultPhase("exiting"), holdMs);
      return () => window.clearTimeout(exit);
    }
    if (resultPhase === "exiting") {
      const done = window.setTimeout(() => {
        setSettled(true);
        setPlay((current) => {
          const next = trpgDiceOverlayAfterSettle(current.index, ordered.length);
          if (next.dismissed && sessionKey) consumedKeysRef.current.add(sessionKey);
          return { ...current, index: next.index, dismissed: next.dismissed };
        });
        setResultPhase("rolling");
      }, TRPG_RESULT_EXIT_MS);
      return () => window.clearTimeout(done);
    }
  }, [resultPhase, ordered.length, sessionKey]);

  // Watchdog: if 3D physics takes too long, force settle
  useEffect(() => {
    if (!visible || ordered.length === 0) return;
    const watchdog = window.setTimeout(() => {
      if (!settled) onDieSettled();
    }, 10000);
    return () => window.clearTimeout(watchdog);
  }, [visible, play.index, ordered.length, settled, onDieSettled]);

  if (!visible) return null;
  const roll = ordered[Math.min(play.index, ordered.length - 1)];
  if (!roll) return null;
  const tierTone = resolveTrpgD20Tone(roll.d20, roll.tier);
  const tone = overlayTone(roll.d20, tierTone);
  const outcome = trpgRollOutcomeLabel(roll.tier);
  const notation = trpgPredeterminedD20Notation(roll.d20);
  const face = Math.max(1, Math.min(20, Math.floor(roll.d20)));
  const showResult = resultPhase === "entering" || resultPhase === "holding" || resultPhase === "exiting";
  const resultOpacity =
    resultPhase === "entering" ? 0 :
    resultPhase === "holding" ? 1 :
    resultPhase === "exiting" ? 0 : 0;
  const resultScale =
    resultPhase === "entering" ? 0.92 :
    resultPhase === "holding" ? 1 :
    resultPhase === "exiting" ? 1 : 1;

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-[65] transition-opacity duration-200 ${overlay.overlayDimClass} ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      data-trpg-dice-overlay
      data-trpg-dice-engine={use3d ? "dice-box-threejs" : "static-result"}
      data-trpg-dice-theme={theme}
      data-trpg-dice-theme-label={overlay.label}
      data-trpg-dice-mode={use3d ? "physics" : "static"}
      data-trpg-dice-renderer={use3d ? "dice-box-threejs" : "static"}
      data-trpg-dice-physics={use3d ? "cannon-es" : TRPG_DICE_PHYSICS_ENGINE}
      data-trpg-dice-proto={PRODUCTION_DICE_PROTO}
      data-trpg-dice-value={roll.d20}
      data-trpg-dice-predetermined={notation}
      data-trpg-dice-active-ms={timing.perDieMs}
      data-trpg-dice-hold-ms={0}
      data-trpg-dice-total-ms={timing.totalMs}
      data-trpg-dice-result-phase={resultPhase}
      aria-hidden="true"
    >
      <div className="flex h-full w-full items-center justify-center md:-translate-y-[6%]">
        <div className="flex flex-col items-center">
          <div
            className="relative flex items-center justify-center"
            data-trpg-dice-stage
            data-trpg-dice-stage-w={TRPG_D20_STAGE_DESKTOP.width}
            data-trpg-dice-stage-h={TRPG_D20_STAGE_DESKTOP.height}
            data-trpg-dice-stage-mobile-w={TRPG_D20_STAGE_MOBILE.width}
            data-trpg-dice-stage-mobile-h={TRPG_D20_STAGE_MOBILE.height}
          >
            {/* 3D roll phase */}
            {use3d && !showResult ? (
              <div
                key={`${sessionKey}:${play.index}`}
                className="h-[min(360px,52vw)] w-[min(360px,52vw)] max-md:h-[min(280px,70vw)] max-md:w-[min(280px,70vw)]"
                data-trpg-dice-canvas="3d"
              >
                <TrpgDiceBoxScene
                  value={face}
                  tone={tierTone}
                  reducedQuality={false}
                  onSettled={onDieSettled}
                />
              </div>
            ) : null}

            {/* Static fallback (no WebGL) during roll phase */}
            {!use3d && !showResult ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={overlay.baseAsset}
                  alt=""
                  draggable={false}
                  className="h-[min(218px,32vw)] w-[min(218px,32vw)] max-md:h-[min(168px,40vw)] max-md:w-[min(168px,40vw)] select-none object-contain"
                  data-trpg-dice-canvas="static"
                />
                <span
                  key={`${sessionKey}:${play.index}`}
                  className="pointer-events-none absolute inset-0 flex items-center justify-center font-semibold"
                  style={{
                    color: overlay.numeral.colors[tone],
                    fontFamily: overlay.numeral.fontFamily,
                    fontWeight: overlay.numeral.weight,
                    fontSize: `min(${face >= 10 ? overlay.numeral.doublePx : overlay.numeral.singlePx}px, 12vw)`,
                    textShadow: overlay.numeral.textShadow,
                  }}
                  data-trpg-dice-numeral={face}
                >
                  {face}
                </span>
              </>
            ) : null}

            {/* RESULT_CONFIRM phase: premium cinematic result HUD */}
            {showResult ? (
              <div
                className="relative flex flex-col items-center justify-center transition-all duration-200 ease-out"
                style={{
                  opacity: resultOpacity,
                  transform: `scale(${resultScale})`,
                }}
                data-trpg-dice-result-confirm
                data-trpg-dice-result-tone={tone}
              >
                {/* nat20 effect: champagne-gold radial flare */}
                {tone === "nat20" ? (
                  <div
                    className="pointer-events-none absolute inset-[-30%] rounded-full"
                    style={{
                      background:
                        "radial-gradient(circle, rgba(232,197,106,0.35) 0%, rgba(232,197,106,0.1) 45%, transparent 70%)",
                    }}
                    data-trpg-dice-burst="nat20"
                  />
                ) : null}
                {/* nat1 effect: crimson pulse */}
                {tone === "nat1" ? (
                  <div
                    className="pointer-events-none absolute inset-[-25%] rounded-full"
                    style={{
                      background:
                        "radial-gradient(circle, rgba(138,36,48,0.35) 0%, rgba(80,18,40,0.12) 50%, transparent 72%)",
                    }}
                    data-trpg-dice-burst="nat1"
                  />
                ) : null}
                <span
                  className="font-serif font-semibold leading-none"
                  style={{
                    color: tone === "nat20" ? "#f5e8b8" : tone === "nat1" ? "#e08a92" : "#e8dcc0",
                    fontSize: "min(84px, 12vw)",
                    textShadow:
                      "0 1px 2px rgba(0,0,0,0.6), 0 0 16px rgba(232,197,106,0.22)",
                  }}
                  data-trpg-dice-result-numeral={face}
                >
                  {face}
                </span>
                <p
                  className="mt-3 text-center text-[14px] font-medium tracking-wide"
                  style={{
                    color: roll.success ? "#7ac4a0" : "#d4848e",
                  }}
                  data-trpg-dice-result-outcome={outcome}
                >
                  {outcome}
                </p>
              </div>
            ) : null}
          </div>
          {!showResult ? (
            <p className="mt-2.5 text-center text-[13px] font-medium tracking-wide text-zinc-200/90">
              {roll.name} · D20 {roll.d20} · {outcome}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
