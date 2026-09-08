import {
  LENGTH_BANDS,
  type LengthBand,
  type LengthMetrics,
} from "./types";

export function classifyLengthBand(visibleCharsNoWs: number): LengthBand {
  if (visibleCharsNoWs < LENGTH_BANDS.STRONG_REGRESSION_MIN) {
    return "DENSITY_COLLAPSE";
  }
  if (visibleCharsNoWs < LENGTH_BANDS.REVIEW_REQUIRED_MIN) {
    return "STRONG_LENGTH_REGRESSION";
  }
  if (visibleCharsNoWs < LENGTH_BANDS.SOFT_ACCEPT_MIN) {
    return "REVIEW_REQUIRED";
  }
  if (
    visibleCharsNoWs >= LENGTH_BANDS.IDEAL_MIN &&
    visibleCharsNoWs <= LENGTH_BANDS.IDEAL_MAX
  ) {
    return "IDEAL";
  }
  // Above soft accept but outside ideal (e.g. 2800–3199 or >4200) → SOFT_ACCEPT
  return "SOFT_ACCEPT";
}

export function computeLengthMetrics(input: {
  text: string;
  providerRaw?: string | null;
  finalDisplay?: string | null;
  pairVisibleCharsNoWs?: number | null;
  finishReason?: string | null;
  sawDone?: boolean | null;
  incomplete?: boolean | null;
}): LengthMetrics {
  const text = input.text ?? "";
  const visible_chars_with_spaces = text.length;
  const visible_chars_no_whitespace = text.replace(/\s+/g, "").length;
  const pair = input.pairVisibleCharsNoWs;
  const length_ratio_vs_pair =
    pair != null && pair > 0
      ? Number((visible_chars_no_whitespace / pair).toFixed(4))
      : null;
  return {
    visible_chars_with_spaces,
    visible_chars_no_whitespace,
    provider_raw_chars: input.providerRaw != null ? input.providerRaw.length : null,
    final_display_chars:
      input.finalDisplay != null ? input.finalDisplay.length : null,
    length_band: classifyLengthBand(visible_chars_no_whitespace),
    length_ratio_vs_pair,
    finish_reason: input.finishReason ?? null,
    saw_done: input.sawDone ?? null,
    incomplete: input.incomplete ?? null,
  };
}
