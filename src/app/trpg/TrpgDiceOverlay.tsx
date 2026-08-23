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
  TRPG_RESULT_ENTER_MS,
  TRPG_RESULT_EXIT_MS,
  TRPG_RESULT_HOLD_MS,
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
import TrpgDiceBoxScene, { type TrpgDiceSettleSource } from "./TrpgDiceBoxScene";

export type TrpgDiceOverlayPlaybackState = {
  visible: boolean;
  settled: boolean;
  dismissed: boolean;
  roundNumber: number;
  sessionKey: string;
};
import type { TrpgResolutionOrderEntry } from "@/lib/trpg/initiative";
import type { TrpgPublicRoll } from "@/lib/trpg/snapshot";
import {
  logTrpgDicePreviewInstrument,
  logTrpgDiceRuntimeInstrument,
  previewDiceRollKey,
} from "@/lib/trpg/dicePreviewTheme";
import {
  decideTrpgDiceRenderer,
  type DiceRendererDecision,
} from "@/lib/trpg/diceRendererDecision";

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

function readDiceRendererDecision(): DiceRendererDecision {
  return decideTrpgDiceRenderer({
    webgl: detectWebgl(),
    reducedMotion: prefersReducedMotion(),
  });
}

function publishDiceRendererDecision(decision: DiceRendererDecision): void {
  if (typeof window === "undefined") return;
  const payload = {
    WEBGL_AVAILABLE: decision.webgl,
    PREFERS_REDUCED_MOTION: decision.reducedMotion,
    SELECTED_RENDERER: decision.renderer,
    FALLBACK_REASON: decision.fallbackReason,
  };
  (window as Window & { __TRPG_DICE_RENDERER_DECISION?: typeof payload }).__TRPG_DICE_RENDERER_DECISION =
    payload;
  console.info("[trpg-dice-renderer]", payload);
  logTrpgDiceRuntimeInstrument({
    event: "DICE_RENDERER_DECISION",
    data: payload,
  });
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
  const [decision, setDecision] = useState<DiceRendererDecision | null>(null);
  const prevKeyRef = useRef("");
  const consumedKeysRef = useRef(new Set<string>());
  const firstObservationRef = useRef(true);
  const rendererLoggedRef = useRef(false);
  const playRef = useRef(play);
  playRef.current = play;
  const instrumentRef = useRef({ previewInstrument, roundNumber, theme, ordered, phase, sessionKey });
  instrumentRef.current = { previewInstrument, roundNumber, theme, ordered, phase, sessionKey };
  const visible = trpgDiceOverlayVisible(play.started, play.dismissed, ordered.length);

  useEffect(() => {
    if (typeof window === "undefined" || rendererLoggedRef.current) return;
    const next = readDiceRendererDecision();
    rendererLoggedRef.current = true;
    setDecision(next);
    publishDiceRendererDecision(next);
    const inst = instrumentRef.current;
    if (inst.previewInstrument) {
      logTrpgDicePreviewInstrument({
        roundNumber: inst.roundNumber,
        phase: inst.phase,
        currentRollsLength: inst.ordered.length,
        rollKey: previewDiceRollKey(inst.ordered),
        rollSessionKey: inst.sessionKey,
        theme: inst.theme,
        overlayMounted: false,
        webglAvailable: next.webgl,
        prefersReducedMotion: next.reducedMotion,
        selectedRenderer: next.renderer,
        fallbackReason: next.fallbackReason,
      });
    }
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
  const onDieSettled = useCallback((_source: TrpgDiceSettleSource) => {
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
      const bucket = ordered.length === 1 ? 1 : ordered.length === 2 ? 2 : ordered.length === 3 ? 3 : 4;
      const holdMs = TRPG_RESULT_HOLD_MS[bucket];
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
      if (!settled) {
        if (previewInstrument) {
          logTrpgDiceRuntimeInstrument({
            event: "DICE_SETTLE_SOURCE",
            data: { source: "watchdog", sessionKey, playIndex: play.index, watchdogMs: 10000 },
          });
        }
        onDieSettled("watchdog");
      }
    }, 10000);
    return () => window.clearTimeout(watchdog);
  }, [visible, play.index, ordered.length, settled, onDieSettled, previewInstrument, sessionKey]);

  const use3d = decision?.renderer === "dice-box-threejs";
  const rendererDiagnostic = decision ? (
    <div
      hidden
      data-trpg-dice-renderer-decision
      data-trpg-dice-webgl={decision.webgl ? "true" : "false"}
      data-trpg-dice-reduced-motion={decision.reducedMotion ? "true" : "false"}
      data-trpg-dice-fallback-reason={decision.fallbackReason}
      data-trpg-dice-renderer={decision.renderer}
    />
  ) : null;
  if (!visible) return rendererDiagnostic;
  const roll = ordered[Math.min(play.index, ordered.length - 1)];
  if (!roll) return rendererDiagnostic;
  const tierTone = resolveTrpgD20Tone(roll.d20, roll.tier);
  const tone = overlayTone(roll.d20, tierTone);
  const outcome = trpgRollOutcomeLabel(roll.tier);
  const notation = trpgPredeterminedD20Notation(roll.d20);
  const face = Math.max(1, Math.min(20, Math.floor(roll.d20)));
  const showResult = resultPhase === "entering" || resultPhase === "holding" || resultPhase === "exiting";
  const resultOpacity =
    resultPhase === "entering" ? 0.3 :
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
      data-trpg-dice-webgl={decision?.webgl ? "true" : "false"}
      data-trpg-dice-reduced-motion={decision?.reducedMotion ? "true" : "false"}
      data-trpg-dice-fallback-reason={decision?.fallbackReason ?? "no-webgl"}
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
            className="relative h-[min(360px,52vw)] w-[min(360px,52vw)] max-md:h-[min(280px,70vw)] max-md:w-[min(280px,70vw)]"
            data-trpg-dice-stage
            data-trpg-dice-stage-w={TRPG_D20_STAGE_DESKTOP.width}
            data-trpg-dice-stage-h={TRPG_D20_STAGE_DESKTOP.height}
            data-trpg-dice-stage-mobile-w={TRPG_D20_STAGE_MOBILE.width}
            data-trpg-dice-stage-mobile-h={TRPG_D20_STAGE_MOBILE.height}
          >
            {/* 3D roll phase — visible during rolling AND entering (no blank frame) */}
            {decision && use3d && resultPhase !== "holding" && resultPhase !== "exiting" ? (
              <div
                key={`${sessionKey}:${play.index}`}
                className="absolute inset-0"
                data-trpg-dice-canvas="3d"
              >
                <TrpgDiceBoxScene
                  value={face}
                  tone={tierTone}
                  reducedQuality={false}
                  previewInstrument={previewInstrument}
                  onSettled={onDieSettled}
                />
              </div>
            ) : null}

            {/* Static fallback (no WebGL) during roll + entering phase */}
            {decision && !use3d && resultPhase !== "holding" && resultPhase !== "exiting" ? (
              <div className="absolute inset-0 flex items-center justify-center">
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
              </div>
            ) : null}

            {/* RESULT_CONFIRM phase: premium cinematic result HUD */}
            {showResult ? (
              <div
                className="absolute inset-0 z-10 flex flex-col items-center justify-center transition-all duration-200 ease-out"
                style={{
                  opacity: resultOpacity,
                  transform: `scale(${resultScale})`,
                }}
                data-trpg-dice-result-confirm
                data-trpg-dice-result-tone={tone}
              >
                {/* nat20 effect: champagne-gold radial flare + expanding ring + sparks */}
                {tone === "nat20" ? (
                  <>
                    <div
                      className="pointer-events-none absolute inset-[-30%] rounded-full"
                      style={{
                        background:
                          "radial-gradient(circle, rgba(232,197,106,0.35) 0%, rgba(232,197,106,0.1) 45%, transparent 70%)",
                      }}
                      data-trpg-dice-burst="nat20"
                    />
                    <div
                      className="pointer-events-none absolute inset-[-20%] rounded-full border-2"
                      style={{
                        borderColor: "rgba(232,197,106,0.6)",
                        animation: "trpg-nat-ring 380ms ease-out",
                      }}
                      data-trpg-dice-burst-ring="nat20"
                    />
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={`nat20-spark-${i}`}
                        className="pointer-events-none absolute h-1 w-1 rounded-full"
                        style={{
                          background: "#f5e8b8",
                          top: `${30 + Math.sin(i * 1.2) * 25}%`,
                          left: `${40 + Math.cos(i * 0.9) * 28}%`,
                          animation: "trpg-nat-spark 400ms ease-out",
                          animationDelay: `${i * 30}ms`,
                        }}
                        data-trpg-dice-burst-spark="nat20"
                      />
                    ))}
                  </>
                ) : null}
                {/* nat1 effect: crimson pulse + expanding shock ring + dark-red vignette */}
                {tone === "nat1" ? (
                  <>
                    <div
                      className="pointer-events-none absolute inset-[-25%] rounded-full"
                      style={{
                        background:
                          "radial-gradient(circle, rgba(138,36,48,0.35) 0%, rgba(80,18,40,0.12) 50%, transparent 72%)",
                      }}
                      data-trpg-dice-burst="nat1"
                    />
                    <div
                      className="pointer-events-none absolute inset-[-18%] rounded-full border-2"
                      style={{
                        borderColor: "rgba(180,40,56,0.5)",
                        animation: "trpg-nat-ring 320ms ease-out",
                      }}
                      data-trpg-dice-burst-ring="nat1"
                    />
                    <div
                      className="pointer-events-none absolute inset-[-10%] rounded-full"
                      style={{
                        background:
                          "radial-gradient(circle, transparent 50%, rgba(40,8,16,0.25) 100%)",
                        animation: "trpg-nat-vignette 350ms ease-out",
                      }}
                      data-trpg-dice-burst-vignette="nat1"
                    />
                  </>
                ) : null}
                <span
                  className="font-semibold leading-none"
                  style={{
                    color: tone === "nat20" ? "#f5e8b8" : tone === "nat1" ? "#e08a92" : "#e8dcc0",
                    fontFamily: "'Cinzel', Georgia, 'Times New Roman', serif",
                    fontSize: "clamp(58px, 12vw, 84px)",
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
        </div>
      </div>
    </div>
  );
}
