/**
 * OBSIDIAN RELIC visual tokens and license notes for the client D20.
 * Server d20 / DC / billing are unchanged — this file is presentation only.
 */

/** Live overlay winner after browser A/B: custom reads the server face; physics B did not. */
export const PRODUCTION_DICE_PROTO = "A" as const;
export const TRPG_DICE_IMPLEMENTATION = "custom" as const;
export const TRPG_DICE_PHYSICS_ENGINE = "none" as const;
export const TRPG_DICE_ENGINE = "obsidian-relic-d20" as const;
export const TRPG_D20_THEME = "obsidian-relic" as const;

/** Hold the settled face before advancing / fading. 400–600ms. */
export const TRPG_D20_HOLD_AFTER_SETTLE_MS = 520;

/** Custom renderer roll duration (prototype A). Physics prototype B is lab-only. */
export const TRPG_D20_ANIMATION_MS = 1_240;

export const TRPG_D20_NAT20_GOLD = "#e8c56a";
export const TRPG_D20_NAT1_CRIMSON = "#8a2430";

/** Ivory engraved numerals — painted into the face texture, not multiplied by a black material. */
export const TRPG_D20_NUMERAL = "#f3ead4";
export const TRPG_D20_NUMERAL_EDGE = "#c9b896";

export const TRPG_DICE_BOX_NOTATION = (value: number) => `1d20@${value}`;

/**
 * dice-box-threejs colorset. Texture is `none` (no third-party images).
 * Face color is painted into the library canvas (`background`) so the
 * MeshPhysicalMaterial tint (light gray) does not crush ivory numerals.
 * `material` must be a library string key — an object crashes `bp[material]`.
 */
export const TRPG_DICE_BOX_COLORSET = {
  name: "obsidian-relic",
  foreground: TRPG_D20_NUMERAL,
  background: "#2a303a",
  outline: "#8a8070",
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
    id: "obsidian-face-texture",
    license: "original",
    note: "Runtime-generated canvas. No third-party dice photograph or WotC asset.",
  },
] as const;

export const TRPG_DICE_BOX_THREEJS_ASSETS_COPIED = false;
export const TRPG_DICE_BOX_THREEJS_REVIEWED = true;
