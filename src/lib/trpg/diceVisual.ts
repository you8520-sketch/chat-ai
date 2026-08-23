/**
 * Production D20 presentation tokens. Server d20 / DC / billing stay unchanged.
 * Live overlay uses one static result system with swappable visual themes.
 */

export const PRODUCTION_DICE_PROTO = "A" as const;
export const TRPG_DICE_IMPLEMENTATION = "dice-box-threejs" as const;
export const TRPG_DICE_PHYSICS_ENGINE = "cannon-es" as const;

export type TrpgD20ThemeId = "obsidian-royal" | "ancient-reliquary" | "gemstone-arcane";

export const PRODUCTION_D20_THEME: TrpgD20ThemeId = "obsidian-royal";
export const TRPG_D20_THEME = PRODUCTION_D20_THEME;
export const TRPG_DICE_ENGINE = "obsidian-royal-d20" as const;

/** Legacy preview/lab ids mapped onto the current theme set. */
const LEGACY_THEME_ALIASES: Record<string, TrpgD20ThemeId> = {
  "verdant-relic": "obsidian-royal",
  "emerald-relic": "gemstone-arcane",
};

export type TrpgD20ThemeTexture = "obsidian-gold" | "oxidized-bronze" | "arcane-crystal";

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

export type TrpgD20ThemeSpec = {
  id: TrpgD20ThemeId;
  engine: typeof TRPG_DICE_ENGINE | "ancient-reliquary-d20" | "gemstone-arcane-d20";
  look: "obsidian_royal" | "oxidized_bronze" | "arcane_crystal";
  numeralColor: string;
  numeralStroke: string;
  numeralWeight: 600;
  numeralFaceRatio: { single: number; double: number };
  palette: {
    deepest: string;
    body: string;
    vein: string;
    brass: string;
    highlight: string;
  };
  material: {
    metalness: number;
    roughness: number;
    clearcoat: number;
    clearcoatRoughness: number;
    transmission: number;
    ior: number;
    thickness: number;
    envMapIntensity: number;
  };
  lighting: {
    key: number;
    fill: number;
    rim: number;
    ambient: number;
  };
  shadow: {
    radius: number;
    opacity: number;
  };
  texture: TrpgD20ThemeTexture;
  staticOverlay: TrpgD20StaticOverlaySpec;
};

const SHARED_TEXT_SHADOW =
  "0 0 1px rgba(20,14,4,0.9), 0 2px 6px rgba(0,0,0,0.65), 0 0 18px rgba(230,211,163,0.28)";

const OBSIDIAN_ROYAL: TrpgD20ThemeSpec = {
  id: "obsidian-royal",
  engine: "obsidian-royal-d20",
  look: "obsidian_royal",
  numeralColor: "#e8dcc0",
  numeralStroke: "#cbb991",
  numeralWeight: 600,
  numeralFaceRatio: { single: 0.58, double: 0.48 },
  palette: {
    deepest: "#060608",
    body: "#121018",
    vein: "#1a4030",
    brass: "#d4b56a",
    highlight: "#f0e6c8",
  },
  material: {
    metalness: 0.22,
    roughness: 0.34,
    clearcoat: 0.28,
    clearcoatRoughness: 0.32,
    transmission: 0.08,
    ior: 1.52,
    thickness: 0.42,
    envMapIntensity: 0.88,
  },
  lighting: {
    key: 0.92,
    fill: 0.24,
    rim: 0.34,
    ambient: 0.14,
  },
  shadow: {
    radius: 0.55,
    opacity: 0.18,
  },
  texture: "obsidian-gold",
  staticOverlay: {
    baseAsset: "/d20-result/obsidian-royal.webp",
    assetReady: true,
    label: "Obsidian Royal",
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
  },
};

const ANCIENT_RELIQUARY: TrpgD20ThemeSpec = {
  id: "ancient-reliquary",
  engine: "ancient-reliquary-d20",
  look: "oxidized_bronze",
  numeralColor: "#d6c7a1",
  numeralStroke: "#8a6a3a",
  numeralWeight: 600,
  numeralFaceRatio: { single: 0.56, double: 0.46 },
  palette: {
    deepest: "#1a2428",
    body: "#243840",
    vein: "#3a6870",
    brass: "#b89858",
    highlight: "#e8dcc0",
  },
  material: {
    metalness: 0.72,
    roughness: 0.46,
    clearcoat: 0.14,
    clearcoatRoughness: 0.44,
    transmission: 0,
    ior: 1.5,
    thickness: 0,
    envMapIntensity: 0.58,
  },
  lighting: {
    key: 0.8,
    fill: 0.22,
    rim: 0.26,
    ambient: 0.14,
  },
  shadow: {
    radius: 0.55,
    opacity: 0.18,
  },
  texture: "oxidized-bronze",
  staticOverlay: {
    baseAsset: "/d20-result/obsidian-royal.webp",
    assetReady: false,
    label: "Ancient Reliquary",
    overlayDimClass: "bg-black/18",
    numeral: {
      fontFamily: "'Cinzel', Georgia, 'Times New Roman', serif",
      weight: 600,
      singlePx: 80,
      doublePx: 64,
      mobileSinglePx: 62,
      mobileDoublePx: 48,
      letterSpacingDouble: "-0.02em",
      textShadow:
        "0 0 1px rgba(12,18,20,0.92), 0 2px 6px rgba(0,0,0,0.62), 0 0 16px rgba(184,152,88,0.24)",
      colors: {
        normal: "#d6c7a1",
        nat1: "#d48488",
        nat20: "#f0dc9a",
      },
      gradient: {
        normal: { hi: "#f5e8c0", mid: "#c8a458", lo: "#7a5828" },
        nat1: { hi: "#f5c8c8", mid: "#c45868", lo: "#6a1828" },
        nat20: { hi: "#fff0c0", mid: "#e8c048", lo: "#a8781a" },
      },
      glow: {
        normal: "rgba(200,164,88,0.24)",
        nat1: "rgba(170,40,48,0.4)",
        nat20: "rgba(232,192,72,0.5)",
      },
    },
    frameGlow: {
      normal: "drop-shadow-[0_0_26px_rgba(184,152,88,0.26)]",
      nat1: "drop-shadow-[0_0_36px_rgba(120,32,40,0.58)]",
      nat20: "drop-shadow-[0_0_40px_rgba(210,180,96,0.52)]",
    },
    burst: {
      nat1: "radial-gradient(circle,rgba(120,32,40,0.38)_0%,rgba(60,16,28,0.14)_48%,transparent_72%)",
      nat20:
        "radial-gradient(circle,rgba(210,180,96,0.32)_0%,rgba(210,180,96,0.1)_44%,transparent_68%)",
    },
  },
};

const GEMSTONE_ARCANE: TrpgD20ThemeSpec = {
  id: "gemstone-arcane",
  engine: "gemstone-arcane-d20",
  look: "arcane_crystal",
  numeralColor: "#f0e8d0",
  numeralStroke: "#6a4a9a",
  numeralWeight: 600,
  numeralFaceRatio: { single: 0.58, double: 0.48 },
  palette: {
    deepest: "#120818",
    body: "#241038",
    vein: "#5a2890",
    brass: "#9a78d8",
    highlight: "#f5ecff",
  },
  material: {
    metalness: 0.1,
    roughness: 0.28,
    clearcoat: 0.36,
    clearcoatRoughness: 0.24,
    transmission: 0.34,
    ior: 1.58,
    thickness: 0.62,
    envMapIntensity: 0.96,
  },
  lighting: {
    key: 0.9,
    fill: 0.28,
    rim: 0.38,
    ambient: 0.16,
  },
  shadow: {
    radius: 0.55,
    opacity: 0.18,
  },
  texture: "arcane-crystal",
  staticOverlay: {
    baseAsset: "/d20-result/obsidian-royal.webp",
    assetReady: false,
    label: "Gemstone Arcane",
    overlayDimClass: "bg-black/16",
    numeral: {
      fontFamily: "'Cinzel', Georgia, 'Times New Roman', serif",
      weight: 600,
      singlePx: 72,
      doublePx: 58,
      mobileSinglePx: 56,
      mobileDoublePx: 44,
      letterSpacingDouble: "-0.02em",
      textShadow:
        "0 0 1px rgba(18,8,24,0.92), 0 2px 6px rgba(0,0,0,0.62), 0 0 20px rgba(154,120,216,0.32)",
      colors: {
        normal: "#f0e8d0",
        nat1: "#e090a8",
        nat20: "#fff4c8",
      },
      gradient: {
        normal: { hi: "#fff4e8", mid: "#d8b8e8", lo: "#7a58a8" },
        nat1: { hi: "#f5c0d0", mid: "#c05878", lo: "#681848" },
        nat20: { hi: "#fff8d8", mid: "#f0d878", lo: "#b88828" },
      },
      glow: {
        normal: "rgba(200,160,232,0.32)",
        nat1: "rgba(160,40,80,0.4)",
        nat20: "rgba(240,220,120,0.5)",
      },
    },
    frameGlow: {
      normal: "drop-shadow-[0_0_30px_rgba(154,120,216,0.32)]",
      nat1: "drop-shadow-[0_0_38px_rgba(120,32,72,0.58)]",
      nat20: "drop-shadow-[0_0_44px_rgba(240,220,120,0.58)]",
    },
    burst: {
      nat1: "radial-gradient(circle,rgba(120,32,72,0.4)_0%,rgba(60,12,48,0.16)_46%,transparent_70%)",
      nat20:
        "radial-gradient(circle,rgba(240,220,120,0.34)_0%,rgba(154,120,216,0.14)_42%,transparent_68%)",
    },
  },
};

export function trpgD20ThemeSpec(id: TrpgD20ThemeId): TrpgD20ThemeSpec {
  switch (id) {
    case "obsidian-royal":
      return OBSIDIAN_ROYAL;
    case "ancient-reliquary":
      return ANCIENT_RELIQUARY;
    case "gemstone-arcane":
      return GEMSTONE_ARCANE;
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

export function trpgD20StaticOverlaySpec(id: TrpgD20ThemeId): TrpgD20StaticOverlaySpec {
  return trpgD20ThemeSpec(id).staticOverlay;
}

/** Centered result-confirm HUD paint. Reuses theme numeral tokens; no new palette. */
export function trpgD20ResultHudStyle(
  themeId: TrpgD20ThemeId,
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
  const theme = trpgD20ThemeSpec(themeId);
  const numeral = theme.staticOverlay.numeral;
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
      WebkitTextStroke: `1.75px ${theme.palette.deepest}`,
      paintOrder: "stroke fill",
      filter: [
        "drop-shadow(0 1px 1px rgba(0,0,0,0.85))",
        "drop-shadow(0 5px 14px rgba(0,0,0,0.62))",
        `drop-shadow(0 0 16px ${glow})`,
        `drop-shadow(0 0 1px ${theme.numeralStroke})`,
      ].join(" "),
    },
  };
}

export function normalizeTrpgD20ThemeId(value: string | undefined): TrpgD20ThemeId | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (isTrpgD20ThemeId(trimmed)) return trimmed;
  return LEGACY_THEME_ALIASES[trimmed] ?? null;
}

export function isTrpgD20ThemeId(value: string | undefined): value is TrpgD20ThemeId {
  return value === "obsidian-royal" || value === "ancient-reliquary" || value === "gemstone-arcane";
}

/** Brief confirmation hold after the settled face, then the overlay leaves. Do not wait for GM. */
export const TRPG_D20_HOLD_AFTER_SETTLE_MS = 280;

/** Custom renderer roll duration. Physics prototype B is lab-only. */
export const TRPG_D20_ANIMATION_MS = 1_240;

export const TRPG_D20_NAT20_GOLD = "#e8c56a";
export const TRPG_D20_NAT1_CRIMSON = "#8a2430";

const productionTheme = trpgD20ThemeSpec(PRODUCTION_D20_THEME);

/** Muted brass numerals for the production overlay theme. */
export const TRPG_D20_NUMERAL = productionTheme.numeralColor;
export const TRPG_D20_NUMERAL_EDGE = productionTheme.numeralStroke;
export const TRPG_D20_NUMERAL_WEIGHT = productionTheme.numeralWeight;

export const TRPG_D20_STAGE_DESKTOP = { width: 250, height: 218 } as const;
export const TRPG_D20_STAGE_MOBILE = { width: 186, height: 168 } as const;

export const TRPG_D20_OVERLAY_DIM_CLASS = productionTheme.staticOverlay.overlayDimClass;

export const TRPG_DICE_BOX_NOTATION = (value: number) => `1d20@${value}`;

/**
 * dice-box-threejs colorset for the Obsidian Royal production theme.
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
    id: "obsidian-royal-face-texture",
    license: "original",
    note: "Runtime-generated canvas. No third-party dice photograph or WotC asset.",
  },
] as const;

export const TRPG_DICE_BOX_THREEJS_ASSETS_COPIED = false;
export const TRPG_DICE_BOX_THREEJS_REVIEWED = true;
