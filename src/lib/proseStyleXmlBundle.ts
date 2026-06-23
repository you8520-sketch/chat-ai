import {
  buildAdvancedProseNsfwGuidelines,
  type AdvancedProseNsfwOpts,
} from "@/lib/advancedProseNsfwGuidelines";
import { UNIFIED_WEBNOVEL_STYLE_BLOCK } from "@/lib/writingStylePreset";

/** @deprecated Scene stop/pacing moved to <TURN_HANDOFF_AND_PACING> — kept for test import compatibility */
export const SCENE_PROGRESSION_AND_STOP_CONDITIONS =
  "(removed — see <TURN_HANDOFF_AND_PACING>)";

export type ProseStyleXmlBundleOpts = AdvancedProseNsfwOpts;

/** Merged OpenRouter prose/style policy — advanced prose + unified webnovel style. */
export function buildProseStyleXmlBundle(opts: ProseStyleXmlBundleOpts): string {
  const advancedProse = buildAdvancedProseNsfwGuidelines(opts);

  return `<PROSE_STYLE_POLICY>
<ADVANCED_PROSE_NSFW>
${advancedProse}
</ADVANCED_PROSE_NSFW>

<KOREAN_WEBNOVEL_STYLE>
${UNIFIED_WEBNOVEL_STYLE_BLOCK}
</KOREAN_WEBNOVEL_STYLE>
</PROSE_STYLE_POLICY>`;
}
