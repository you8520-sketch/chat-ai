/** @deprecated PROSE_STYLE_SECTION — buildAdvancedProseNsfwGuidelines() 단일 출처 */
export {
  PROSE_STYLE_SECTION as KOREAN_WEBNOVEL_STYLE_BLOCK,
  PROSE_STYLE_SECTION as KOREAN_WEBNOVEL_STYLE,
  PROSE_STYLE_SECTION as DYNAMIC_PROSE_STYLING_BLOCK,
  PROSE_STYLE_SECTION as UNIFIED_WEBNOVEL_STYLE_BLOCK,
  PROSE_STYLE_SECTION as KOREAN_WEBNOVEL_FORMAT_RULES,
} from "@/lib/advancedProseNsfwGuidelines";

/** @deprecated Presets removed — always unified style */
export function normalizeCreatorRecommendedStyle(_value: unknown): "balanced" {
  return "balanced";
}
