import type { TrpgPublicRoll } from "./snapshot";
import { PRODUCTION_D20_THEME, isTrpgD20ThemeId, type TrpgD20ThemeId } from "./diceVisual";

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
  if (host.endsWith(".trycloudflare.com") || host.endsWith(".loca.lt") || host.endsWith(".ngrok-free.app")) {
    return true;
  }
  if (host.endsWith(".vercel.app")) return true;
  if (host.endsWith(".up.railway.app") && !host.includes("production")) return true;
  return false;
}

export function parseDiceThemeQuery(value: string | null | undefined): TrpgD20ThemeId | null {
  const trimmed = value?.trim();
  if (!trimmed || !isTrpgD20ThemeId(trimmed)) return null;
  return trimmed;
}

export function resolveCampaignOverlayDiceTheme(opts: {
  previewEnabled: boolean;
  queryTheme?: string | null;
}): TrpgD20ThemeId {
  if (!opts.previewEnabled) return PRODUCTION_D20_THEME;
  return parseDiceThemeQuery(opts.queryTheme) ?? PRODUCTION_D20_THEME;
}

export function shouldInjectPreviewDiceOverlay(opts: {
  previewEnabled: boolean;
  queryTheme?: string | null;
  queryPreview?: string | null;
}): boolean {
  if (!opts.previewEnabled) return false;
  const play = (opts.queryPreview ?? "").trim().toLowerCase();
  if (play === "1" || play === "true") return true;
  return parseDiceThemeQuery(opts.queryTheme) === "gilded-verdant-relic";
}

export function previewDiceOverlayFixture(name = "권태현"): TrpgPublicRoll {
  return {
    participantId: 1,
    name,
    d20: 14,
    statKey: "str",
    finalScore: 16,
    dc: 12,
    tier: "SUCCESS",
    success: true,
    actionBody: "preview-only fixture",
    actionType: "free",
    kind: "human",
  };
}
