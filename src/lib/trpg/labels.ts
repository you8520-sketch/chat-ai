import type { TrpgBillingMode, TrpgSuccessTier } from "./types";

/** Display-only. Uses server d20 / finalScore / DC / tier; does not reroll. */
export function formatTrpgRollCompact(opts: {
  statLabel: string;
  d20: number;
  finalScore: number;
  dc: number;
  tier: TrpgSuccessTier;
}): string {
  const modifier = opts.finalScore - opts.d20;
  const modText = modifier >= 0 ? `+${modifier}` : String(modifier);
  return `${opts.statLabel} · d20 ${opts.d20} ${modText} = ${opts.finalScore} vs DC ${opts.dc} · ${successLabelKo(opts.tier)}`;
}

export function trpgBillingModeLabel(mode: TrpgBillingMode): string {
  switch (mode) {
    case "split_even":
      return "균등 부담";
    case "host_pays":
      return "방장 전액 부담";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function successLabelKo(tier: TrpgSuccessTier): string {
  switch (tier) {
    case "CRITICAL_FAILURE":
      return "치명적 실패";
    case "SEVERE_FAILURE":
      return "처참한 실패";
    case "FAILURE":
      return "실패";
    case "PARTIAL_SUCCESS":
      return "부분 성공";
    case "SUCCESS":
      return "성공";
    case "GREAT_SUCCESS":
      return "대성공";
    case "CRITICAL_SUCCESS":
      return "치명적 성공";
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}
