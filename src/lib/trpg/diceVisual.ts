/**
 * Production D20 presentation tokens. Server d20 / DC / billing stay unchanged.
 * Live overlay uses Verdant Relic. Ancient Reliquary is the same custom renderer
 * with a different material spec (dice-lab comparison only).
 */

export const PRODUCTION_DICE_PROTO = "A" as const;
export const TRPG_DICE_IMPLEMENTATION = "custom" as const;
export const TRPG_DICE_PHYSICS_ENGINE = "none" as const;

export type TrpgD20ThemeId = "verdant-relic" | "ancient-reliquary" | "emerald-relic";

export const PRODUCTION_D20_THEME: TrpgD20ThemeId = "verdant-relic";
export const TRPG_D20_THEME = PRODUCTION_D20_THEME;
export const TRPG_DICE_ENGINE = "verdant-relic-d20" as const;

export type TrpgD20ThemeTexture = "sparse-gold-motes" | "oxidized-bronze" | "gilded-verdant";

export type TrpgD20ThemeSpec = {
  id: TrpgD20ThemeId;
  engine: typeof TRPG_DICE_ENGINE | "ancient-reliquary-d20" | "emerald-relic-d20";
  look: "smoked_glass" | "oxidized_bronze" | "gilded_verdant_relic";
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
};

const VERDANT_RELIC: TrpgD20ThemeSpec = {
  id: "verdant-relic",
  engine: "verdant-relic-d20",
  look: "smoked_glass",
  numeralColor: "#d6c7a1",
  numeralStroke: "#cbb991",
  numeralWeight: 600,
  numeralFaceRatio: { single: 0.5, double: 0.46 },
  palette: {
    deepest: "#0e1c16",
    body: "#163226",
    vein: "#3f6a4a",
    brass: "#cbb991",
    highlight: "#d6c7a1",
  },
  material: {
    metalness: 0.16,
    roughness: 0.33,
    clearcoat: 0.22,
    clearcoatRoughness: 0.36,
    transmission: 0.28,
    ior: 1.46,
    thickness: 0.58,
    envMapIntensity: 0.82,
  },
  lighting: {
    key: 0.88,
    fill: 0.22,
    rim: 0.28,
    ambient: 0.16,
  },
  shadow: {
    radius: 0.55,
    opacity: 0.18,
  },
  texture: "sparse-gold-motes",
};

const ANCIENT_RELIQUARY: TrpgD20ThemeSpec = {
  id: "ancient-reliquary",
  engine: "ancient-reliquary-d20",
  look: "oxidized_bronze",
  numeralColor: "#cbb991",
  numeralStroke: "#8a6a3a",
  numeralWeight: 600,
  numeralFaceRatio: { single: 0.5, double: 0.46 },
  palette: {
    deepest: "#2a221c",
    body: "#3a2d22",
    vein: "#8a6a3a",
    brass: "#cbb991",
    highlight: "#d6c7a1",
  },
  material: {
    metalness: 0.7,
    roughness: 0.48,
    clearcoat: 0.12,
    clearcoatRoughness: 0.48,
    transmission: 0,
    ior: 1.5,
    thickness: 0,
    envMapIntensity: 0.55,
  },
  lighting: {
    key: 0.78,
    fill: 0.2,
    rim: 0.24,
    ambient: 0.14,
  },
  shadow: {
    radius: 0.55,
    opacity: 0.18,
  },
  texture: "oxidized-bronze",
};

const EMERALD_RELIC: TrpgD20ThemeSpec = {
  id: "emerald-relic",
  engine: "emerald-relic-d20",
  look: "gilded_verdant_relic",
  numeralColor: "#b89a58",
  numeralStroke: "#4b381d",
  numeralWeight: 600,
  numeralFaceRatio: { single: 0.42, double: 0.38 },
  palette: {
    deepest: "#06120c",
    body: "#1c3a2a",
    vein: "#2c4a36",
    brass: "#b89a58",
    highlight: "#e1cf9a",
  },
  material: {
    metalness: 0.2,
    roughness: 0.28,
    clearcoat: 0.28,
    clearcoatRoughness: 0.3,
    transmission: 0.34,
    ior: 1.5,
    thickness: 0.62,
    envMapIntensity: 0.95,
  },
  lighting: {
    key: 0.94,
    fill: 0.26,
    rim: 0.32,
    ambient: 0.18,
  },
  shadow: {
    radius: 0.55,
    opacity: 0.18,
  },
  texture: "gilded-verdant",
};

export function trpgD20ThemeSpec(id: TrpgD20ThemeId): TrpgD20ThemeSpec {
  switch (id) {
    case "verdant-relic":
      return VERDANT_RELIC;
    case "ancient-reliquary":
      return ANCIENT_RELIQUARY;
    case "emerald-relic":
      return EMERALD_RELIC;
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

export function isTrpgD20ThemeId(value: string | undefined): value is TrpgD20ThemeId {
  return value === "verdant-relic" || value === "ancient-reliquary" || value === "emerald-relic";
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

export const TRPG_D20_GEOMETRY_RADIUS = 0.78;
export const TRPG_D20_CAMERA_FOV = 32;
export const TRPG_D20_CAMERA_POS = { x: 0.08, y: 0.98, z: 3.52 } as const;
export const TRPG_D20_CAMERA_LOOK_AT = { x: 0, y: 0.04, z: 0 } as const;
export const TRPG_D20_REST_Y = -0.02;

export const TRPG_D20_STAGE_DESKTOP = { width: 250, height: 218 } as const;
export const TRPG_D20_STAGE_MOBILE = { width: 186, height: 168 } as const;
export const TRPG_D20_STAGE_DESKTOP_BAND = { width: [220, 280], height: [180, 230] } as const;
export const TRPG_D20_STAGE_MOBILE_BAND = { width: [160, 210], height: [140, 180] } as const;
export const TRPG_D20_DIAMETER_DESKTOP_BAND = { min: 150, max: 190 } as const;
export const TRPG_D20_DIAMETER_MOBILE_BAND = { min: 110, max: 150 } as const;

export const TRPG_D20_OVERLAY_DIM_CLASS = "bg-black/15";

export function trpgD20CameraDistanceToRest(
  camera = TRPG_D20_CAMERA_POS,
  restY = TRPG_D20_REST_Y
): number {
  return Math.hypot(camera.x, camera.y - restY, camera.z);
}

export function trpgD20VisibleHeightAtRest(
  fov = TRPG_D20_CAMERA_FOV,
  distance = trpgD20CameraDistanceToRest()
): number {
  return 2 * Math.tan((fov * Math.PI) / 180 / 2) * distance;
}

/** Settled die diameter in CSS pixels for a given stage height. */
export function trpgD20ProjectedDiameterPx(
  stageHeightPx: number,
  radius = TRPG_D20_GEOMETRY_RADIUS
): number {
  const visibleH = trpgD20VisibleHeightAtRest();
  if (visibleH <= 0 || stageHeightPx <= 0) return 0;
  return ((radius * 2) / visibleH) * stageHeightPx;
}

export const TRPG_DICE_BOX_NOTATION = (value: number) => `1d20@${value}`;

/**
 * dice-box-threejs colorset. Texture is `none` (no third-party images).
 * Lab-only physics prototype — not wired into the campaign overlay.
 */
export const TRPG_DICE_BOX_COLORSET = {
  name: "verdant-relic",
  foreground: TRPG_D20_NUMERAL,
  background: "#163226",
  outline: "#8a6a3a",
  texture: "none",
  material: "glass",
} as const;

export const TRPG_DICE_ASSET_LICENSES = [
  {
    id: "dice-box-threejs",
    license: "MIT",
    note: "Runtime library only. Package public/textures and public/sounds are not copied.",
  },
  {
    id: "verdant-face-texture",
    license: "original",
    note: "Runtime-generated canvas. No third-party dice photograph or WotC asset.",
  },
] as const;

export const TRPG_DICE_BOX_THREEJS_ASSETS_COPIED = false;
export const TRPG_DICE_BOX_THREEJS_REVIEWED = true;
