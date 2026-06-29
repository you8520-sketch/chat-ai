import type { AdvancedProseNsfwOpts } from "@/lib/advancedProseNsfwGuidelines";
import { buildAdvancedProseNsfwGuidelines } from "@/lib/advancedProseNsfwGuidelines";

/** @deprecated Scene stop/pacing moved to <TURN_HANDOFF_AND_PACING> — kept for test import compatibility */
export const SCENE_PROGRESSION_AND_STOP_CONDITIONS =
  "(removed — <TURN_HANDOFF_AND_PACING>)";

export type ProseStyleXmlBundleOpts = AdvancedProseNsfwOpts;

/** OpenRouter prose/style policy — alias of buildAdvancedProseNsfwGuidelines (includes [PROSE STYLE]). */
export function buildProseStyleXmlBundle(opts: ProseStyleXmlBundleOpts): string {
  return buildAdvancedProseNsfwGuidelines(opts);
}
