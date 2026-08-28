"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveTrpgD20Tone, trpgRollOutcomeLabel } from "@/lib/trpg/actionCardUi";
import {
  buildTrpgDiceContextViewModel,
  trpgDiceActorStatLine,
  trpgDiceA11yStatus,
  trpgDiceResultFormulaLine,
  trpgDiceResultVisible,
  trpgDiceTargetDcLine,
} from "@/lib/trpg/diceContextHud";
import {
  applyTrpgDiceOverlaySession,
  orderTrpgDiceRolls,
  shouldConsumeMountRollSession,
  trpgDiceOverlayAfterSettle,
  trpgDiceOverlayPlaybackReport,
  trpgDiceOverlayPlayOwnerSessionKey,
  trpgDiceOverlaySessionAction,
  trpgDiceOverlayVisible,
  trpgDiceRollSessionKey,
  trpgEmeraldDiceTiming,
  trpgPredeterminedD20Notation,
  TRPG_RESULT_ENTER_MS,
  TRPG_RESULT_EXIT_MS,
  TRPG_RESULT_HOLD_MS,
  TRPG_STATIC_SETTLE_MS,
  isTrpgStaticSettleTimerStale,
  shouldScheduleTrpgStaticSettle,
} from "@/lib/trpg/diceRollUx";
import {
  PRODUCTION_DICE_PROTO,
  TRPG_D20_STAGE_DESKTOP,
  TRPG_D20_STAGE_MOBILE,
  TRPG_DICE_PHYSICS_ENGINE,
  trpgD20ResultHudStyle,
  trpgProductionDiceStaticFallback,
  type TrpgD20StaticOverlayTone,
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
import type { ActivePresentationRollProgress } from "@/lib/trpg/roundPresentation";
import type { TrpgPublicRoll } from "@/lib/trpg/snapshot";
import type { TrpgStatDefinition } from "@/lib/trpg/types";
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
  previewInstrument = false,
  roundNumber = 0,
  replayOnMount = false,
  rollProgress = null,
  statDefs = [],
  onPlaybackStateChange,
}: {
  phase: string;
  rolls: readonly TrpgPublicRoll[];
  resolutionOrder?: readonly TrpgResolutionOrderEntry[];
  previewInstrument?: boolean;
  roundNumber?: number;
  replayOnMount?: boolean;
  rollProgress?: ActivePresentationRollProgress | null;
  statDefs?: readonly TrpgStatDefinition[];
  onPlaybackStateChange?: (state: TrpgDiceOverlayPlaybackState) => void;
}) {
  const overlay = useMemo(() => trpgProductionDiceStaticFallback(), []);
  const ordered = useMemo(() => orderTrpgDiceRolls(rolls, resolutionOrder), [resolutionOrder, rolls]);
  const sessionKey = useMemo(() => trpgDiceRollSessionKey(roundNumber, ordered), [ordered, roundNumber]);
  const timing = trpgEmeraldDiceTiming(ordered.length);
  const [play, setPlay] = useState({ started: false, dismissed: false, index: 0 });
  const [settled, setSettled] = useState(false);
  const [resultPhase, setResultPhase] = useState<ResultPhase>("rolling");
  const [decision, setDecision] = useState<DiceRendererDecision | null>(null);
  const prevKeyRef = useRef("");
  const playOwnerSessionKeyRef = useRef("");
  const consumedKeysRef = useRef(new Set<string>());
  const firstObservationRef = useRef(true);
  const rendererLoggedRef = useRef(false);
  const playRef = useRef(play);
  playRef.current = play;
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;
  const instrumentRef = useRef({ previewInstrument, roundNumber, ordered, phase, sessionKey });
  instrumentRef.current = { previewInstrument, roundNumber, ordered, phase, sessionKey };
  const visible = trpgDiceOverlayVisible(play.started, play.dismissed, ordered.length);
  const use3d = decision?.renderer === "dice-box-threejs";

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
        overlayMounted: false,
        webglAvailable: next.webgl,
        prefersReducedMotion: next.reducedMotion,
        selectedRenderer: next.renderer,
        fallbackReason: next.fallbackReason,
      });
    }
  }, []);

  useEffect(() => {
    const report = trpgDiceOverlayPlaybackReport({
      incomingSessionKey: sessionKey,
      playOwnerSessionKey: playOwnerSessionKeyRef.current,
      play,
      settled,
      rollCount: ordered.length,
    });
    onPlaybackStateChange?.({
      visible: report.visible,
      settled: report.settled,
      dismissed: report.dismissed,
      roundNumber,
      sessionKey: report.sessionKey,
    });
  }, [onPlaybackStateChange, play, ordered.length, roundNumber, sessionKey, settled]);

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
        overlayMounted: trpgDiceOverlayVisible(next.started, next.dismissed, ordered.length),
      });
    }
    prevKeyRef.current = sessionKey;
    playOwnerSessionKeyRef.current = trpgDiceOverlayPlayOwnerSessionKey(action, sessionKey);
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

  // Static renderer: deterministic settle lifecycle (no physics owner)
  useEffect(() => {
    if (
      !shouldScheduleTrpgStaticSettle({
        visible,
        renderer: decision?.renderer,
        resultPhase,
        settled,
      })
    ) {
      return;
    }
    const scheduledSessionKey = sessionKey;
    const scheduledPlayIndex = play.index;
    const timer = window.setTimeout(() => {
      if (
        isTrpgStaticSettleTimerStale({
          scheduledSessionKey,
          scheduledPlayIndex,
          currentSessionKey: sessionKeyRef.current,
          currentPlayIndex: playRef.current.index,
        })
      ) {
        return;
      }
      if (previewInstrument) {
        logTrpgDiceRuntimeInstrument({
          event: "DICE_SETTLE_SOURCE",
          data: {
            source: "static",
            sessionKey: scheduledSessionKey,
            playIndex: scheduledPlayIndex,
            staticSettleMs: TRPG_STATIC_SETTLE_MS,
          },
        });
      }
      onDieSettled("static");
    }, TRPG_STATIC_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [
    visible,
    decision?.renderer,
    resultPhase,
    settled,
    sessionKey,
    play.index,
    onDieSettled,
    previewInstrument,
  ]);

  // Watchdog: if 3D physics takes too long, force settle (WebGL only — static uses TRPG_STATIC_SETTLE_MS)
  useEffect(() => {
    if (!visible || ordered.length === 0 || !use3d) return;
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
  }, [visible, play.index, ordered.length, settled, onDieSettled, previewInstrument, sessionKey, use3d]);

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
  const showResult = trpgDiceResultVisible(resultPhase);
  const context = buildTrpgDiceContextViewModel({ roll, progress: rollProgress, statDefs });
  const a11yStatus = trpgDiceA11yStatus(context, showResult);
  const resultOpacity =
    resultPhase === "entering" ? 0.3 :
    resultPhase === "holding" ? 1 :
    resultPhase === "exiting" ? 0 : 0;
  const resultScale =
    resultPhase === "entering" ? 0.92 :
    resultPhase === "holding" ? 1 :
    resultPhase === "exiting" ? 1 : 1;
  const resultHud = trpgD20ResultHudStyle(tone, face);

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
      data-trpg-dice-visual="production-d20"
      data-trpg-dice-visual-label={overlay.label}
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
      data-trpg-dice-static-settle-ms={!use3d ? TRPG_STATIC_SETTLE_MS : undefined}
      data-trpg-dice-roll-ordinal={context.rollOrdinal}
      data-trpg-dice-roll-total={context.rollTotal}
      data-trpg-dice-actor-id={context.actorId}
      data-trpg-dice-actor-name={context.actorName}
      data-trpg-dice-stat-key={context.statKey}
      data-trpg-dice-stat-label={context.statLabel}
      data-trpg-dice-action-type={context.actionType ?? undefined}
      data-trpg-dice-action-summary={context.actionSummary}
      data-trpg-dice-d20={context.d20}
      data-trpg-dice-combined-modifier={context.combinedModifier}
      data-trpg-dice-final-score={context.finalScore}
      data-trpg-dice-dc={context.dc}
      data-trpg-dice-tier={context.tier}
    >
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {a11yStatus}
      </p>
      <div aria-hidden="true" className="absolute inset-0">
        <div
          className="absolute inset-x-3 top-[max(1rem,env(safe-area-inset-top))] z-20 mx-auto max-w-xl rounded-2xl border border-white/10 bg-[#111522]/80 px-4 py-3 text-center shadow-lg backdrop-blur-sm sm:px-5"
          data-trpg-dice-context
          data-trpg-dice-context-phase={showResult ? "result" : "rolling"}
        >
          <p className="text-[11px] font-semibold tracking-[0.16em] text-zinc-400 sm:text-xs">
            판정 {context.rollOrdinal} / {context.rollTotal}
          </p>
          <p
            className="mt-1 text-lg font-bold text-white sm:text-xl"
            data-trpg-dice-actor-stat-line
          >
            {trpgDiceActorStatLine(context)}
          </p>
          {!showResult && context.actionTypeLabel ? (
            <p className="mt-1">
              <span
                className="inline-flex rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-semibold text-zinc-300 sm:text-sm"
                data-trpg-dice-action-type-label
              >
                {context.actionTypeLabel}
              </span>
            </p>
          ) : null}
          {!showResult ? (
            <p
              className="mt-1.5 text-xs font-semibold text-amber-100/90 sm:text-sm"
              data-trpg-dice-target-dc
            >
              {trpgDiceTargetDcLine(context.dc)}
            </p>
          ) : null}
          {!showResult && context.actionSummary ? (
            <p
              className="mx-auto mt-2 max-w-lg overflow-hidden text-xs leading-5 text-zinc-200 sm:text-sm"
              style={{
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
              }}
              data-trpg-dice-action-summary-visible
            >
              「{context.actionSummary}」
            </p>
          ) : null}
        </div>
      </div>
      <div aria-hidden="true" className="flex h-full w-full items-center justify-center pt-28 md:-translate-y-[2%]">
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
                <div
                  className="pointer-events-none absolute inset-[-6%] rounded-full"
                  style={{ background: resultHud.haloBackground }}
                  data-trpg-dice-result-halo
                />
                <span
                  className="relative leading-none"
                  style={resultHud.numeral}
                  data-trpg-dice-result-numeral={face}
                >
                  {face}
                </span>
                <p
                  className="relative mt-3 max-w-[min(92vw,20rem)] text-center text-xs font-medium tracking-wide text-zinc-100 sm:text-sm"
                  data-trpg-dice-result-formula
                >
                  {trpgDiceResultFormulaLine(context)}
                </p>
                <p
                  className="relative mt-1.5 text-xs font-semibold text-amber-100/90 sm:text-sm"
                  data-trpg-dice-target-dc
                >
                  {trpgDiceTargetDcLine(context.dc)}
                </p>
                <p
                  className="relative mt-2 rounded-full bg-black/40 px-2.5 py-0.5 text-center text-[14px] font-medium tracking-wide"
                  style={{
                    color: roll.success ? "#7ac4a0" : "#d4848e",
                    textShadow: "0 1px 2px rgba(0,0,0,0.85), 0 0 1px rgba(0,0,0,0.9)",
                    WebkitTextStroke: "0.65px rgba(6,6,8,0.7)",
                    paintOrder: "stroke fill",
                  }}
                  data-trpg-dice-result-outcome={outcome}
                  data-trpg-dice-result-tier
                >
                  {context.tierLabel}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
