/**
 * Presentation-only D20 motion. No physics engine.
 * Landing orientation is applied by the scene from a predetermined quaternion.
 */

export const TRPG_D20_SETTLE_START = 0.82;
export const TRPG_D20_FLOOR_Y = -0.02;
export const TRPG_D20_START_Y = 1.58;
export const TRPG_D20_FALL_END = 0.5;
export const TRPG_D20_BOUNCE1_PEAK_T = 0.58;
export const TRPG_D20_BOUNCE1_END = 0.68;
export const TRPG_D20_BOUNCE1_HEIGHT = 0.3;
export const TRPG_D20_BOUNCE2_PEAK_T = 0.73;
export const TRPG_D20_BOUNCE2_END = 0.82;
export const TRPG_D20_BOUNCE2_HEIGHT = 0.075;
export const TRPG_D20_OMEGA0 = 22;
export const TRPG_D20_SPIN_DECAY = 2.55;
export const TRPG_D20_START_X = 1.18;
export const TRPG_D20_START_Z = -0.38;

export function clampUnit(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clampUnit((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Integral of omega0 * e^{-decay t}. Fast early spin, ease-out later. */
export function tumbleAngleRad(t: number, omega0 = TRPG_D20_OMEGA0, decay = TRPG_D20_SPIN_DECAY): number {
  const u = clampUnit(t);
  if (decay <= 0) return omega0 * u;
  return (omega0 / decay) * (1 - Math.exp(-decay * u));
}

export function settleBlend(t: number): number {
  return smoothstep(TRPG_D20_SETTLE_START, 1, t);
}

function bounceArc(t: number, start: number, peak: number, end: number, height: number): number {
  if (t <= start || t >= end || height <= 0) return 0;
  const mid = (peak - start) / (end - start);
  const x = (t - start) / (end - start);
  const denom = mid * (1 - mid);
  if (denom <= 0) return 0;
  return height * (x * (1 - x)) / denom;
}

export function diceDropHeight(t: number): number {
  const u = clampUnit(t);
  if (u < TRPG_D20_FALL_END) {
    const p = u / TRPG_D20_FALL_END;
    return TRPG_D20_FLOOR_Y + TRPG_D20_START_Y * (1 - p * p);
  }
  if (u < TRPG_D20_BOUNCE1_END) {
    return (
      TRPG_D20_FLOOR_Y +
      bounceArc(u, TRPG_D20_FALL_END, TRPG_D20_BOUNCE1_PEAK_T, TRPG_D20_BOUNCE1_END, TRPG_D20_BOUNCE1_HEIGHT)
    );
  }
  if (u < TRPG_D20_BOUNCE2_END) {
    return (
      TRPG_D20_FLOOR_Y +
      bounceArc(u, TRPG_D20_BOUNCE1_END, TRPG_D20_BOUNCE2_PEAK_T, TRPG_D20_BOUNCE2_END, TRPG_D20_BOUNCE2_HEIGHT)
    );
  }
  return TRPG_D20_FLOOR_Y;
}

export function diceTravel(t: number): number {
  return smoothstep(0, 0.7, t);
}

export function diceLateral(
  t: number,
  startX = TRPG_D20_START_X,
  startZ = TRPG_D20_START_Z
): { x: number; z: number } {
  const travel = diceTravel(t);
  const wobble = (1 - travel) * 0.14;
  return {
    x: startX * (1 - travel) + Math.sin(t * 9.2) * wobble,
    z: startZ * (1 - travel) + Math.cos(t * 6.4) * wobble * 0.55,
  };
}

export function randomUnitAxis(rng: () => number): { x: number; y: number; z: number } {
  const u = rng() * 2 - 1;
  const theta = rng() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  return { x: s * Math.cos(theta), y: u, z: s * Math.sin(theta) };
}

export function randomStartEuler(rng: () => number): { x: number; y: number; z: number } {
  return {
    x: rng() * Math.PI * 2,
    y: rng() * Math.PI * 2,
    z: rng() * Math.PI * 2,
  };
}

export function dicePoseAt(t: number): {
  x: number;
  y: number;
  z: number;
  tumbleAngle: number;
  settle: number;
  landed: boolean;
} {
  const u = clampUnit(t);
  const lateral = diceLateral(u);
  return {
    x: u >= 1 ? 0 : lateral.x,
    y: diceDropHeight(u),
    z: u >= 1 ? 0 : lateral.z,
    tumbleAngle: tumbleAngleRad(u),
    settle: settleBlend(u),
    landed: u >= 1,
  };
}
