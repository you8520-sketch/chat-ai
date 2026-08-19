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

function overlayTone(d20: number, tierTone: ReturnType<typeof resolveTrpgD20Tone>): TrpgD20StaticOverlayTone {
  if (tierTone === "nat20") return "nat20";
  if (tierTone === "nat1") return "nat1";
  return "normal";
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
  const [entered, setEntered] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const prevKeyRef = useRef("");
  const consumedKeysRef = useRef(new Set<string>());
  const firstObservationRef = useRef(true);
  const playRef = useRef(play);
  playRef.current = play;
  const instrumentRef = useRef({ previewInstrument, roundNumber, theme, ordered, phase, sessionKey });
  instrumentRef.current = { previewInstrument, roundNumber, theme, ordered, phase, sessionKey };
  const visible = trpgDiceOverlayVisible(play.started, play.dismissed, ordered.length);

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
      if (action === "start" || action === "clear") setSettled(false);
      return next;
    });
  }, [ordered.length, replayOnMount, sessionKey]);

  const onSettled = useCallback(() => {
    setSettled(true);
    setPlay((current) => {
      const next = trpgDiceOverlayAfterSettle(current.index, ordered.length);
      if (next.dismissed && sessionKey) consumedKeysRef.current.add(sessionKey);
      return { ...current, index: next.index, dismissed: next.dismissed };
    });
  }, [ordered.length, sessionKey]);

  useEffect(() => {
    if (!visible || ordered.length === 0) return;
    setEntered(false);
    setLeaving(false);
    const enter = window.setTimeout(() => setEntered(true), 20);
    const perDie = Math.max(320, timing.perDieMs);
    const exitAt = Math.max(60, perDie - 220);
    const exit = window.setTimeout(() => setLeaving(true), exitAt);
    const done = window.setTimeout(() => onSettled(), perDie);
    return () => {
      window.clearTimeout(enter);
      window.clearTimeout(exit);
      window.clearTimeout(done);
    };
  }, [visible, play.index, ordered.length, timing.perDieMs, onSettled]);

  if (!visible) return null;
  const roll = ordered[Math.min(play.index, ordered.length - 1)];
  if (!roll) return null;
  const tierTone = resolveTrpgD20Tone(roll.d20, roll.tier);
  const tone = overlayTone(roll.d20, tierTone);
  const outcome = trpgRollOutcomeLabel(roll.tier);
  const notation = trpgPredeterminedD20Notation(roll.d20);
  const face = Math.max(1, Math.min(20, Math.floor(roll.d20)));
  const twoDigit = face >= 10;
  const numeralPx = twoDigit ? overlay.numeral.doublePx : overlay.numeral.singlePx;
  const mobileNumeralPx = twoDigit ? overlay.numeral.mobileDoublePx : overlay.numeral.mobileSinglePx;
  const numeralGradient = overlay.numeral.gradient[tone];
  const numeralGlow = overlay.numeral.glow[tone];

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-[65] transition-opacity duration-200 ${overlay.overlayDimClass} ${
        entered && !leaving ? "opacity-100" : "opacity-0"
      }`}
      data-trpg-dice-overlay
      data-trpg-dice-engine="static-result"
      data-trpg-dice-theme={theme}
      data-trpg-dice-theme-label={overlay.label}
      data-trpg-dice-theme-asset-ready={overlay.assetReady ? "1" : "0"}
      data-trpg-dice-mode="static"
      data-trpg-dice-renderer="static"
      data-trpg-dice-physics={TRPG_DICE_PHYSICS_ENGINE}
      data-trpg-dice-proto={PRODUCTION_DICE_PROTO}
      data-trpg-dice-value={roll.d20}
      data-trpg-dice-predetermined={notation}
      data-trpg-dice-active-ms={timing.perDieMs}
      data-trpg-dice-hold-ms={0}
      data-trpg-dice-total-ms={timing.totalMs}
      aria-hidden="true"
    >
      <div className="flex h-full w-full items-center justify-center md:-translate-y-[6%]">
        <div className="flex flex-col items-center">
          <div
            className={`relative flex items-center justify-center transition-all duration-200 ease-out ${
              entered && !leaving ? "scale-100 opacity-100" : "scale-[0.94] opacity-0"
            }`}
            data-trpg-dice-stage
            data-trpg-dice-stage-w={TRPG_D20_STAGE_DESKTOP.width}
            data-trpg-dice-stage-h={TRPG_D20_STAGE_DESKTOP.height}
            data-trpg-dice-stage-mobile-w={TRPG_D20_STAGE_MOBILE.width}
            data-trpg-dice-stage-mobile-h={TRPG_D20_STAGE_MOBILE.height}
          >
            <div className={`relative ${overlay.frameGlow[tone]}`}>
              {tone === "nat20" ? (
                <div
                  className="pointer-events-none absolute inset-[-18%] rounded-full"
                  style={{ background: overlay.burst.nat20 }}
                  data-trpg-dice-burst="nat20"
                />
              ) : null}
              {tone === "nat1" ? (
                <div
                  className="pointer-events-none absolute inset-[-16%] rounded-full"
                  style={{ background: overlay.burst.nat1 }}
                  data-trpg-dice-burst="nat1"
                />
              ) : null}
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
                className="pointer-events-none absolute inset-0 flex items-center justify-center font-semibold max-md:[font-size:var(--trpg-d20-mobile-numeral)] [font-size:var(--trpg-d20-numeral)]"
                style={{
                  ["--trpg-d20-numeral" as string]: `min(${numeralPx}px, ${twoDigit ? "10vw" : "12vw"})`,
                  ["--trpg-d20-mobile-numeral" as string]: `min(${mobileNumeralPx}px, ${twoDigit ? "12vw" : "15vw"})`,
                  fontFamily: overlay.numeral.fontFamily,
                  fontWeight: overlay.numeral.weight,
                  background: `linear-gradient(180deg, ${numeralGradient.hi}, ${numeralGradient.mid}, ${numeralGradient.lo})`,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  filter: `drop-shadow(0 1px 1px rgba(20,14,4,0.9)) drop-shadow(0 2px 4px rgba(0,0,0,0.6)) drop-shadow(0 0 14px ${numeralGlow})`,
                  letterSpacing: twoDigit ? overlay.numeral.letterSpacingDouble : "0",
                }}
                data-trpg-dice-numeral={face}
              >
                {face}
              </span>
            </div>
          </div>
          <p className="mt-2.5 text-center text-[13px] font-medium tracking-wide text-zinc-200/90">
            {roll.name} · D20 {roll.d20} · {outcome}
          </p>
        </div>
      </div>
    </div>
  );
}
