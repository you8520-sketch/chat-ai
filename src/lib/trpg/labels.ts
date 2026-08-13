import type { TrpgSuccessTier } from "./types";

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
