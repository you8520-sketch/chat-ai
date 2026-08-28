/**
 * Production D20 presentation tokens. Server d20 / DC / billing stay unchanged.
 * One production dice-box-threejs style plus a non-selectable static fallback.
 */

export const PRODUCTION_DICE_PROTO = "A" as const;
export const TRPG_DICE_IMPLEMENTATION = "dice-box-threejs" as const;
export const TRPG_DICE_PHYSICS_ENGINE = "cannon-es" as const;
export const TRPG_DICE_ENGINE = "production-d20" as const;

export type TrpgD20StaticOverlayTone = "normal" | "nat1" | "nat20";

export type TrpgD20StaticOverlaySpec = {
  baseAsset: string;
  assetReady: boolean;
  label: string;
  overlayDimClass: string;
  numeral: {
    fontFamily: string;
    weight: 600;
    singlePx: number;
    doublePx: number;
    mobileSinglePx: number;
    mobileDoublePx: number;
    letterSpacingDouble: string;
    textShadow: string;
    colors: Record<TrpgD20StaticOverlayTone, string>;
    gradient: Record<TrpgD20StaticOverlayTone, { hi: string; mid: string; lo: string }>;
    glow: Record<TrpgD20StaticOverlayTone, string>;
  };
  frameGlow: Record<TrpgD20StaticOverlayTone, string>;
  burst: {
    nat1: string;
    nat20: string;
  };
};

const PRODUCTION_D20_PALETTE = {
  deepest: "#060608",
  body: "#121018",
  vein: "#1a4030",
  brass: "#d4b56a",
  highlight: "#f0e6c8",
  numeralColor: "#e8dcc0",
  numeralStroke: "#cbb991",
} as const;

const SHARED_TEXT_SHADOW =
  "0 0 1px rgba(20,14,4,0.9), 0 2px 6px rgba(0,0,0,0.65), 0 0 18px rgba(230,211,163,0.28)";

/** Non-selectable static fallback paired with the production 3D dice. */
export const TRPG_PRODUCTION_DICE_STATIC_FALLBACK: TrpgD20StaticOverlaySpec = {
  baseAsset: "/d20-result/obsidian-royal.webp",
  assetReady: true,
  label: "Production D20",
  overlayDimClass: "bg-black/15",
  numeral: {
    fontFamily: "'Cinzel', Georgia, 'Times New Roman', serif",
    weight: 600,
    singlePx: 74,
    doublePx: 60,
    mobileSinglePx: 58,
    mobileDoublePx: 46,
    letterSpacingDouble: "-0.02em",
    textShadow: SHARED_TEXT_SHADOW,
    colors: {
      normal: "#e8dcc0",
      nat1: "#e08a92",
      nat20: "#f5e8b8",
    },
    gradient: {
      normal: { hi: "#fff8e0", mid: "#e8c56a", lo: "#9a7838" },
      nat1: { hi: "#f5c8c8", mid: "#d46878", lo: "#7a2030" },
      nat20: { hi: "#fff6d8", mid: "#f0d068", lo: "#b8862a" },
    },
    glow: {
      normal: "rgba(232,197,106,0.28)",
      nat1: "rgba(180,40,56,0.4)",
      nat20: "rgba(240,210,106,0.5)",
    },
  },
  frameGlow: {
    normal: "drop-shadow-[0_0_28px_rgba(214,199,161,0.28)]",
    nat1: "drop-shadow-[0_0_38px_rgba(138,36,48,0.6)]",
    nat20: "drop-shadow-[0_0_42px_rgba(232,197,106,0.55)]",
  },
  burst: {
    nat1: "radial-gradient(circle,rgba(138,36,48,0.42)_0%,rgba(80,18,40,0.16)_46%,transparent_70%)",
    nat20:
      "radial-gradient(circle,rgba(232,197,106,0.36)_0%,rgba(232,197,106,0.12)_42%,transparent_68%)",
  },
};

export function trpgProductionDiceStaticFallback(): TrpgD20StaticOverlaySpec {
  return TRPG_PRODUCTION_DICE_STATIC_FALLBACK;
}

/** Centered result-confirm HUD paint using the production dice numeral tokens. */
export function trpgD20ResultHudStyle(
  tone: TrpgD20StaticOverlayTone,
  face: number
): {
  haloBackground: string;
  numeral: {
    fontFamily: string;
    fontWeight: 700;
    fontSize: string;
    letterSpacing: string;
    color: string;
    backgroundImage: string;
    backgroundClip: "text";
    WebkitBackgroundClip: "text";
    WebkitTextFillColor: "transparent";
    WebkitTextStroke: string;
    paintOrder: "stroke fill";
    filter: string;
  };
} {
  const numeral = TRPG_PRODUCTION_DICE_STATIC_FALLBACK.numeral;
  const gradient = numeral.gradient[tone];
  const glow = numeral.glow[tone];
  return {
    haloBackground:
      "radial-gradient(circle, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.22) 40%, transparent 70%)",
    numeral: {
      fontFamily: numeral.fontFamily,
      fontWeight: 700,
      fontSize: "clamp(58px, 12vw, 84px)",
      letterSpacing: face >= 10 ? numeral.letterSpacingDouble : "0em",
      color: numeral.colors[tone],
      backgroundImage: `linear-gradient(180deg, ${gradient.hi} 0%, ${gradient.mid} 48%, ${gradient.lo} 100%)`,
      backgroundClip: "text",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      WebkitTextStroke: `1.75px ${PRODUCTION_D20_PALETTE.deepest}`,
      paintOrder: "stroke fill",
      filter: [
        "drop-shadow(0 1px 1px rgba(0,0,0,0.85))",
        "drop-shadow(0 5px 14px rgba(0,0,0,0.62))",
        `drop-shadow(0 0 16px ${glow})`,
        `drop-shadow(0 0 1px ${PRODUCTION_D20_PALETTE.numeralStroke})`,
      ].join(" "),
    },
  };
}

/** Brief confirmation hold after the settled face, then the overlay leaves. Do not wait for GM. */
export const TRPG_D20_HOLD_AFTER_SETTLE_MS = 280;

/** Custom renderer roll duration for the production dice-box-threejs path. */
export const TRPG_D20_ANIMATION_MS = 1_240;

export const TRPG_D20_NAT20_GOLD = "#e8c56a";
export const TRPG_D20_NAT1_CRIMSON = "#8a2430";

/** Muted brass numerals for the production overlay. */
export const TRPG_D20_NUMERAL = PRODUCTION_D20_PALETTE.numeralColor;
export const TRPG_D20_NUMERAL_EDGE = PRODUCTION_D20_PALETTE.numeralStroke;
export const TRPG_D20_NUMERAL_WEIGHT = 600 as const;

export const TRPG_D20_STAGE_DESKTOP = { width: 250, height: 218 } as const;
export const TRPG_D20_STAGE_MOBILE = { width: 186, height: 168 } as const;

export const TRPG_D20_OVERLAY_DIM_CLASS = TRPG_PRODUCTION_DICE_STATIC_FALLBACK.overlayDimClass;

export const TRPG_DICE_BOX_NOTATION = (value: number) => `1d20@${value}`;

/**
 * dice-box-threejs colorset for the production D20.
 * Numerals are rendered by the library onto the 3D face canvas texture (not DOM overlay).
 * Font: Cinzel (loaded via @font-face in globals.css before the dice box initializes).
 */
export const TRPG_DICE_BOX_COLORSET = {
  name: "obsidian-royal",
  foreground: "#e8dcc0",
  background: "#0a0a0e",
  outline: "#06060a",
  edge: "#c8a858",
  texture: "none",
  material: "glass",
  font: "Cinzel",
} as const;

export const TRPG_DICE_ASSET_LICENSES = [
  {
    id: "dice-box-threejs",
    license: "MIT",
    note: "Runtime library only. Package public/textures and public/sounds are not copied.",
  },
  {
    id: "production-d20-face-texture",
    license: "original",
    note: "Runtime-generated canvas. No third-party dice photograph or WotC asset.",
  },
] as const;

export const TRPG_DICE_BOX_THREEJS_ASSETS_COPIED = false;
export const TRPG_DICE_BOX_THREEJS_REVIEWED = true;
