import {
  splitProseAndStatusWidgetValues,
} from "./parseValues";
import { splitProseAndStatusWidgetValuesDeepSeek } from "./deepseekCapture";

export const WIDGET_EXTRACT_NARRATIVE_CHAR_BUDGET = 8000;

/** Strip widget tails the main RP model may have leaked — prose only for save & V3 extract */
export function stripStatusWidgetFromAssistantProse(text: string): string {
  let prose = splitProseAndStatusWidgetValues(text).prose;
  prose = splitProseAndStatusWidgetValuesDeepSeek(prose).prose;
  return prose.trimEnd();
}

export function allocateWidgetExtractNarrativeSlices(
  currentProse: string,
  previousProse?: string | null,
  budget = WIDGET_EXTRACT_NARRATIVE_CHAR_BUDGET
): { currentSlice: string; previousSlice: string } {
  const cur = currentProse.trim();
  const prev = previousProse?.trim() ?? "";
  const currentSlice = cur.slice(0, budget);
  const remaining = budget - currentSlice.length;
  const previousSlice =
    remaining > 0 && prev
      ? prev.length <= remaining
        ? prev
        : prev.slice(-remaining)
      : "";
  return { currentSlice, previousSlice };
}
