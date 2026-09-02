export const TRPG_GM_BRIEF_MAX_CHARS = 160;
export const TRPG_GM_RICH_MIN_CHARS = 350;

export const TRPG_GM_SPARSE_MIN_CHARS = 2800;
export const TRPG_GM_SPARSE_TARGET_MIN_CHARS = 3600;
export const TRPG_GM_SPARSE_TARGET_MAX_CHARS = 4600;

export const TRPG_GM_MIXED_MIN_CHARS = 2400;
export const TRPG_GM_MIXED_TARGET_MIN_CHARS = 3000;
export const TRPG_GM_MIXED_TARGET_MAX_CHARS = 4000;

export const TRPG_GM_RICH_BUDGET_MIN_CHARS = 2000;
export const TRPG_GM_RICH_TARGET_MIN_CHARS = 2500;
export const TRPG_GM_RICH_TARGET_MAX_CHARS = 3500;

export const TRPG_GM_BUDGET_PARTY_BASE = 2;
export const TRPG_GM_BUDGET_MIN_PER_EXTRA = 200;
export const TRPG_GM_BUDGET_TARGET_PER_EXTRA = 300;
export const TRPG_GM_BUDGET_MIN_EXTRA_CAP = 400;
export const TRPG_GM_BUDGET_TARGET_EXTRA_CAP = 600;

export type TrpgActionInputDensity = "BRIEF" | "MID" | "RICH";
export type TrpgRoundDensity = "SPARSE" | "MIXED" | "RICH";

export type TrpgGmNarrationBudget = {
  density: TrpgRoundDensity;
  minChars: number;
  targetMinChars: number;
  targetMaxChars: number;
};

export function countTrpgNarrationChars(text: string): number {
  return [...text.trim()].length;
}

export function classifyTrpgActionInputDensity(body: string): TrpgActionInputDensity {
  const n = countTrpgNarrationChars(body);
  if (n <= TRPG_GM_BRIEF_MAX_CHARS) return "BRIEF";
  if (n >= TRPG_GM_RICH_MIN_CHARS) return "RICH";
  return "MID";
}

export function classifyTrpgRoundDensity(bodies: readonly string[]): TrpgRoundDensity {
  if (bodies.length === 0) return "SPARSE";
  const classes = bodies.map(classifyTrpgActionInputDensity);
  if (classes.every((item) => item === "BRIEF")) return "SPARSE";
  if (classes.every((item) => item === "RICH")) return "RICH";
  return "MIXED";
}

function baseBudget(density: TrpgRoundDensity): {
  minChars: number;
  targetMinChars: number;
  targetMaxChars: number;
} {
  switch (density) {
    case "SPARSE":
      return {
        minChars: TRPG_GM_SPARSE_MIN_CHARS,
        targetMinChars: TRPG_GM_SPARSE_TARGET_MIN_CHARS,
        targetMaxChars: TRPG_GM_SPARSE_TARGET_MAX_CHARS,
      };
    case "MIXED":
      return {
        minChars: TRPG_GM_MIXED_MIN_CHARS,
        targetMinChars: TRPG_GM_MIXED_TARGET_MIN_CHARS,
        targetMaxChars: TRPG_GM_MIXED_TARGET_MAX_CHARS,
      };
    case "RICH":
      return {
        minChars: TRPG_GM_RICH_BUDGET_MIN_CHARS,
        targetMinChars: TRPG_GM_RICH_TARGET_MIN_CHARS,
        targetMaxChars: TRPG_GM_RICH_TARGET_MAX_CHARS,
      };
    default: {
      const _never: never = density;
      return _never;
    }
  }
}

export function computeTrpgGmNarrationBudget(bodies: readonly string[]): TrpgGmNarrationBudget {
  const density = classifyTrpgRoundDensity(bodies);
  const base = baseBudget(density);
  const extras = Math.max(0, bodies.length - TRPG_GM_BUDGET_PARTY_BASE);
  const minExtra = Math.min(extras * TRPG_GM_BUDGET_MIN_PER_EXTRA, TRPG_GM_BUDGET_MIN_EXTRA_CAP);
  const targetExtra = Math.min(extras * TRPG_GM_BUDGET_TARGET_PER_EXTRA, TRPG_GM_BUDGET_TARGET_EXTRA_CAP);
  return {
    density,
    minChars: base.minChars + minExtra,
    targetMinChars: base.targetMinChars + targetExtra,
    targetMaxChars: base.targetMaxChars + targetExtra,
  };
}

export function formatTrpgRoundNarrationBudget(budget: TrpgGmNarrationBudget): string {
  return [
    "[ROUND NARRATION BUDGET]",
    `Input density: ${budget.density}`,
    `Minimum new GM narration: ${budget.minChars} Korean characters`,
    `Target new GM narration: ${budget.targetMinChars}–${budget.targetMaxChars} Korean characters`,
    "Finish at or above Minimum; TARGET is the normal complete-scene range.",
  ].join("\n");
}
