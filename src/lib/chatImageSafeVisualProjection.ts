import { sanitizeChatTurnForIllustrationPrompt } from "@/lib/chatImageIllustrationSanitizer";
import {
  collectApprovedComicText,
  DEFAULT_SCENE_PRESENTATION_VISIBILITY,
  formatApprovedScenePlanForIllustration,
  type ScenePlan,
  type ScenePresentationVisibility,
} from "@/lib/chatImageScenePlan";

export { ILLUSTRATION_SAFE_DEPICTION } from "@/lib/chatImageIllustrationSanitizer";

export type SafeVisualReasonCategory =
  | "adult_explicit"
  | "graphic_violence"
  | "self_harm"
  | "other";

export type SafeVisualProjectionResult = {
  text: string;
  applied: boolean;
  omitFromImage: boolean;
  reasonCategories: SafeVisualReasonCategory[];
};

/** High-signal explicit visual acts — not a general keyword blacklist. */
const EXPLICIT_ADULT_VISUAL =
  /(?:섹스|성관계|성행위|삽입|체위|절정|오르가즘|성기|보지|자지|페니스|질내|애무.*?가슴.*?입|입.*?성기|빨아|핥아|쾌감|정액|사정)/iu;

const EXPLICIT_BEDROOM_ACT =
  /(?:겹치(?:며|고)|위에서|아래에서|벌리(?:고|며)|쑤셔|박(?:아|혀)|허리(?:를|를)?(?:들|올|흔)|삽입)/iu;

const GRAPHIC_VIOLENCE =
  /(?:피(?:가|를)?\s*(?:흘|분|튀|나)|찔(?:러|렸|르)|베(?:어|었)|절단|내장|목(?:을|을)?(?:끊|조|누르)|시체|사지(?:를|가)\s*(?:잘|떨))/iu;

const NON_EXPLICIT_ADULT_INTIMACY =
  "Close adult intimacy: the same characters together in the same location, affectionate proximity, emotional tension, faces and upper bodies readable, covered or softly framed composition, non-explicit depiction. Preserve relationship warmth and mood without depicting explicit sexual acts or exposed genitals.";

const NON_EXPLICIT_BEDROOM_REST =
  "Private bedroom aftermath: the same characters resting close together, covered by sheets or clothing, tender expressions, disheveled but modest attire, warm lighting, non-explicit framing.";

const NON_GRAPHIC_AFTERMATH =
  "Emotional aftermath scene: concern and fatigue visible through expression and posture, no graphic injury, no blood, no weapons in frame.";

function uniqueCategories(categories: readonly SafeVisualReasonCategory[]): SafeVisualReasonCategory[] {
  return [...new Set(categories)];
}

/**
 * Deterministic image-only text projection. Does not mutate canonical scene data.
 * Applies existing illustration sanitizer first, then structural non-explicit substitutes.
 */
export function projectSceneTextForSafeImageGeneration(raw: string): SafeVisualProjectionResult {
  const sanitized = sanitizeChatTurnForIllustrationPrompt(raw);
  const reasonCategories: SafeVisualReasonCategory[] = [];

  if (EXPLICIT_ADULT_VISUAL.test(sanitized)) {
    reasonCategories.push("adult_explicit");
    return {
      text: NON_EXPLICIT_ADULT_INTIMACY,
      applied: true,
      omitFromImage: false,
      reasonCategories: uniqueCategories(reasonCategories),
    };
  }

  if (EXPLICIT_BEDROOM_ACT.test(sanitized) && /(?:침대|이불|시트|방|밤)/iu.test(sanitized)) {
    reasonCategories.push("adult_explicit");
    return {
      text: NON_EXPLICIT_BEDROOM_REST,
      applied: true,
      omitFromImage: false,
      reasonCategories: uniqueCategories(reasonCategories),
    };
  }

  if (GRAPHIC_VIOLENCE.test(sanitized)) {
    reasonCategories.push("graphic_violence");
    return {
      text: NON_GRAPHIC_AFTERMATH,
      applied: true,
      omitFromImage: false,
      reasonCategories: uniqueCategories(reasonCategories),
    };
  }

  if (/self[-\s]?harm|자해|자살|목(?:을|을)?\s*매|손목(?:을|을)?\s*긋/iu.test(sanitized)) {
    reasonCategories.push("self_harm");
  }

  return {
    text: sanitized,
    applied: sanitized !== String(raw ?? "").trim(),
    omitFromImage: false,
    reasonCategories: uniqueCategories(reasonCategories),
  };
}

export function projectSceneBlockForSafeImageGeneration(raw: string): SafeVisualProjectionResult {
  const lines = String(raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return {
      text: "",
      applied: false,
      omitFromImage: false,
      reasonCategories: [],
    };
  }
  const categories: SafeVisualReasonCategory[] = [];
  let applied = false;
  const projected = lines.map((line) => {
    const result = projectSceneTextForSafeImageGeneration(line);
    if (result.applied) applied = true;
    categories.push(...result.reasonCategories);
    return result.omitFromImage ? null : result.text;
  });
  return {
    text: projected.filter(Boolean).join("\n"),
    applied,
    omitFromImage: projected.every((line) => line == null),
    reasonCategories: uniqueCategories(categories),
  };
}
/** Detects high-signal explicit Korean source fragments in image-bound text. */
export function isExplicitSourceTextForImageLeak(text: string): boolean {
  const sanitized = sanitizeChatTurnForIllustrationPrompt(text);
  if (EXPLICIT_ADULT_VISUAL.test(sanitized)) return true;
  return (
    EXPLICIT_BEDROOM_ACT.test(sanitized) &&
    /(?:침대|이불|시트|방|밤)/iu.test(sanitized)
  );
}

export function shouldOmitDialogueFromImageProjection(text: string): boolean {
  const projected = projectSceneTextForSafeImageGeneration(text);
  return (
    projected.applied &&
    (projected.reasonCategories.includes("adult_explicit") ||
      projected.reasonCategories.includes("graphic_violence") ||
      projected.reasonCategories.includes("self_harm"))
  );
}

export function projectTextForSafeImagePrompt(text: string): string {
  const projected = projectSceneTextForSafeImageGeneration(text);
  return projected.omitFromImage ? "" : projected.text;
}
export function formatApprovedScenePlanForSafeImageGeneration(
  plan: ScenePlan,
  visibility: ScenePresentationVisibility = DEFAULT_SCENE_PRESENTATION_VISIBILITY
): { formatted: string; applied: boolean; reasonCategories: SafeVisualReasonCategory[] } {
  const reasonCategories = new Set<SafeVisualReasonCategory>();
  let applied = false;
  const formatted = formatApprovedScenePlanForIllustration(plan, visibility, {
    projectText: (text) => {
      const projected = projectSceneTextForSafeImageGeneration(text);
      if (projected.applied) applied = true;
      for (const category of projected.reasonCategories) reasonCategories.add(category);
      return projected.text;
    },
  });
  return {
    formatted,
    applied,
    reasonCategories: [...reasonCategories],
  };
}

export function collectApprovedComicTextForSafeImageGeneration(
  plan: ScenePlan,
  visibility: ScenePresentationVisibility = DEFAULT_SCENE_PRESENTATION_VISIBILITY
): { texts: string[]; applied: boolean; reasonCategories: SafeVisualReasonCategory[] } {
  const reasonCategories = new Set<SafeVisualReasonCategory>();
  let applied = false;
  const texts = collectApprovedComicText(plan, visibility, {
    omitText: (text) => {
      if (!text.trim()) return true;
      if (shouldOmitDialogueFromImageProjection(text)) {
        applied = true;
        const projected = projectSceneTextForSafeImageGeneration(text);
        for (const category of projected.reasonCategories) reasonCategories.add(category);
        return true;
      }
      return false;
    },
  });
  return {
    texts,
    applied,
    reasonCategories: [...reasonCategories],
  };
}
