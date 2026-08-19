import type { TrpgPublicRoll } from "./snapshot";
import { resolveTrpgDiceTheme } from "./diceThemePrefs";
import { normalizeTrpgD20ThemeId, type TrpgD20ThemeId } from "./diceVisual";

/** Query keys allowed on preview/dev hosts only. */
export const TRPG_DICE_PREVIEW_THEME_QUERY = "diceTheme";
export const TRPG_DICE_PREVIEW_PLAY_QUERY = "dicePreview";

/** Live production Railway host. Preview flags must never apply here. */
export const TRPG_PRODUCTION_APP_HOSTS = ["chat-ai-production-3e84.up.railway.app"] as const;

export function isTrpgProductionAppHost(hostname: string | undefined): boolean {
  const host = (hostname ?? "").trim().toLowerCase();
  if (!host) return false;
  return TRPG_PRODUCTION_APP_HOSTS.some((known) => host === known);
}

export function isTrpgDicePreviewRuntime(opts: {
  nodeEnv?: string;
  previewFlag?: string | undefined;
  hostname?: string;
}): boolean {
  if (isTrpgProductionAppHost(opts.hostname)) return false;
  if (opts.previewFlag === "1") return true;
  const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv !== "production") return true;
  const host = (opts.hostname ?? "").trim().toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") return true;
  if (host.endsWith(".trycloudflare.com") || host.endsWith(".loca.lt") || host.endsWith(".ngrok-free.app")) return true;
  if (host.endsWith(".vercel.app")) return true;
  if (host.endsWith(".up.railway.app") && !host.includes("production")) return true;
  return false;
}

export function parseDiceThemeQuery(value: string | null | undefined): TrpgD20ThemeId | null {
  return normalizeTrpgD20ThemeId(value ?? undefined);
}

export function resolveCampaignOverlayDiceTheme(opts: {
  previewEnabled: boolean;
  queryTheme?: string | null;
  savedTheme?: TrpgD20ThemeId | null;
}): TrpgD20ThemeId {
  return resolveTrpgDiceTheme({
    previewEnabled: opts.previewEnabled,
    queryTheme: opts.queryTheme,
    savedTheme: opts.savedTheme ?? null,
  });
}

/** Fixture injection requires an explicit dicePreview=1/true, never the theme query alone. */
export function shouldInjectPreviewDiceOverlay(opts: {
  previewEnabled: boolean;
  queryTheme?: string | null;
  queryPreview?: string | null;
}): boolean {
  if (!opts.previewEnabled) return false;
  const play = (opts.queryPreview ?? "").trim().toLowerCase();
  return play === "1" || play === "true";
}

export function resolveCampaignDicePreviewOverlay(opts: {
  previewEnabled: boolean;
  queryTheme?: string | null;
  queryPreview?: string | null;
  queryPreviewD20?: string | null;
  savedTheme?: TrpgD20ThemeId | null;
  phase: string;
  currentRolls: readonly TrpgPublicRoll[];
  fixtureName?: string;
}): {
  theme: TrpgD20ThemeId;
  phase: string;
  rolls: readonly TrpgPublicRoll[];
  inject: boolean;
} {
  const theme = resolveCampaignOverlayDiceTheme({
    previewEnabled: opts.previewEnabled,
    queryTheme: opts.queryTheme,
    savedTheme: opts.savedTheme ?? null,
  });
  const inject = shouldInjectPreviewDiceOverlay({
    previewEnabled: opts.previewEnabled,
    queryTheme: opts.queryTheme,
    queryPreview: opts.queryPreview,
  });
  if (!inject) {
    return { theme, phase: opts.phase, rolls: opts.currentRolls, inject: false };
  }
  const previewD20 = parseDicePreviewD20(opts.queryPreviewD20);
  return {
    theme,
    phase: "ROLLING",
    rolls:
      opts.currentRolls.length > 0
        ? opts.currentRolls
        : [previewDiceOverlayFixture(opts.fixtureName, previewD20 ?? 14)],
    inject: true,
  };
}

export type TrpgDicePreviewInstrument = {
  roundNumber: number;
  phase: string;
  currentRollsLength: number;
  rollKey: string;
  rollSessionKey?: string;
  phaseAtFirstRollObservation?: string;
  presentationState?: string;
  gateHeld?: boolean;
  overlayVisible?: boolean;
  overlaySessionAction?: string;
  overlayStarted?: boolean;
  overlayDismissed?: boolean;
  orphanRollCountRendered?: number;
  currentRoundSceneRendered?: boolean;
  releaseReason?: string | null;
  rollObservedAt?: number;
  gateHeldAt?: number;
  overlayVisibleAt?: number;
  overlayDismissedAt?: number;
  firstResultVisibleAt?: number;
  firstNarrationVisibleAt?: number;
  incomingSessionHidden?: boolean;
  watchdogMs?: number;
  theme: TrpgD20ThemeId;
  overlayMounted?: boolean;
};

export function previewDiceRollKey(rolls: readonly { participantId: number; d20: number }[]): string {
  return rolls.map((roll) => `${roll.participantId}:${roll.d20}`).join(",");
}

export function logTrpgDicePreviewInstrument(entry: TrpgDicePreviewInstrument): void {
  if (typeof window === "undefined") return;
  const bag = ((window as Window & { __TRPG_DICE_PREVIEW_LOG?: TrpgDicePreviewInstrument[] })
    .__TRPG_DICE_PREVIEW_LOG ??= []);
  bag.push(entry);
  console.info("[trpg-dice-preview]", entry);
}

export function previewDiceOverlayFixture(name = "권태현", d20 = 14): TrpgPublicRoll {
  const face = Math.max(1, Math.min(20, Math.floor(d20)));
  const tier =
    face === 20 ? "CRITICAL_SUCCESS" : face === 1 ? "CRITICAL_FAILURE" : face + 8 >= 12 ? "SUCCESS" : "FAILURE";
  return {
    participantId: 1,
    name,
    d20: face,
    statKey: "str",
    finalScore: face + 2,
    dc: 12,
    tier,
    success: tier === "SUCCESS" || tier === "CRITICAL_SUCCESS",
    actionBody: "preview-only fixture",
    actionType: "free",
    kind: "human",
  };
}

export function parseDicePreviewD20(value: string | null | undefined): number | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 20) return null;
  return n;
}
